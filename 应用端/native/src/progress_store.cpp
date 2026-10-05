#include "progress_store.hpp"

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

app::Result read_all_unlocked(const std::filesystem::path& path,
    const std::filesystem::path& data_root, std::vector<ProgressFact>& facts) {
  facts.clear();
  if (data_root.empty() || !data_root.is_absolute()) {
    return app::Result::failure("进度数据根必须是绝对路径");
  }
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

app::Result ProgressStore::read_all(std::vector<ProgressFact>& facts) const {
  std::lock_guard lock(mutex_);
  return read_all_unlocked(path(), data_root_, facts);
}

app::Result ProgressStore::append_idempotent(const ProgressFact& fact, bool& duplicate) {
  std::lock_guard lock(mutex_);
  duplicate = false;
  const auto valid = validate_progress_fact(fact);
  if (!valid.ok) return valid;
  std::vector<ProgressFact> facts;
  const auto loaded = read_all_unlocked(path(), data_root_, facts);
  if (!loaded.ok) return loaded;
  for (const auto& existing : facts) {
    if (existing.operation_id != fact.operation_id) continue;
    if (existing.fact_id == fact.fact_id && existing.content_id == fact.content_id &&
        existing.exercise_id == fact.exercise_id && existing.at == fact.at && existing.status == fact.status) {
      duplicate = true;
      return app::Result::success("重复进度提交已忽略");
    }
    return app::Result::failure("operationId 已用于不同进度事实");
  }
  if (facts.size() >= kMaxProgressRecords) {
    return app::Result::failure("进度记录数量超过上限");
  }
  if (has_symlink_component(path().parent_path())) return app::Result::failure("进度目录路径不能经过符号链接");
  facts.push_back(fact);
  std::error_code error;
  std::filesystem::create_directories(path().parent_path(), error);
  if (error) return app::Result::failure("创建进度目录失败");
  const auto destination = path();
  const auto temporary = temporary_path(destination);
  std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
  if (!output) return app::Result::failure("无法创建进度文件");
  for (const auto& item : facts) output << encode_hex(item.fact_id) << '\t' << encode_hex(item.content_id) << '\t'
      << encode_hex(item.exercise_id) << '\t' << encode_hex(item.at) << '\t' << encode_hex(item.status) << '\t'
      << encode_hex(item.operation_id) << '\n';
  output.flush();
  const auto pending_size = output.tellp();
  if (pending_size < 0 || static_cast<std::uintmax_t>(pending_size) > kMaxProgressFileBytes) {
    output.close();
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("进度文件超过大小上限");
  }
  if (!output) { std::error_code ignored; std::filesystem::remove(temporary, ignored); return app::Result::failure("写入进度失败"); }
  output.close();
#ifdef _WIN32
  const auto temporary_handle = CreateFileW(
      temporary.wstring().c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (temporary_handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(temporary_handle)) {
    if (temporary_handle != INVALID_HANDLE_VALUE) CloseHandle(temporary_handle);
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("刷盘进度文件失败");
  }
  CloseHandle(temporary_handle);
#endif
  std::error_code rename_error;
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), destination.wstring().c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) rename_error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
#else
  std::filesystem::rename(temporary, destination, rename_error);
#endif
  if (rename_error) { std::error_code ignored; std::filesystem::remove(temporary, ignored); return app::Result::failure("提交进度失败"); }
  return app::Result::success("进度已保存");
}

}  // namespace codeweave::learning
