#include "operation_index.hpp"

#include "learning_contract.hpp"

#include <array>
#include <charconv>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::learning::operation_index {
namespace {

constexpr std::string_view kHeader = "codeweave-operation-index-v1";
constexpr std::size_t kShardCount = 256;
constexpr std::size_t kMaxIndexBytes = 16 * 1024 * 1024;
constexpr std::uint64_t kFnvPrime = 1099511628211ull;

struct CachedIndex {
  Snapshot snapshot;
  std::unordered_map<std::string, Entry> entries;
  std::filesystem::file_time_type ledger_time{};
  std::filesystem::file_time_type metadata_time{};
};

std::mutex cache_mutex;
std::unordered_map<std::string, CachedIndex> cache;

std::string cache_key(const std::filesystem::path& index_dir) {
  return index_dir.lexically_normal().generic_string();
}

bool missing(const std::error_code& error) {
  if (error == std::make_error_code(std::errc::no_such_file_or_directory)) return true;
#ifdef _WIN32
  return error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND;
#else
  return false;
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
    if (missing(error)) {
      error.clear();
      continue;
    }
    if (error) return true;
  }
  return false;
}

bool valid_parent(const std::filesystem::path& path, const std::filesystem::path& data_root) {
  return path.is_absolute() && !data_root.empty() && data_root.is_absolute() &&
      !has_symlink_component(data_root) && !has_symlink_component(path.parent_path());
}

std::string hex_encode(std::string_view value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(value.size() * 2);
  for (const unsigned char byte : value) {
    result.push_back(digits[byte >> 4]);
    result.push_back(digits[byte & 15]);
  }
  return result;
}

bool hex_decode(std::string_view value, std::string& result) {
  if (value.size() % 2 != 0) return false;
  result.clear();
  result.reserve(value.size() / 2);
  const auto digit = [](char value) -> int {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
  };
  for (std::size_t index = 0; index < value.size(); index += 2) {
    const int high = digit(value[index]);
    const int low = digit(value[index + 1]);
    if (high < 0 || low < 0) return false;
    result.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

bool parse_uint(std::string_view text, std::uintmax_t& result) {
  if (text.empty()) return false;
  const auto parsed = std::from_chars(text.data(), text.data() + text.size(), result);
  return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size();
}

std::vector<std::string_view> split(std::string_view line) {
  std::vector<std::string_view> fields;
  std::size_t start = 0;
  while (start <= line.size()) {
    const auto end = line.find('\t', start);
    fields.push_back(line.substr(start,
        end == std::string_view::npos ? line.size() - start : end - start));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  return fields;
}

std::size_t shard_for(std::string_view operation_id) {
  std::uint32_t hash = 2166136261u;
  for (const unsigned char byte : operation_id) {
    hash ^= byte;
    hash *= 16777619u;
  }
  return static_cast<std::size_t>(hash & 0xffu);
}

std::filesystem::path metadata_path(const std::filesystem::path& index_dir) {
  return index_dir / "metadata.v1";
}

std::filesystem::path shard_path(const std::filesystem::path& index_dir, std::size_t shard) {
  char suffix[3]{};
  std::snprintf(suffix, sizeof(suffix), "%02x", static_cast<unsigned>(shard));
  return index_dir / (std::string("shard-") + suffix + ".v1");
}

std::filesystem::path temporary_path(const std::filesystem::path& destination) {
  return destination.string() + ".tmp." +
      std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
}

std::uint64_t fnv1a_update(std::uint64_t hash, std::string_view bytes) {
  for (const unsigned char byte : bytes) {
    hash ^= byte;
    hash *= kFnvPrime;
  }
  return hash;
}

app::Result fingerprint_ledger(const std::filesystem::path& ledger_path,
    std::uintmax_t expected_size, std::uint64_t& fingerprint) {
  std::ifstream input(ledger_path, std::ios::binary);
  if (!input) return app::Result::failure("打开 operation 索引账本校验流失败");
  std::array<char, 64 * 1024> buffer{};
  std::uintmax_t total = 0;
  auto hash = kFingerprintOffset;
  while (input) {
    input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const auto count = input.gcount();
    if (count <= 0) break;
    total += static_cast<std::uintmax_t>(count);
    hash = fnv1a_update(hash, std::string_view(buffer.data(), static_cast<std::size_t>(count)));
  }
  if (!input.eof() || total != expected_size) {
    return app::Result::failure("读取 operation 索引账本校验值失败");
  }
  fingerprint = hash;
  return app::Result::success();
}

app::Result read_ledger_size(const std::filesystem::path& ledger_path,
    std::uintmax_t& size, bool& exists) {
  std::error_code error;
  const auto status = std::filesystem::symlink_status(ledger_path, error);
  if (missing(error) || status.type() == std::filesystem::file_type::not_found) {
    size = 0;
    exists = false;
    return app::Result::success();
  }
  if (error) return app::Result::failure("读取 operation 索引账本状态失败");
  if (std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
    return app::Result::failure("operation 索引账本文件类型无效");
  }
  size = std::filesystem::file_size(ledger_path, error);
  if (error) return app::Result::failure("读取 operation 索引账本大小失败");
  exists = true;
  return app::Result::success();
}

app::Result parse_metadata(const std::filesystem::path& index_dir,
    std::uintmax_t ledger_size, std::uint64_t ledger_fingerprint,
    std::size_t& record_count) {
  std::error_code error;
  const auto path = metadata_path(index_dir);
  const auto status = std::filesystem::symlink_status(path, error);
  if (missing(error)) return app::Result::failure("operation 索引元数据缺失");
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
    return app::Result::failure("operation 索引元数据类型无效");
  }
  const auto size = std::filesystem::file_size(path, error);
  if (error || size > 1024) return app::Result::failure("operation 索引元数据大小无效");
  std::ifstream input(path, std::ios::binary);
  std::string line(static_cast<std::size_t>(size), '\0');
  input.read(line.data(), static_cast<std::streamsize>(line.size()));
  if (!input && !input.eof()) return app::Result::failure("读取 operation 索引元数据失败");
  if (!line.empty() && line.back() == '\n') line.pop_back();
  const auto fields = split(line);
  std::uintmax_t declared_size = 0;
  std::uintmax_t declared_count = 0;
  std::uintmax_t declared_fingerprint = 0;
  if (fields.size() != 4 || fields[0] != kHeader || !parse_uint(fields[1], declared_size) ||
      !parse_uint(fields[2], declared_count) || !parse_uint(fields[3], declared_fingerprint) ||
      declared_size != ledger_size || declared_fingerprint != ledger_fingerprint ||
      declared_count > 100'000) {
    return app::Result::failure("operation 索引元数据内容无效");
  }
  record_count = static_cast<std::size_t>(declared_count);
  return app::Result::success();
}

app::Result validate_shards(const std::filesystem::path& index_dir,
    std::uintmax_t ledger_size, std::size_t expected_count) {
  std::unordered_set<std::string> operation_ids;
  operation_ids.reserve(expected_count);
  std::size_t total = 0;
  for (std::size_t shard = 0; shard < kShardCount; ++shard) {
    const auto path = shard_path(index_dir, shard);
    std::error_code error;
    const auto status = std::filesystem::symlink_status(path, error);
    if (missing(error)) continue;
    if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
      return app::Result::failure("operation 索引分片类型无效");
    }
    const auto size = std::filesystem::file_size(path, error);
    if (error || size > kMaxIndexBytes) return app::Result::failure("operation 索引分片过大");
    std::ifstream input(path, std::ios::binary);
    std::string line;
    while (std::getline(input, line)) {
      const auto fields = split(line);
      std::string operation_id;
      std::uintmax_t offset = 0;
      std::uintmax_t length = 0;
      if (fields.size() != 3 || !hex_decode(fields[0], operation_id) ||
          !is_operation_id(operation_id) || shard_for(operation_id) != shard ||
          !parse_uint(fields[1], offset) || !parse_uint(fields[2], length) || length == 0 ||
          offset + length < offset || offset + length > ledger_size ||
          !operation_ids.insert(operation_id).second) {
        return app::Result::failure("operation 索引分片记录无效");
      }
      if (++total > expected_count) return app::Result::failure("operation 索引记录数量无效");
    }
    if (!input.eof()) return app::Result::failure("读取 operation 索引分片失败");
  }
  return total == expected_count ? app::Result::success("operation 索引已验证")
                                 : app::Result::failure("operation 索引记录数量不一致");
}

app::Result write_atomic(const std::filesystem::path& destination,
    const std::filesystem::path& data_root, std::string_view body) {
  if (!valid_parent(destination, data_root)) return app::Result::failure("operation 索引路径无效");
  const auto temporary = temporary_path(destination);
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return app::Result::failure("创建 operation 索引临时文件失败");
    output.write(body.data(), static_cast<std::streamsize>(body.size()));
    output.flush();
    if (!output) {
      std::error_code ignored;
      std::filesystem::remove(temporary, ignored);
      return app::Result::failure("写入 operation 索引临时文件失败");
    }
  }
#ifdef _WIN32
  const auto handle = CreateFileW(temporary.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(handle)) {
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("刷盘 operation 索引失败");
  }
  CloseHandle(handle);
#endif
  std::error_code error;
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), destination.wstring().c_str(),
      MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
  }
#else
  std::filesystem::rename(temporary, destination, error);
#endif
  if (error) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("提交 operation 索引失败");
  }
  return app::Result::success();
}

app::Result write_metadata(const std::filesystem::path& index_dir,
    const std::filesystem::path& data_root, const Snapshot& snapshot) {
  const auto body = std::string(kHeader) + '\t' + std::to_string(snapshot.ledger_size) + '\t' +
      std::to_string(snapshot.record_count) + '\t' +
      std::to_string(snapshot.ledger_fingerprint) + '\n';
  return write_atomic(metadata_path(index_dir), data_root, body);
}

}  // namespace

app::Result load_or_rebuild(const std::filesystem::path& index_dir,
    const std::filesystem::path& ledger_path, const std::filesystem::path& data_root,
    std::uintmax_t max_ledger_bytes, std::size_t max_line_bytes,
    std::size_t max_records, const ParseOperation& parse_operation, Snapshot& snapshot) {
  std::uintmax_t ledger_size = 0;
  bool exists = false;
  const auto sized = read_ledger_size(ledger_path, ledger_size, exists);
  if (!sized.ok) return sized;
  if (ledger_size > max_ledger_bytes) return app::Result::failure("operation 索引账本超过大小上限");
  {
    std::lock_guard lock(cache_mutex);
    const auto cached = cache.find(cache_key(index_dir));
    if (cached != cache.end() && exists && cached->second.snapshot.ledger_size == ledger_size &&
        cached->second.snapshot.record_count <= max_records) {
      std::error_code ledger_time_error;
      std::error_code metadata_time_error;
      const auto ledger_time = std::filesystem::last_write_time(ledger_path, ledger_time_error);
      const auto metadata_time = std::filesystem::last_write_time(
          metadata_path(index_dir), metadata_time_error);
      if (!ledger_time_error && !metadata_time_error &&
          cached->second.ledger_time == ledger_time &&
          cached->second.metadata_time == metadata_time) {
        snapshot = cached->second.snapshot;
        return app::Result::success("operation 索引已从进程缓存读取");
      }
    }
  }
  if (!exists || ledger_size == 0) {
    snapshot = {};
    return clear(index_dir, data_root);
  }
  std::uint64_t ledger_fingerprint = 0;
  const auto fingerprinted = fingerprint_ledger(ledger_path, ledger_size, ledger_fingerprint);
  if (!fingerprinted.ok) return fingerprinted;
  std::size_t count = 0;
  const auto metadata = parse_metadata(index_dir, ledger_size, ledger_fingerprint, count);
  const auto shards = metadata.ok ? validate_shards(index_dir, ledger_size, count) :
      app::Result::failure("operation 索引元数据无效");
  if (metadata.ok && shards.ok) {
    snapshot = {ledger_size, count, ledger_fingerprint};
    CachedIndex loaded;
    std::error_code error;
    loaded.snapshot = snapshot;
    loaded.ledger_time = std::filesystem::last_write_time(ledger_path, error);
    if (error) return app::Result::failure("读取 operation 索引账本时间失败");
    loaded.metadata_time = std::filesystem::last_write_time(metadata_path(index_dir), error);
    if (error) return app::Result::failure("读取 operation 索引元数据时间失败");
    for (std::size_t shard = 0; shard < kShardCount; ++shard) {
      std::ifstream input(shard_path(index_dir, shard), std::ios::binary);
      if (!input) continue;
      std::string line;
      while (std::getline(input, line)) {
        const auto fields = split(line);
        std::string operation_id;
        std::uintmax_t offset = 0;
        std::uintmax_t length = 0;
        if (fields.size() != 3 || !hex_decode(fields[0], operation_id) ||
            !parse_uint(fields[1], offset) || !parse_uint(fields[2], length)) {
          return app::Result::failure("operation 索引分片重载失败");
        }
        loaded.entries.emplace(operation_id, Entry{operation_id, offset, length});
      }
      if (!input.eof()) return app::Result::failure("operation 索引分片重载失败");
    }
    {
      std::lock_guard lock(cache_mutex);
      cache[cache_key(index_dir)] = std::move(loaded);
    }
    return app::Result::success("operation 索引已读取");
  }
  return rebuild(index_dir, ledger_path, data_root, max_ledger_bytes, max_line_bytes,
      max_records, parse_operation, snapshot);
}

app::Result rebuild(const std::filesystem::path& index_dir,
    const std::filesystem::path& ledger_path, const std::filesystem::path& data_root,
    std::uintmax_t max_ledger_bytes, std::size_t max_line_bytes,
    std::size_t max_records, const ParseOperation& parse_operation, Snapshot& snapshot) {
  std::uintmax_t ledger_size = 0;
  bool exists = false;
  const auto sized = read_ledger_size(ledger_path, ledger_size, exists);
  if (!sized.ok) return sized;
  if (ledger_size > max_ledger_bytes) return app::Result::failure("重建 operation 索引时账本过大");
  if (!exists || ledger_size == 0) {
    snapshot = {};
    return clear(index_dir, data_root);
  }
  std::ifstream input(ledger_path, std::ios::binary);
  if (!input) return app::Result::failure("重建 operation 索引时无法打开账本");
  std::vector<std::vector<Entry>> entries(kShardCount);
  std::unordered_set<std::string> operation_ids;
  std::string line;
  std::uintmax_t offset = 0;
  std::size_t count = 0;
  auto ledger_fingerprint = kFingerprintOffset;
  while (std::getline(input, line)) {
    const auto next = input.tellg();
    const std::uintmax_t end = next < 0 ? ledger_size : static_cast<std::uintmax_t>(next);
    if (end < offset || end - offset > max_line_bytes + 1 || line.size() > max_line_bytes) {
      return app::Result::failure("重建 operation 索引时发现超长记录");
    }
    ledger_fingerprint = fnv1a_update(ledger_fingerprint, line);
    if (end - offset > line.size()) ledger_fingerprint = fnv1a_update(ledger_fingerprint, "\n");
    if (!line.empty()) {
      if (++count > max_records) return app::Result::failure("operation 索引记录数量超过上限");
      std::string operation_id;
      if (!parse_operation(line, operation_id) || !is_operation_id(operation_id) ||
          !operation_ids.insert(operation_id).second) {
        return app::Result::failure("重建 operation 索引时发现损坏或重复记录");
      }
      entries[shard_for(operation_id)].push_back({std::move(operation_id), offset, end - offset});
    }
    offset = end;
  }
  if (!input.eof() || offset != ledger_size) return app::Result::failure("重建 operation 索引读取账本失败");
  std::error_code error;
  if (!std::filesystem::create_directories(index_dir, error) && error) {
    return app::Result::failure("创建 operation 索引目录失败");
  }
  if (has_symlink_component(index_dir)) return app::Result::failure("operation 索引目录不能经过符号链接");
  for (std::size_t shard = 0; shard < kShardCount; ++shard) {
    const auto path = shard_path(index_dir, shard);
    if (entries[shard].empty()) {
      std::filesystem::remove(path, error);
      error.clear();
      continue;
    }
    std::string body;
    for (const auto& entry : entries[shard]) {
      body += hex_encode(entry.operation_id) + '\t' + std::to_string(entry.offset) + '\t' +
          std::to_string(entry.length) + '\n';
    }
    const auto saved = write_atomic(path, data_root, body);
    if (!saved.ok) return saved;
  }
  snapshot = {ledger_size, count, ledger_fingerprint};
  const auto metadata = write_metadata(index_dir, data_root, snapshot);
  if (!metadata.ok) return metadata;
  CachedIndex rebuilt;
  rebuilt.snapshot = snapshot;
  rebuilt.ledger_time = std::filesystem::last_write_time(ledger_path, error);
  if (error) return app::Result::failure("读取重建账本时间失败");
  rebuilt.metadata_time = std::filesystem::last_write_time(metadata_path(index_dir), error);
  if (error) return app::Result::failure("读取重建索引时间失败");
  for (const auto& shard_entries : entries) {
    for (const auto& entry : shard_entries) rebuilt.entries.emplace(entry.operation_id, entry);
  }
  {
    std::lock_guard lock(cache_mutex);
    cache[cache_key(index_dir)] = std::move(rebuilt);
  }
  return app::Result::success("operation 索引已重建");
}

app::Result find(const std::filesystem::path& index_dir, std::string_view operation_id,
    const Snapshot& snapshot, Entry& entry, bool& found) {
  found = false;
  if (!is_operation_id(operation_id)) return app::Result::failure("operationId 无效");
  {
    std::lock_guard lock(cache_mutex);
    const auto cached = cache.find(cache_key(index_dir));
    if (cached != cache.end() && cached->second.snapshot.ledger_size == snapshot.ledger_size &&
        cached->second.snapshot.ledger_fingerprint == snapshot.ledger_fingerprint) {
      const auto match = cached->second.entries.find(std::string(operation_id));
      if (match != cached->second.entries.end()) {
        entry = match->second;
        found = true;
      }
      return app::Result::success();
    }
  }
  const auto path = shard_path(index_dir, shard_for(operation_id));
  std::error_code error;
  const auto status = std::filesystem::symlink_status(path, error);
  if (missing(error)) return app::Result::success();
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
    return app::Result::failure("operation 索引分片类型无效");
  }
  std::ifstream input(path, std::ios::binary);
  std::string line;
  while (std::getline(input, line)) {
    const auto fields = split(line);
    std::string indexed_id;
    std::uintmax_t offset = 0;
    std::uintmax_t length = 0;
    if (fields.size() != 3 || !hex_decode(fields[0], indexed_id) ||
        !is_operation_id(indexed_id) || shard_for(indexed_id) != shard_for(operation_id) ||
        !parse_uint(fields[1], offset) || !parse_uint(fields[2], length) || length == 0 ||
        offset + length < offset || offset + length > snapshot.ledger_size) {
      return app::Result::failure("operation 索引记录无效");
    }
    if (indexed_id == operation_id) {
      entry = {std::move(indexed_id), offset, length};
      found = true;
      return app::Result::success();
    }
  }
  return input.eof() ? app::Result::success() : app::Result::failure("读取 operation 索引分片失败");
}

app::Result append(const std::filesystem::path& index_dir,
    const std::filesystem::path& ledger_path, const std::filesystem::path& data_root,
    const Entry& entry, Snapshot& snapshot) {
  if (!is_operation_id(entry.operation_id) || entry.length == 0 ||
      entry.offset + entry.length < entry.offset || entry.offset + entry.length > snapshot.ledger_size) {
    return app::Result::failure("operation 索引追加记录无效");
  }
  std::error_code error;
  if (!std::filesystem::create_directories(index_dir, error) && error) {
    return app::Result::failure("创建 operation 索引目录失败");
  }
  if (has_symlink_component(index_dir)) return app::Result::failure("operation 索引目录不能经过符号链接");
  const auto path = shard_path(index_dir, shard_for(entry.operation_id));
  const auto shard_status = std::filesystem::symlink_status(path, error);
  if (!missing(error) &&
      (error || std::filesystem::is_symlink(shard_status) ||
       !std::filesystem::is_regular_file(shard_status))) {
    return app::Result::failure("operation 索引分片类型无效");
  }
  error.clear();
  std::ofstream output(path, std::ios::binary | std::ios::app);
  if (!output) return app::Result::failure("打开 operation 索引分片失败");
  const auto line = hex_encode(entry.operation_id) + '\t' + std::to_string(entry.offset) + '\t' +
      std::to_string(entry.length) + '\n';
  output.write(line.data(), static_cast<std::streamsize>(line.size()));
  output.flush();
  if (!output) return app::Result::failure("追加 operation 索引分片失败");
  output.close();
  if (output.fail()) return app::Result::failure("关闭 operation 索引分片失败");
#ifdef _WIN32
  const auto handle = CreateFileW(path.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(handle)) {
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    return app::Result::failure("刷盘 operation 索引分片失败");
  }
  CloseHandle(handle);
#endif
  std::ifstream ledger(ledger_path, std::ios::binary);
  if (!ledger) return app::Result::failure("打开追加后 operation 索引账本失败");
  ledger.seekg(static_cast<std::streamoff>(entry.offset), std::ios::beg);
  std::string appended(static_cast<std::size_t>(entry.length), '\0');
  ledger.read(appended.data(), static_cast<std::streamsize>(appended.size()));
  if (ledger.gcount() != static_cast<std::streamsize>(appended.size())) {
    return app::Result::failure("读取追加后 operation 索引账本记录失败");
  }
  snapshot.ledger_fingerprint = fnv1a_update(snapshot.ledger_fingerprint, appended);
  ++snapshot.record_count;
  const auto metadata = write_metadata(index_dir, data_root, snapshot);
  if (!metadata.ok) {
    std::lock_guard lock(cache_mutex);
    cache.erase(cache_key(index_dir));
    return metadata;
  }
  std::error_code cache_error;
  {
    std::lock_guard lock(cache_mutex);
    auto& cached = cache[cache_key(index_dir)];
    cached.snapshot = snapshot;
    cached.entries[entry.operation_id] = entry;
    cached.ledger_time = std::filesystem::last_write_time(ledger_path, cache_error);
    if (cache_error) {
      cache.erase(cache_key(index_dir));
      return app::Result::failure("读取追加后账本时间失败");
    }
    cached.metadata_time = std::filesystem::last_write_time(metadata_path(index_dir), cache_error);
    if (cache_error) {
      cache.erase(cache_key(index_dir));
      return app::Result::failure("读取追加后索引时间失败");
    }
  }
  return app::Result::success();
}

app::Result clear(const std::filesystem::path& index_dir,
    const std::filesystem::path& data_root) {
  if (!index_dir.is_absolute() || data_root.empty() || !data_root.is_absolute() ||
      has_symlink_component(data_root) || has_symlink_component(index_dir.parent_path())) {
    return app::Result::failure("清理 operation 索引路径无效");
  }
  std::error_code error;
  const auto status = std::filesystem::symlink_status(index_dir, error);
  if (missing(error) || status.type() == std::filesystem::file_type::not_found) {
    std::lock_guard lock(cache_mutex);
    cache.erase(cache_key(index_dir));
    return app::Result::success();
  }
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_directory(status)) {
    return app::Result::failure("operation 索引目录类型无效");
  }
  std::filesystem::remove_all(index_dir, error);
  if (!error) {
    std::lock_guard lock(cache_mutex);
    cache.erase(cache_key(index_dir));
  }
  return error ? app::Result::failure("清理 operation 索引失败") : app::Result::success();
}

app::Result read_entry(const std::filesystem::path& ledger_path, const Entry& entry,
    std::string& line) {
  if (entry.length == 0 || entry.length > 1024 * 1024) {
    return app::Result::failure("operation 索引行长度无效");
  }
  std::ifstream input(ledger_path, std::ios::binary);
  if (!input) return app::Result::failure("打开 operation 索引目标记录失败");
  input.seekg(static_cast<std::streamoff>(entry.offset), std::ios::beg);
  if (!input) return app::Result::failure("定位 operation 索引目标记录失败");
  line.assign(static_cast<std::size_t>(entry.length), '\0');
  input.read(line.data(), static_cast<std::streamsize>(line.size()));
  if (input.gcount() != static_cast<std::streamsize>(line.size())) {
    return app::Result::failure("读取 operation 索引目标记录失败");
  }
  if (!line.empty() && line.back() == '\n') line.pop_back();
  if (!line.empty() && line.back() == '\r') line.pop_back();
  return app::Result::success();
}

}  // namespace codeweave::learning::operation_index
