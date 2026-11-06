#include "progress_store.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <system_error>
#include <chrono>
#include <random>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::learning {
namespace {

constexpr std::uintmax_t kMaxProgressFileBytes = 16 * 1024 * 1024;
constexpr std::size_t kMaxProgressLineBytes = 64 * 1024;
constexpr std::size_t kMaxProgressRecords = 100'000;

std::filesystem::path pending_path(const std::filesystem::path& destination) {
  return destination.string() + ".append.txn";
}

std::filesystem::path temporary_path(const std::filesystem::path& destination) {
  return destination.string() + ".tmp." + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "." + std::to_string(std::random_device{}());
}

std::string encode_hex(std::string_view value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string encoded;
  for (const unsigned char byte : value) {
    encoded.push_back(digits[byte >> 4]);
    encoded.push_back(digits[byte & 0x0f]);
  }
  return encoded;
}

std::string serialize(const ProgressFact& fact) {
  return encode_hex(fact.fact_id) + '\t' + encode_hex(fact.content_id) + '\t' +
      encode_hex(fact.exercise_id) + '\t' + encode_hex(fact.at) + '\t' +
      encode_hex(fact.status) + '\t' + encode_hex(fact.operation_id);
}

bool decode_hex(std::string_view value, std::string& output) {
  if (value.size() % 2 != 0) return false;
  const auto digit = [](char value) -> int {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
  };
  output.clear();
  for (size_t index = 0; index < value.size(); index += 2) {
    const int high = digit(value[index]);
    const int low = digit(value[index + 1]);
    if (high < 0 || low < 0) return false;
    output.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

bool parse_line(std::string_view line, ProgressFact& fact) {
  if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
  std::vector<std::string_view> fields;
  size_t start = 0;
  while (start <= line.size()) {
    const auto end = line.find('\t', start);
    fields.push_back(line.substr(start, end == std::string_view::npos ? line.size() - start : end - start));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  if (fields.size() != 6) return false;
  std::string values[6];
  for (size_t index = 0; index < 6; ++index) if (!decode_hex(fields[index], values[index])) return false;
  fact = {std::move(values[0]), std::move(values[1]), std::move(values[2]),
          std::move(values[3]), std::move(values[4]), std::move(values[5])};
  return validate_progress_fact(fact).ok;
}

bool safe_identifier(std::string_view value, size_t max_length) {
  if (value.empty() || value.size() > max_length) return false;
  for (const unsigned char character : value) {
    if (!(std::isalnum(character) != 0 || character == '-' || character == '_' || character == '.')) return false;
  }
  return true;
}

bool has_symlink_component(const std::filesystem::path& value) {
  auto current = std::filesystem::path{};
  std::error_code error;
  for (const auto& component : value) {
    current /= component;
    if (current == value.root_name() || current == value.root_path()) continue;
    const auto status = std::filesystem::symlink_status(current, error);
    if (!error && std::filesystem::is_symlink(status)) return true;
    if (error == std::make_error_code(std::errc::no_such_file_or_directory) ||
        error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND) { error.clear(); continue; }
    if (error) return true;
  }
  return false;
}

app::Result append_durable(const std::filesystem::path& destination, std::string_view line) {
  std::ofstream output(destination, std::ios::binary | std::ios::app);
  if (!output) return app::Result::failure("打开进度账本追加流失败");
  output.write(line.data(), static_cast<std::streamsize>(line.size()));
  output.flush();
  if (!output) return app::Result::failure("追加进度账本失败");
  output.close();
#ifdef _WIN32
  const auto handle = CreateFileW(destination.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(handle)) {
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    return app::Result::failure("刷盘进度账本失败");
  }
  CloseHandle(handle);
#endif
  return app::Result::success("进度账本已追加");
}

app::Result write_pending_transaction(const std::filesystem::path& destination,
    std::uintmax_t base_size, std::string_view line) {
  const auto pending = pending_path(destination);
  const auto temporary = temporary_path(pending);
  const auto body = std::to_string(base_size) + "\n" + encode_hex(line);
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return app::Result::failure("创建进度追加事务失败");
    output.write(body.data(), static_cast<std::streamsize>(body.size()));
    output.flush();
    if (!output) {
      std::error_code ignored;
      std::filesystem::remove(temporary, ignored);
      return app::Result::failure("写入进度追加事务失败");
    }
  }
  std::error_code error;
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), pending.wstring().c_str(),
      MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
  }
#else
  std::filesystem::rename(temporary, pending, error);
#endif
  if (error) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("提交进度追加事务失败");
  }
  return app::Result::success("进度追加事务已记录");
}

app::Result recover_pending(const std::filesystem::path& destination,
    const std::filesystem::path& data_root) {
  const auto pending = pending_path(destination);
  std::error_code error;
  const auto pending_status = std::filesystem::symlink_status(pending, error);
  if (error == std::make_error_code(std::errc::no_such_file_or_directory) ||
      error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND) {
    return app::Result::success();
  }
  if (error) return app::Result::failure("读取进度追加事务状态失败");
  if (std::filesystem::is_symlink(pending_status) ||
      !std::filesystem::is_regular_file(pending_status) ||
      has_symlink_component(destination.parent_path())) {
    return app::Result::failure("进度追加事务路径无效");
  }
  std::ifstream input(pending, std::ios::binary);
  if (!input) return app::Result::failure("打开进度追加事务失败");
  const auto pending_size = std::filesystem::file_size(pending, error);
  if (error || pending_size > kMaxProgressLineBytes * 2) {
    return app::Result::failure("进度追加事务超过大小上限");
  }
  std::string body(static_cast<std::size_t>(pending_size), '\0');
  input.read(body.data(), static_cast<std::streamsize>(body.size()));
  if (!input && !input.eof()) return app::Result::failure("读取进度追加事务失败");
  input.close();
  if (input.fail()) return app::Result::failure("关闭进度追加事务失败");
  const auto separator = body.find('\n');
  if (separator == std::string::npos) return app::Result::failure("进度追加事务格式无效");
  std::uintmax_t base_size{};
  const auto parsed = std::from_chars(body.data(), body.data() + separator, base_size);
  if (parsed.ec != std::errc{} || parsed.ptr != body.data() + separator) {
    return app::Result::failure("进度追加事务原长度无效");
  }
  std::string line;
  if (!decode_hex(std::string_view(body).substr(separator + 1), line) || line.empty() ||
      line.size() > kMaxProgressLineBytes) {
    return app::Result::failure("进度追加事务内容无效");
  }
  if (data_root.empty() || !data_root.is_absolute()) {
    return app::Result::failure("进度数据根必须是绝对路径");
  }
  std::uintmax_t current_size = 0;
  const auto destination_status = std::filesystem::symlink_status(destination, error);
  if (error && error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      error.value() != ERROR_FILE_NOT_FOUND && error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取进度账本状态失败");
  }
  if (!error && (std::filesystem::is_symlink(destination_status) ||
      !std::filesystem::is_regular_file(destination_status))) {
    return app::Result::failure("进度账本文件类型无效");
  }
  error.clear();
  if (std::filesystem::exists(destination, error)) {
    current_size = std::filesystem::file_size(destination, error);
    if (error) return app::Result::failure("读取进度账本大小失败");
  }
  if (current_size < base_size || current_size > base_size + line.size()) {
    return app::Result::failure("进度追加事务与账本长度不一致");
  }
  if (current_size != base_size) {
    std::ifstream ledger(destination, std::ios::binary);
    if (!ledger) return app::Result::failure("打开进度账本恢复尾部失败");
    ledger.seekg(static_cast<std::streamoff>(base_size), std::ios::beg);
    std::string tail(static_cast<std::size_t>(current_size - base_size), '\0');
    ledger.read(tail.data(), static_cast<std::streamsize>(tail.size()));
    if (!ledger && !ledger.eof()) return app::Result::failure("读取进度账本恢复尾部失败");
    if (tail != line) return app::Result::failure("进度追加事务尾部校验失败");
    std::filesystem::remove(pending, error);
    return error ? app::Result::failure("清理进度追加事务失败")
                 : app::Result::success("进度追加事务已恢复");
  }
  if (base_size + line.size() > kMaxProgressFileBytes) {
    return app::Result::failure("恢复后进度账本超过大小上限");
  }
  const auto appended = append_durable(destination, line);
  if (!appended.ok) return appended;
  error.clear();
  if (!std::filesystem::remove(pending, error) || error) {
    return app::Result::failure("清理进度追加事务失败");
  }
  return app::Result::success("进度追加事务已恢复");
}

app::Result read_all_unlocked(const std::filesystem::path& path,
    const std::filesystem::path& data_root, std::vector<ProgressFact>& facts) {
  facts.clear();
  if (data_root.empty() || !data_root.is_absolute()) {
    return app::Result::failure("进度数据根必须是绝对路径");
  }
  const auto recovered = recover_pending(path, data_root);
  if (!recovered.ok) return recovered;
  std::error_code status_error;
  const auto file_status = std::filesystem::symlink_status(path, status_error);
  if (status_error && status_error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      status_error.value() != ERROR_FILE_NOT_FOUND && status_error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取进度文件状态失败");
  }
  status_error.clear();
  if (file_status.type() == std::filesystem::file_type::not_found) {
    return app::Result::success("进度文件尚不存在");
  }
  if (std::filesystem::is_symlink(file_status) ||
      !std::filesystem::is_regular_file(file_status)) {
    return app::Result::failure("进度文件类型无效");
  }
  std::ifstream input(path, std::ios::binary);
  if (!input) return app::Result::failure("打开进度文件失败");
  std::error_code size_error;
  if (const auto size = std::filesystem::file_size(path, size_error);
      size_error || size > kMaxProgressFileBytes) {
    return app::Result::failure("进度文件超过大小上限");
  }
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxProgressLineBytes) return app::Result::failure("进度记录超过大小上限");
    ProgressFact fact;
    if (!parse_line(line, fact)) return app::Result::failure("进度文件存在损坏记录");
    facts.push_back(std::move(fact));
  }
  return input.eof() ? app::Result::success("进度已读取")
                    : app::Result::failure("读取进度失败");
}

}  // namespace

app::Result validate_progress_fact(const ProgressFact& fact) {
  if (!safe_identifier(fact.fact_id, 96) || !safe_identifier(fact.content_id, 128) || !safe_identifier(fact.exercise_id, 128)) return app::Result::failure("进度标识无效");
  if (fact.at.size() != 10 || fact.at[4] != '-' || fact.at[7] != '-') return app::Result::failure("进度日期无效");
  for (size_t index = 0; index < fact.at.size(); ++index) if (index != 4 && index != 7 && !std::isdigit(static_cast<unsigned char>(fact.at[index]))) return app::Result::failure("进度日期无效");
  int year_value = 0; int month_value = 0; int day_value = 0;
  const auto parse_part = [](std::string_view value, int& output) {
    const auto parsed = std::from_chars(value.data(), value.data() + value.size(), output);
    return parsed.ec == std::errc{} && parsed.ptr == value.data() + value.size();
  };
  if (!parse_part(std::string_view(fact.at).substr(0, 4), year_value) ||
      !parse_part(std::string_view(fact.at).substr(5, 2), month_value) ||
      !parse_part(std::string_view(fact.at).substr(8, 2), day_value)) {
    return app::Result::failure("进度日期无效");
  }
  using namespace std::chrono;
  const year_month_day date{std::chrono::year{year_value}, month{static_cast<unsigned>(month_value)}, day{static_cast<unsigned>(day_value)}};
  if (!date.ok() || year_value < 2000 || year_value > 2100) return app::Result::failure("进度日期无效");
  if (fact.status != "started" && fact.status != "completed" && fact.status != "review") return app::Result::failure("进度状态不受支持");
  if (!is_operation_id(fact.operation_id)) return app::Result::failure("进度 operationId 无效");
  return app::Result::success("进度事实有效");
}

ProgressStore::ProgressStore(std::filesystem::path data_root) : data_root_(std::move(data_root)) {}

std::filesystem::path ProgressStore::path() const { return data_root_ / "learning" / "progress.v1.log"; }
std::filesystem::path ProgressStore::index_path() const { return data_root_ / "learning" / "progress-index.v1"; }

app::Result ProgressStore::read_all(std::vector<ProgressFact>& facts) const {
  std::lock_guard lock(mutex_);
  const auto result = read_all_unlocked(path(), data_root_, facts);
  if (!result.ok) return result;
  auto parsed = [](std::string_view line, std::string& operation_id) {
    ProgressFact fact;
    if (!parse_line(line, fact)) return false;
    operation_id = std::move(fact.operation_id);
    return true;
  };
  const auto indexed = operation_index::load_or_rebuild(index_path(), path(), data_root_,
      kMaxProgressFileBytes, kMaxProgressLineBytes, kMaxProgressRecords, parsed,
      index_snapshot_);
  index_ready_ = indexed.ok;
  return indexed;
}

app::Result ProgressStore::remove_operation(std::string_view operation_id) {
  std::lock_guard lock(mutex_);
  if (!is_operation_id(operation_id)) return app::Result::failure("补偿 operationId 无效");
  std::vector<ProgressFact> facts;
  const auto loaded = read_all_unlocked(path(), data_root_, facts);
  if (!loaded.ok) return loaded;
  const auto old_size = facts.size();
  facts.erase(std::remove_if(facts.begin(), facts.end(), [operation_id](const auto& item) {
    return item.operation_id == operation_id;
  }), facts.end());
  if (facts.size() == old_size) return app::Result::success("没有需要补偿的进度");
  index_ready_ = false;
  const auto index_cleared = operation_index::clear(index_path(), data_root_);
  if (!index_cleared.ok) return index_cleared;
  if (facts.empty()) {
    std::error_code error;
    if (!std::filesystem::remove(path(), error) && error) return app::Result::failure("删除补偿进度失败");
    return app::Result::success("进度补偿已完成");
  }
  if (has_symlink_component(path().parent_path())) return app::Result::failure("进度目录路径不能经过符号链接");
  const auto destination = path();
  const auto temporary = temporary_path(destination);
  std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
  if (!output) return app::Result::failure("创建进度补偿文件失败");
  for (const auto& item : facts) output << encode_hex(item.fact_id) << '\t' << encode_hex(item.content_id) << '\t'
      << encode_hex(item.exercise_id) << '\t' << encode_hex(item.at) << '\t' << encode_hex(item.status) << '\t'
      << encode_hex(item.operation_id) << '\n';
  output.flush();
  if (!output) { std::error_code ignored; std::filesystem::remove(temporary, ignored); return app::Result::failure("写入进度补偿文件失败"); }
  output.close();
  std::error_code error;
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), destination.wstring().c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
    error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
#else
  std::filesystem::rename(temporary, destination, error);
#endif
  if (error) { std::error_code ignored; std::filesystem::remove(temporary, ignored); return app::Result::failure("提交进度补偿失败"); }
  return app::Result::success("进度补偿已完成");
}

app::Result ProgressStore::append_idempotent(const ProgressFact& fact, bool& duplicate) {
  std::lock_guard lock(mutex_);
  duplicate = false;
  const auto valid = validate_progress_fact(fact);
  if (!valid.ok) return valid;
  if (data_root_.empty() || !data_root_.is_absolute()) {
    return app::Result::failure("进度数据根必须是绝对路径");
  }
  const auto recovered = recover_pending(path(), data_root_);
  if (!recovered.ok) return recovered;
  auto parsed = [](std::string_view line, std::string& operation_id) {
    ProgressFact existing;
    if (!parse_line(line, existing)) return false;
    operation_id = std::move(existing.operation_id);
    return true;
  };
  const auto index_status = operation_index::load_or_rebuild(index_path(), path(), data_root_,
      kMaxProgressFileBytes, kMaxProgressLineBytes, kMaxProgressRecords, parsed,
      index_snapshot_);
  if (!index_status.ok) return index_status;
  index_ready_ = true;
  operation_index::Entry entry;
  bool found = false;
  auto indexed = operation_index::find(index_path(), fact.operation_id, index_snapshot_, entry, found);
  if (!indexed.ok) {
    const auto rebuilt = operation_index::rebuild(index_path(), path(), data_root_,
        kMaxProgressFileBytes, kMaxProgressLineBytes, kMaxProgressRecords, parsed,
        index_snapshot_);
    if (!rebuilt.ok) return rebuilt;
    indexed = operation_index::find(index_path(), fact.operation_id, index_snapshot_, entry, found);
    if (!indexed.ok) return indexed;
  }
  if (found) {
    std::string line;
    const auto read = operation_index::read_entry(path(), entry, line);
    ProgressFact existing;
    if (!read.ok || !parse_line(line, existing) || existing.operation_id != fact.operation_id) {
      index_ready_ = false;
      const auto rebuilt = operation_index::rebuild(index_path(), path(), data_root_,
          kMaxProgressFileBytes, kMaxProgressLineBytes, kMaxProgressRecords, parsed,
          index_snapshot_);
      if (!rebuilt.ok) return rebuilt;
      indexed = operation_index::find(index_path(), fact.operation_id, index_snapshot_, entry, found);
      if (!indexed.ok || !found) return app::Result::failure("进度 operation 索引与账本不一致");
      const auto reread = operation_index::read_entry(path(), entry, line);
      if (!reread.ok || !parse_line(line, existing) || existing.operation_id != fact.operation_id) {
        return app::Result::failure("进度 operation 索引重建后仍不一致");
      }
    }
    if (existing.fact_id == fact.fact_id && existing.content_id == fact.content_id &&
        existing.exercise_id == fact.exercise_id && existing.at == fact.at &&
        existing.status == fact.status) {
      duplicate = true;
      return app::Result::success("重复进度提交已忽略");
    }
    return app::Result::failure("operationId 已用于不同进度事实");
  }
  if (index_snapshot_.record_count >= kMaxProgressRecords) {
    return app::Result::failure("进度记录数量超过上限");
  }
  if (has_symlink_component(path().parent_path())) return app::Result::failure("进度目录路径不能经过符号链接");
  std::error_code error;
  std::filesystem::create_directories(path().parent_path(), error);
  if (error) return app::Result::failure("创建进度目录失败");
  const auto destination = path();
  const auto destination_status = std::filesystem::symlink_status(destination, error);
  if (!error && (std::filesystem::is_symlink(destination_status) ||
      !std::filesystem::is_regular_file(destination_status))) {
    return app::Result::failure("进度账本文件类型无效");
  }
  error.clear();
  std::uintmax_t base_size = 0;
  if (std::filesystem::exists(destination, error)) {
    base_size = std::filesystem::file_size(destination, error);
    if (error) return app::Result::failure("读取进度账本大小失败");
  }
  const auto line = serialize(fact) + '\n';
  if (line.size() > kMaxProgressLineBytes || base_size > kMaxProgressFileBytes - line.size()) {
    return app::Result::failure("进度账本超过大小上限");
  }
  const auto transaction = write_pending_transaction(destination, base_size, line);
  if (!transaction.ok) return transaction;
  const auto appended = append_durable(destination, line);
  if (!appended.ok) return appended;
  index_snapshot_.ledger_size = base_size + line.size();
  const auto indexed_append = operation_index::append(index_path(), destination, data_root_,
      {fact.operation_id, base_size, line.size()}, index_snapshot_);
  if (!indexed_append.ok) index_ready_ = false;
  else index_ready_ = true;
  std::filesystem::remove(pending_path(destination), error);
  if (error) return app::Result::failure("清理进度追加事务失败");
  return app::Result::success("进度已追加保存");
}

}  // namespace codeweave::learning
