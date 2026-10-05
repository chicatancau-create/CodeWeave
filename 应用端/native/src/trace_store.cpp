#include "trace_store.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <fstream>
#include <random>
#include <sstream>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::execution {
namespace {

constexpr std::uintmax_t kMaxTraceFileBytes = 64 * 1024 * 1024;
constexpr std::size_t kMaxTraceLineBytes = 2 * 1024 * 1024;

std::string encode(std::string_view value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string out;
  out.reserve(value.size() * 2);
  for (const unsigned char c : value) {
    out.push_back(digits[c >> 4]);
    out.push_back(digits[c & 0x0f]);
  }
  return out;
}

bool decode(std::string_view value, std::string& out) {
  if (value.size() % 2) return false;
  out.clear();
  out.reserve(value.size() / 2);
  const auto digit = [](char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (std::size_t i = 0; i < value.size(); i += 2) {
    const auto hi = digit(value[i]); const auto lo = digit(value[i + 1]);
    if (hi < 0 || lo < 0) return false;
    out.push_back(static_cast<char>((hi << 4) | lo));
  }
  return true;
}

std::string kind(EventKind kind) {
  switch (kind) {
    case EventKind::Started: return "started";
    case EventKind::Output: return "output";
    case EventKind::Paused: return "paused";
    case EventKind::Resumed: return "resumed";
    case EventKind::Completed: return "completed";
    case EventKind::Failed: return "failed";
    case EventKind::Cancelled: return "cancelled";
  }
  return {};
}

bool parse_kind(std::string_view value, EventKind& out) {
  if (value == "started") out = EventKind::Started;
  else if (value == "output") out = EventKind::Output;
  else if (value == "paused") out = EventKind::Paused;
  else if (value == "resumed") out = EventKind::Resumed;
  else if (value == "completed") out = EventKind::Completed;
  else if (value == "failed") out = EventKind::Failed;
  else if (value == "cancelled") out = EventKind::Cancelled;
  else return false;
  return true;
}

bool parse_line(std::string_view line, TraceEvent& event) {
  std::array<std::string_view, 4> fields{};
  std::size_t start = 0;
  for (std::size_t i = 0; i < fields.size(); ++i) {
    const auto end = line.find('\t', start);
    fields[i] = line.substr(start, end == std::string_view::npos ? line.size() - start : end - start);
    if (end == std::string_view::npos) {
      if (i + 1 != fields.size()) return false;
      break;
    }
    if (i + 1 == fields.size()) return false;
    start = end + 1;
  }
  std::string sequence;
  std::string kind_text;
  std::string session;
  std::string payload;
  if (!decode(fields[0], sequence) || !decode(fields[1], kind_text) ||
      !decode(fields[2], session) || !decode(fields[3], payload)) return false;
  std::uint64_t value = 0;
  const auto parsed = std::from_chars(sequence.data(), sequence.data() + sequence.size(), value);
  EventKind event_kind{};
  if (parsed.ec != std::errc{} || parsed.ptr != sequence.data() + sequence.size() ||
      !parse_kind(kind_text, event_kind) || session.empty()) return false;
  event = {value, event_kind, std::move(session), std::move(payload)};
  return true;
}

std::filesystem::path temporary_path(const std::filesystem::path& destination) {
  auto result = destination;
  result += ".tmp." +
      std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "." +
      std::to_string(std::random_device{}());
  return result;
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

}  // namespace

TraceStore::TraceStore(std::filesystem::path data_root) : data_root_(std::move(data_root)) {}

std::filesystem::path TraceStore::path() const {
  return data_root_ / "execution" / "trace.v1.log";
}

app::Result TraceStore::append(const Trace& trace) {
  std::lock_guard lock(mutex_);
  if (data_root_.empty() || !data_root_.is_absolute()) {
    return app::Result::failure("轨迹数据根必须是绝对路径");
  }
  const auto& events = trace.events();
  if (events.empty()) return app::Result::failure("不能保存空轨迹");
  std::vector<TraceEvent> existing;
  std::error_code status_error;
  const auto file_status = std::filesystem::symlink_status(path(), status_error);
  if (status_error && status_error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      status_error.value() != ERROR_FILE_NOT_FOUND && status_error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取轨迹账本状态失败");
  }
  status_error.clear();
  if (file_status.type() != std::filesystem::file_type::not_found &&
      (std::filesystem::is_symlink(file_status) ||
       !std::filesystem::is_regular_file(file_status))) {
    return app::Result::failure("轨迹账本文件类型无效");
  }
  std::ifstream input(path(), std::ios::binary);
  if (file_status.type() != std::filesystem::file_type::not_found && !input) {
    return app::Result::failure("打开轨迹账本失败");
  }
  std::error_code size_error;
  const auto existing_size = std::filesystem::file_size(path(), size_error);
  if (input && (size_error || existing_size > kMaxTraceFileBytes)) {
    return app::Result::failure("轨迹账本超过大小上限");
  }
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxTraceLineBytes) return app::Result::failure("轨迹记录超过大小上限");
    TraceEvent event{};
    if (!parse_line(line, event)) return app::Result::failure("轨迹账本存在损坏记录");
    existing.push_back(std::move(event));
  }
  input.close();
  for (const auto& event : events) {
    const auto duplicate = std::find_if(existing.begin(), existing.end(),
        [&event](const auto& item) {
          return item.session_id == event.session_id && item.sequence == event.sequence;
        });
    if (duplicate != existing.end()) {
      if (duplicate->kind != event.kind || duplicate->payload != event.payload) {
        return app::Result::failure("轨迹序列号已用于不同事件");
      }
      continue;
    }
    existing.push_back(event);
  }
  if (existing.size() > kMaxTraceFileBytes / 32) {
    return app::Result::failure("轨迹事件数量超过上限");
  }
  if (has_symlink_component(path().parent_path())) return app::Result::failure("轨迹目录路径不能经过符号链接");
  std::sort(existing.begin(), existing.end(), [](const auto& left, const auto& right) {
    if (left.session_id != right.session_id) return left.session_id < right.session_id;
    return left.sequence < right.sequence;
  });
  std::error_code error;
  std::filesystem::create_directories(path().parent_path(), error);
  if (error) return app::Result::failure("创建轨迹目录失败");
  const auto temporary = temporary_path(path());
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return app::Result::failure("创建轨迹临时文件失败");
    for (const auto& event : existing) {
      output << encode(std::to_string(event.sequence)) << '\t' << encode(kind(event.kind)) << '\t'
             << encode(event.session_id) << '\t' << encode(event.payload) << '\n';
    }
    output.flush();
    if (!output) {
      std::filesystem::remove(temporary, error);
      return app::Result::failure("写入轨迹账本失败");
    }
  }
  std::error_code temporary_size_error;
  if (std::filesystem::file_size(temporary, temporary_size_error) > kMaxTraceFileBytes ||
      temporary_size_error) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("轨迹账本超过大小上限");
  }
#ifdef _WIN32
  const auto temporary_handle = CreateFileW(
      temporary.wstring().c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (temporary_handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(temporary_handle)) {
    if (temporary_handle != INVALID_HANDLE_VALUE) CloseHandle(temporary_handle);
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("刷盘轨迹账本失败");
  }
  CloseHandle(temporary_handle);
#endif
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), path().wstring().c_str(),
      MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    std::filesystem::remove(temporary, error);
    return app::Result::failure("提交轨迹账本失败");
  }
#else
  std::filesystem::rename(temporary, path(), error);
  if (error) return app::Result::failure("提交轨迹账本失败");
#endif
  return app::Result::success("轨迹已保存");
}

app::Result TraceStore::read_page(std::string_view session_id, std::size_t offset,
    std::size_t limit, TracePage& page) const {
  std::lock_guard lock(mutex_);
  page = {};
  if (session_id.empty() || limit == 0 || limit > 1024) {
    return app::Result::failure("轨迹分页参数无效");
  }
  if (data_root_.empty() || !data_root_.is_absolute()) {
    return app::Result::failure("轨迹数据根必须是绝对路径");
  }
  std::error_code status_error;
  const auto file_status = std::filesystem::symlink_status(path(), status_error);
  if (status_error && status_error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      status_error.value() != ERROR_FILE_NOT_FOUND && status_error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取轨迹账本状态失败");
  }
  status_error.clear();
  if (file_status.type() == std::filesystem::file_type::not_found) {
    return app::Result::success("轨迹分页已读取");
  }
  if (std::filesystem::is_symlink(file_status) ||
      !std::filesystem::is_regular_file(file_status)) {
    return app::Result::failure("轨迹账本文件类型无效");
  }
  std::ifstream input(path(), std::ios::binary);
  if (!input) return app::Result::failure("打开轨迹账本失败");
  std::error_code size_error;
  const auto trace_size = std::filesystem::file_size(path(), size_error);
  if (input && (size_error || trace_size > kMaxTraceFileBytes)) {
    return app::Result::failure("轨迹账本超过大小上限");
  }
  std::string line;
  TracePage pending;
  std::size_t matching = 0;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxTraceLineBytes) return app::Result::failure("轨迹记录超过大小上限");
    TraceEvent event{};
    if (!parse_line(line, event)) return app::Result::failure("轨迹账本存在损坏记录");
    if (event.session_id != session_id) continue;
    if (matching >= offset && pending.events.size() < limit) {
      pending.events.push_back(std::move(event));
    }
    ++matching;
  }
  if (input.bad()) return app::Result::failure("读取轨迹账本失败");
  pending.next_offset = offset >= matching ? matching : offset + pending.events.size();
  pending.end = pending.next_offset == matching;
  page = std::move(pending);
  return app::Result::success("轨迹分页已读取");
}

TraceSummary summarize_trace(const std::vector<TraceEvent>& events) {
  TraceSummary summary{};
  summary.event_count = events.size();
  if (!events.empty()) summary.session_id = events.front().session_id;
  for (const auto& event : events) {
    if (event.kind == EventKind::Output) summary.output_bytes += event.payload.size();
    if (event.kind == EventKind::Completed) summary.completed = true;
    if (event.kind == EventKind::Failed) summary.failed = true;
    if (event.kind == EventKind::Cancelled) summary.cancelled = true;
    if (event.kind == EventKind::Paused) summary.paused = true;
  }
  return summary;
}

}  // namespace codeweave::execution
