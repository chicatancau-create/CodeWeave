#include "evidence_store.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <fstream>
#include <random>
#include <sstream>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::learning {
namespace {

constexpr std::uintmax_t kMaxEvidenceFileBytes = 32 * 1024 * 1024;
constexpr std::size_t kMaxEvidenceLineBytes = 256 * 1024;
constexpr std::size_t kMaxEvidenceRecords = 100'000;

std::string hex_encode(std::string_view value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(value.size() * 2);
  for (const unsigned char character : value) { result.push_back(digits[character >> 4]); result.push_back(digits[character & 15]); }
  return result;
}

bool hex_decode(std::string_view value, std::string& result) {
  if (value.size() % 2) return false;
  result.clear(); result.reserve(value.size() / 2);
  for (size_t i = 0; i < value.size(); i += 2) {
    const auto digit = [](char c) -> int { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1; };
    const int high = digit(value[i]), low = digit(value[i + 1]);
    if (high < 0 || low < 0) return false;
    result.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

std::string actor(RanBy value) { return value == RanBy::Learner ? "learner" : value == RanBy::Assistant ? "assistant" : "unknown"; }
bool parse_actor(std::string_view value, RanBy& out) { if (value == "learner") out = RanBy::Learner; else if (value == "assistant") out = RanBy::Assistant; else if (value == "unknown") out = RanBy::Unknown; else return false; return true; }
std::string state(EvidenceState value) { return value == EvidenceState::Pending ? "pending" : value == EvidenceState::Synced ? "synced" : "partial"; }
bool parse_state(std::string_view value, EvidenceState& out) { if (value == "pending") out = EvidenceState::Pending; else if (value == "synced") out = EvidenceState::Synced; else if (value == "partial") out = EvidenceState::Partial; else return false; return true; }

std::string serialize(const EvidenceRecord& record) {
  std::vector<std::string> fields;
  const auto add = [&fields](std::string_view value) { fields.push_back(hex_encode(value)); };
  add(record.evidence_id); add(record.content_id); add(record.exercise_id); add(record.at); add(record.expected_result); add(record.actual_result); add(actor(record.ran_by)); add(record.independent ? "1" : "0"); add(record.hint_level); add(state(record.state)); add(record.operation_id);
  add(std::to_string(record.artifact_refs.size()));
  for (const auto& value : record.artifact_refs) add(value);
  add(std::to_string(record.unfinished_items.size()));
  for (const auto& value : record.unfinished_items) add(value);
  std::ostringstream out;
  for (size_t index = 0; index < fields.size(); ++index) { if (index) out << '\t'; out << fields[index]; }
  return out.str();
}

bool same_record(const EvidenceRecord& left, const EvidenceRecord& right) {
  return left.evidence_id == right.evidence_id && left.content_id == right.content_id &&
      left.exercise_id == right.exercise_id && left.at == right.at &&
      left.expected_result == right.expected_result && left.actual_result == right.actual_result &&
      left.ran_by == right.ran_by && left.independent == right.independent &&
      left.hint_level == right.hint_level && left.artifact_refs == right.artifact_refs &&
      left.unfinished_items == right.unfinished_items && left.state == right.state &&
      left.operation_id == right.operation_id;
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

bool parse(std::string_view line, EvidenceRecord& record) {
  std::vector<std::string_view> fields; size_t start = 0;
  while (start <= line.size()) { const auto end = line.find('\t', start); fields.push_back(line.substr(start, end == std::string_view::npos ? line.size() - start : end - start)); if (end == std::string_view::npos) break; start = end + 1; }
  if (fields.size() < 13) return false;
  std::vector<std::string> decoded(11); for (size_t i = 0; i < decoded.size(); ++i) if (!hex_decode(fields[i], decoded[i])) return false;
  record.evidence_id = decoded[0]; record.content_id = decoded[1]; record.exercise_id = decoded[2]; record.at = decoded[3]; record.expected_result = decoded[4]; record.actual_result = decoded[5];
  if (!parse_actor(decoded[6], record.ran_by) || (decoded[7] != "0" && decoded[7] != "1") || !parse_state(decoded[9], record.state)) return false;
  record.independent = decoded[7] == "1"; record.hint_level = decoded[8]; record.operation_id = decoded[10];
  size_t index = 11; std::string count_text; if (!hex_decode(fields[index++], count_text)) return false; size_t count = 0; auto parsed = std::from_chars(count_text.data(), count_text.data() + count_text.size(), count); if (parsed.ec != std::errc{} || parsed.ptr != count_text.data() + count_text.size() || count > 20 || fields.size() < index + count + 1) return false;
  record.artifact_refs.clear(); for (size_t i = 0; i < count; ++i) { std::string value; if (!hex_decode(fields[index++], value)) return false; record.artifact_refs.push_back(std::move(value)); }
  if (!hex_decode(fields[index++], count_text)) return false; count = 0; parsed = std::from_chars(count_text.data(), count_text.data() + count_text.size(), count); if (parsed.ec != std::errc{} || parsed.ptr != count_text.data() + count_text.size() || count > 20 || fields.size() != index + count) return false;
  record.unfinished_items.clear(); for (size_t i = 0; i < count; ++i) { std::string value; if (!hex_decode(fields[index++], value)) return false; record.unfinished_items.push_back(std::move(value)); }
  return validate_evidence(record).ok;
}

app::Result read_all_unlocked(const std::filesystem::path& path,
    const std::filesystem::path& data_root, std::vector<EvidenceRecord>& records) {
  records.clear();
  if (data_root.empty() || !data_root.is_absolute()) {
    return app::Result::failure("证据数据根必须是绝对路径");
  }
  std::error_code status_error;
  const auto file_status = std::filesystem::symlink_status(path, status_error);
  if (status_error && status_error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      status_error.value() != ERROR_FILE_NOT_FOUND && status_error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取证据账本状态失败");
  }
  status_error.clear();
  if (file_status.type() == std::filesystem::file_type::not_found) {
    return app::Result::success("证据账本为空");
  }
  if (std::filesystem::is_symlink(file_status) ||
      !std::filesystem::is_regular_file(file_status)) {
    return app::Result::failure("证据账本文件类型无效");
  }
  std::ifstream input(path, std::ios::binary);
  if (!input) return app::Result::failure("打开证据账本失败");
  std::error_code size_error;
  if (const auto size = std::filesystem::file_size(path, size_error);
      size_error || size > kMaxEvidenceFileBytes) {
    return app::Result::failure("证据账本超过大小上限");
  }
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxEvidenceLineBytes) return app::Result::failure("证据记录超过大小上限");
    EvidenceRecord record;
    if (!parse(line, record)) return app::Result::failure("证据账本存在损坏记录");
    records.push_back(std::move(record));
  }
  return input.eof() ? app::Result::success("证据账本已读取")
                    : app::Result::failure("读取证据账本失败");
}

}  // namespace

EvidenceStore::EvidenceStore(std::filesystem::path data_root) : data_root_(std::move(data_root)) {}
std::filesystem::path EvidenceStore::path() const { return data_root_ / "learning" / "evidence.v1.log"; }

app::Result EvidenceStore::read_all(std::vector<EvidenceRecord>& records) const {
  std::lock_guard lock(mutex_);
  return read_all_unlocked(path(), data_root_, records);
}

app::Result EvidenceStore::append_idempotent(const EvidenceRecord& record, bool& already_present) {
  std::lock_guard lock(mutex_);
  already_present = false; if (!validate_evidence(record).ok) return app::Result::failure("证据记录无效");
  std::vector<EvidenceRecord> records;
  const auto read = read_all_unlocked(path(), data_root_, records);
  if (!read.ok) return read;
  const auto found = std::find_if(records.begin(), records.end(), [&record](const auto& item) { return item.operation_id == record.operation_id; });
  if (found != records.end()) {
    if (!same_record(*found, record)) return app::Result::failure("operationId 已用于不同证据");
    already_present = true;
    return app::Result::success("重复 operationId 已幂等忽略");
  }
  if (data_root_.empty() || !data_root_.is_absolute()) {
    return app::Result::failure("证据数据根必须是绝对路径");
  }
  if (records.size() >= kMaxEvidenceRecords) {
    return app::Result::failure("证据记录数量超过上限");
  }
  if (has_symlink_component(path().parent_path())) return app::Result::failure("证据目录路径不能经过符号链接");
  records.push_back(record); std::error_code error; std::filesystem::create_directories(path().parent_path(), error); if (error) return app::Result::failure("创建证据目录失败");
  auto temporary = path();
  temporary += ".tmp." + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "." + std::to_string(std::random_device{}());
  { std::ofstream output(temporary, std::ios::binary | std::ios::trunc); if (!output) return app::Result::failure("创建证据临时文件失败"); for (const auto& item : records) output << serialize(item) << '\n'; output.flush(); if (!output) return app::Result::failure("写入证据账本失败"); }
  std::error_code size_error;
  if (std::filesystem::file_size(temporary, size_error) > kMaxEvidenceFileBytes || size_error) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("证据账本超过大小上限");
  }
#ifdef _WIN32
  const auto temporary_handle = CreateFileW(
      temporary.wstring().c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (temporary_handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(temporary_handle)) {
    if (temporary_handle != INVALID_HANDLE_VALUE) CloseHandle(temporary_handle);
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("刷盘证据账本失败");
  }
  CloseHandle(temporary_handle);
#endif
  app::Result committed = app::Result::success();
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), path().wstring().c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    committed = app::Result::failure("提交证据账本失败");
  }
#else
  std::filesystem::rename(temporary, path(), error);
  if (error) committed = app::Result::failure("提交证据账本失败");
#endif
  if (!committed.ok) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return committed;
  }
  return app::Result::success("证据已保存");
}

}  // namespace codeweave::learning
