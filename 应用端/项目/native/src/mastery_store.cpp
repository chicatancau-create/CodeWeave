#include "mastery_store.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>
#include <fstream>
#include <random>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::learning {
namespace {

constexpr std::uintmax_t kMaxFileBytes = 16 * 1024 * 1024;
constexpr std::size_t kMaxLineBytes = 128 * 1024;
constexpr std::size_t kMaxRecords = 100'000;

std::filesystem::path pending_path(const std::filesystem::path& destination) {
  return destination.string() + ".append.txn";
}

std::filesystem::path temporary_path(const std::filesystem::path& destination) {
  return destination.string() + ".tmp." +
      std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "." +
      std::to_string(std::random_device{}());
}

std::string encode_hex(std::string_view value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string encoded;
  encoded.reserve(value.size() * 2);
  for (const unsigned char byte : value) {
    encoded.push_back(digits[byte >> 4]);
    encoded.push_back(digits[byte & 0x0f]);
  }
  return encoded;
}

bool decode_hex(std::string_view value, std::string& output) {
  if (value.size() % 2 != 0) return false;
  const auto digit = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  output.clear();
  output.reserve(value.size() / 2);
  for (std::size_t index = 0; index < value.size(); index += 2) {
    const int high = digit(value[index]);
    const int low = digit(value[index + 1]);
    if (high < 0 || low < 0) return false;
    output.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

std::string kind_text(MasteryEvidenceKind kind) {
  switch (kind) {
    case MasteryEvidenceKind::Lesson: return "lesson";
    case MasteryEvidenceKind::Challenge: return "challenge";
    case MasteryEvidenceKind::Review: return "review";
    case MasteryEvidenceKind::Bugfix: return "bugfix";
    case MasteryEvidenceKind::Snooze: return "snooze";
  }
  return {};
}

bool parse_kind(std::string_view value, MasteryEvidenceKind& kind) {
  if (value == "lesson") kind = MasteryEvidenceKind::Lesson;
  else if (value == "challenge") kind = MasteryEvidenceKind::Challenge;
  else if (value == "review") kind = MasteryEvidenceKind::Review;
  else if (value == "bugfix") kind = MasteryEvidenceKind::Bugfix;
  else if (value == "snooze") kind = MasteryEvidenceKind::Snooze;
  else return false;
  return true;
}

std::string verification_text(CompletionVerification value) {
  return value == CompletionVerification::AutoVerified ? "auto-verified" : "self-declared";
}

bool parse_verification(std::string_view value, CompletionVerification& output) {
  if (value == "auto-verified") output = CompletionVerification::AutoVerified;
  else if (value == "self-declared") output = CompletionVerification::SelfDeclared;
  else return false;
  return true;
}

std::string ran_by_text(RanBy value) {
  if (value == RanBy::Learner) return "Learner";
  if (value == RanBy::Assistant) return "Assistant";
  return "Unknown";
}

bool parse_ran_by(std::string_view value, RanBy& output) {
  if (value == "Learner") output = RanBy::Learner;
  else if (value == "Assistant") output = RanBy::Assistant;
  else if (value == "Unknown") output = RanBy::Unknown;
  else return false;
  return true;
}

bool safe_identifier(std::string_view value, std::size_t maximum) {
  return !value.empty() && value.size() <= maximum &&
      std::isalnum(static_cast<unsigned char>(value.front())) != 0 &&
      std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return std::isalnum(c) != 0 || c == '-' || c == '_' || c == '.';
      });
}

bool is_missing_error(const std::error_code& error) {
  return error == std::make_error_code(std::errc::no_such_file_or_directory) ||
#ifdef _WIN32
      error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND;
#else
      false;
#endif
}

bool has_symlink_component(const std::filesystem::path& value) {
  auto current = std::filesystem::path{};
  std::error_code error;
  for (const auto& component : value) {
    current /= component;
    if (current == value.root_name() || current == value.root_path()) continue;
    const auto status = std::filesystem::symlink_status(current, error);
    if (!error && std::filesystem::is_symlink(status)) return true;
    if (is_missing_error(error)) {
      error.clear();
      continue;
    }
    if (error) return true;
  }
  return false;
}

std::string serialize(const MasteryEvidence& evidence) {
  const auto scalar = [](bool value) { return value ? "1" : "0"; };
  return encode_hex("1") + '\t' + encode_hex(evidence.operation_id) + '\t' +
      encode_hex(evidence.id) + '\t' + encode_hex(evidence.ref_id) + '\t' +
      encode_hex(kind_text(evidence.kind)) + '\t' + encode_hex(scalar(evidence.passed)) + '\t' +
      encode_hex(verification_text(evidence.verification)) + '\t' + encode_hex(ran_by_text(evidence.ran_by)) + '\t' +
      encode_hex(scalar(evidence.independent)) + '\t' + encode_hex(evidence.hint_level) + '\t' +
      encode_hex(evidence.at) + '\t' + encode_hex(evidence.note);
}

bool parse_line(std::string_view line, MasteryEvidence& output) {
  if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
  std::vector<std::string_view> fields;
  std::size_t start = 0;
  while (start <= line.size()) {
    const auto end = line.find('\t', start);
    fields.push_back(line.substr(start, end == std::string_view::npos ? line.size() - start : end - start));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  if (fields.size() != 12) return false;
  std::string values[12];
  for (std::size_t index = 0; index < 12; ++index) {
    if (!decode_hex(fields[index], values[index])) return false;
  }
  if (values[0] != "1" || !parse_kind(values[4], output.kind) ||
      !parse_verification(values[6], output.verification) || !parse_ran_by(values[7], output.ran_by) ||
      (values[5] != "0" && values[5] != "1") || (values[8] != "0" && values[8] != "1")) return false;
  output.operation_id = values[1];
  output.id = values[2];
  output.ref_id = values[3];
  output.passed = values[5] == "1";
  output.independent = values[8] == "1";
  output.hint_level = values[9];
  output.at = values[10];
  output.note = values[11];
  return validate_mastery_evidence(output).ok;
}

bool same_evidence(const MasteryEvidence& left, const MasteryEvidence& right) {
  return serialize(left) == serialize(right);
}

app::Result append_durable(const std::filesystem::path& destination, std::string_view line) {
  std::ofstream output(destination, std::ios::binary | std::ios::app);
  if (!output) return app::Result::failure("打开掌握度账本追加流失败");
  output.write(line.data(), static_cast<std::streamsize>(line.size()));
  output.flush();
  if (!output) return app::Result::failure("追加掌握度账本失败");
  output.close();
#ifdef _WIN32
  const auto handle = CreateFileW(destination.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(handle)) {
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    return app::Result::failure("刷盘掌握度账本失败");
  }
  CloseHandle(handle);
#endif
  return app::Result::success("掌握度账本已追加");
}

app::Result write_pending(const std::filesystem::path& destination,
    std::uintmax_t base_size, std::string_view line) {
  const auto pending = pending_path(destination);
  const auto temporary = temporary_path(pending);
  const auto body = std::to_string(base_size) + "\n" + encode_hex(line);
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return app::Result::failure("创建掌握度追加事务失败");
    output.write(body.data(), static_cast<std::streamsize>(body.size()));
    output.flush();
    if (!output) return app::Result::failure("写入掌握度追加事务失败");
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
  if (error) return app::Result::failure("提交掌握度追加事务失败");
  return app::Result::success("掌握度追加事务已记录");
}

app::Result recover_pending(const std::filesystem::path& destination,
    const std::filesystem::path& data_root) {
  const auto pending = pending_path(destination);
  std::error_code error;
  const auto status = std::filesystem::symlink_status(pending, error);
  if (is_missing_error(error)) return app::Result::success();
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status) ||
      has_symlink_component(destination.parent_path())) {
    return app::Result::failure("掌握度追加事务路径无效");
  }
  std::ifstream input(pending, std::ios::binary);
  if (!input) return app::Result::failure("打开掌握度追加事务失败");
  const auto size = std::filesystem::file_size(pending, error);
  if (error || size > kMaxLineBytes * 2) return app::Result::failure("掌握度追加事务超过大小上限");
  std::string body(static_cast<std::size_t>(size), '\0');
  input.read(body.data(), static_cast<std::streamsize>(body.size()));
  if (!input && !input.eof()) return app::Result::failure("读取掌握度追加事务失败");
  input.close();
  if (input.fail()) return app::Result::failure("关闭掌握度追加事务失败");
  const auto separator = body.find('\n');
  if (separator == std::string::npos) return app::Result::failure("掌握度追加事务格式无效");
  std::uintmax_t base_size{};
  const auto parsed = std::from_chars(body.data(), body.data() + separator, base_size);
  std::string line;
  if (parsed.ec != std::errc{} || parsed.ptr != body.data() + separator ||
      !decode_hex(std::string_view(body).substr(separator + 1), line) || line.empty() ||
      line.size() > kMaxLineBytes || data_root.empty() || !data_root.is_absolute()) {
    return app::Result::failure("掌握度追加事务内容无效");
  }
  std::uintmax_t current_size = 0;
  const auto destination_status = std::filesystem::symlink_status(destination, error);
  if (error && !is_missing_error(error)) {
    return app::Result::failure("读取掌握度账本状态失败");
  }
  if (!error && (std::filesystem::is_symlink(destination_status) ||
      !std::filesystem::is_regular_file(destination_status))) {
    return app::Result::failure("掌握度账本文件类型无效");
  }
  error.clear();
  if (std::filesystem::exists(destination, error)) {
    current_size = std::filesystem::file_size(destination, error);
    if (error) return app::Result::failure("读取掌握度账本大小失败");
  }
  if (current_size < base_size || current_size > base_size + line.size()) {
    return app::Result::failure("掌握度追加事务与账本长度不一致");
  }
  if (current_size != base_size) {
    std::ifstream ledger(destination, std::ios::binary);
    if (!ledger) return app::Result::failure("打开掌握度账本恢复尾部失败");
    ledger.seekg(static_cast<std::streamoff>(base_size), std::ios::beg);
    std::string tail(static_cast<std::size_t>(current_size - base_size), '\0');
    ledger.read(tail.data(), static_cast<std::streamsize>(tail.size()));
    if (!ledger && !ledger.eof()) return app::Result::failure("读取掌握度账本恢复尾部失败");
    if (tail != line) return app::Result::failure("掌握度追加事务尾部校验失败");
    std::error_code remove_error;
    if (!std::filesystem::remove(pending, remove_error) || remove_error) {
      return app::Result::failure("清理掌握度追加事务失败");
    }
    return app::Result::success("掌握度追加事务已恢复");
  }
  if (base_size > kMaxFileBytes - line.size()) return app::Result::failure("恢复后掌握度账本超过大小上限");
  const auto appended = append_durable(destination, line);
  if (!appended.ok) return appended;
  error.clear();
  if (!std::filesystem::remove(pending, error) || error) return app::Result::failure("清理掌握度追加事务失败");
  return app::Result::success("掌握度追加事务已恢复");
}

app::Result read_all_unlocked(const std::filesystem::path& path,
    const std::filesystem::path& data_root, std::vector<MasteryEvidence>& evidence) {
  evidence.clear();
  if (data_root.empty() || !data_root.is_absolute()) return app::Result::failure("掌握度数据根必须是绝对路径");
  const auto recovered = recover_pending(path, data_root);
  if (!recovered.ok) return recovered;
  std::error_code error;
  const auto status = std::filesystem::symlink_status(path, error);
  if (status.type() == std::filesystem::file_type::not_found) return app::Result::success("掌握度账本为空");
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
    return app::Result::failure("掌握度账本文件类型无效");
  }
  const auto size = std::filesystem::file_size(path, error);
  if (error || size > kMaxFileBytes) return app::Result::failure("掌握度账本超过大小上限");
  std::ifstream input(path, std::ios::binary);
  if (!input) return app::Result::failure("打开掌握度账本失败");
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxLineBytes) return app::Result::failure("掌握度记录超过大小上限");
    MasteryEvidence item;
    if (!parse_line(line, item)) return app::Result::failure("掌握度账本存在损坏记录");
    evidence.push_back(std::move(item));
    if (evidence.size() > kMaxRecords) return app::Result::failure("掌握度记录数量超过上限");
  }
  return input.eof() ? app::Result::success("掌握度已读取") : app::Result::failure("读取掌握度失败");
}

}  // namespace

MasteryStore::MasteryStore(std::filesystem::path data_root) : data_root_(std::move(data_root)) {}

std::filesystem::path MasteryStore::path() const { return data_root_ / "learning" / "mastery.v1.log"; }

app::Result MasteryStore::read_all(std::vector<MasteryEvidence>& evidence) const {
  std::lock_guard lock(mutex_);
  return read_all_unlocked(path(), data_root_, evidence);
}

app::Result MasteryStore::append_idempotent(const MasteryEvidence& evidence, bool& duplicate) {
  std::lock_guard lock(mutex_);
  duplicate = false;
  const auto valid = validate_mastery_evidence(evidence);
  if (!valid.ok) return valid;
  std::vector<MasteryEvidence> records;
  const auto loaded = read_all_unlocked(path(), data_root_, records);
  if (!loaded.ok) return loaded;
  for (const auto& existing : records) {
    if (existing.id == evidence.id && existing.operation_id != evidence.operation_id) {
      return app::Result::failure("掌握度证据 ID 已用于其他 operationId");
    }
    if (existing.operation_id != evidence.operation_id) continue;
    if (!same_evidence(existing, evidence)) return app::Result::failure("operationId 已用于不同掌握度证据");
    duplicate = true;
    return app::Result::success("重复掌握度提交已忽略");
  }
  if (records.size() >= kMaxRecords) return app::Result::failure("掌握度记录数量超过上限");
  if (data_root_.empty() || !data_root_.is_absolute() || has_symlink_component(path().parent_path())) {
    return app::Result::failure("掌握度目录路径无效");
  }
  std::error_code error;
  std::filesystem::create_directories(path().parent_path(), error);
  if (error) return app::Result::failure("创建掌握度目录失败");
  const auto status = std::filesystem::symlink_status(path(), error);
  if (error && !is_missing_error(error)) return app::Result::failure("读取掌握度账本状态失败");
  if (!error && (std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status))) {
    return app::Result::failure("掌握度账本文件类型无效");
  }
  error.clear();
  std::uintmax_t base_size = 0;
  if (std::filesystem::exists(path(), error)) {
    base_size = std::filesystem::file_size(path(), error);
    if (error) return app::Result::failure("读取掌握度账本大小失败");
  }
  const auto line = serialize(evidence) + '\n';
  if (line.size() > kMaxLineBytes || base_size > kMaxFileBytes - line.size()) {
    return app::Result::failure("掌握度账本超过大小上限");
  }
  const auto transaction = write_pending(path(), base_size, line);
  if (!transaction.ok) return transaction;
  const auto appended = append_durable(path(), line);
  if (!appended.ok) return appended;
  error.clear();
  if (!std::filesystem::remove(pending_path(path()), error) || error) {
    return app::Result::failure("清理掌握度追加事务失败");
  }
  return app::Result::success("掌握度已追加保存");
}

}  // namespace codeweave::learning
