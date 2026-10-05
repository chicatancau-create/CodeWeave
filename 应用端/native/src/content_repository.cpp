#include "content_repository.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cctype>
#include <fstream>
#include <sstream>
#include <unordered_set>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

namespace codeweave::content {
namespace {

constexpr std::size_t kMaxCatalogBytes = 16 * 1024 * 1024;
constexpr std::size_t kMaxCatalogLineBytes = 256 * 1024;
constexpr std::size_t kMaxBodyBytes = 8 * 1024 * 1024;

bool valid_utf8_without_nul(std::string_view value) {
  for (std::size_t index = 0; index < value.size();) {
    const auto first = static_cast<unsigned char>(value[index]);
    if (first == 0) return false;
    if (first < 0x80) { ++index; continue; }
    std::size_t width = 0;
    std::uint32_t codepoint = 0;
    if (first >= 0xC2 && first <= 0xDF) { width = 2; codepoint = first & 0x1F; }
    else if (first >= 0xE0 && first <= 0xEF) { width = 3; codepoint = first & 0x0F; }
    else if (first >= 0xF0 && first <= 0xF4) { width = 4; codepoint = first & 0x07; }
    else return false;
    if (index + width > value.size()) return false;
    for (std::size_t offset = 1; offset < width; ++offset) {
      const auto next = static_cast<unsigned char>(value[index + offset]);
      if ((next & 0xC0) != 0x80) return false;
      codepoint = (codepoint << 6) | (next & 0x3F);
    }
    if ((width == 3 && codepoint < 0x800) ||
        (width == 4 && codepoint < 0x10000) ||
        (codepoint >= 0xD800 && codepoint <= 0xDFFF) || codepoint > 0x10FFFF) {
      return false;
    }
    index += width;
  }
  return true;
}

std::string sha256_bytes(std::string_view value) {
#ifdef _WIN32
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD object_size = 0;
  DWORD result_size = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) return {};
  bool ok = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
      reinterpret_cast<PUCHAR>(&object_size), sizeof(object_size), &result_size, 0) == 0;
  std::vector<unsigned char> object(object_size);
  std::array<unsigned char, 32> digest{};
  ok = ok && BCryptCreateHash(algorithm, &hash, object.data(), object_size, nullptr, 0, 0) == 0;
  if (ok) ok = BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
      static_cast<ULONG>(value.size()), 0) == 0;
  if (ok) ok = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) == 0;
  if (hash) BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (!ok) return {};
  constexpr char digits[] = "0123456789abcdef";
  std::string result; result.reserve(64);
  for (const auto byte : digest) { result.push_back(digits[byte >> 4]); result.push_back(digits[byte & 0x0f]); }
  return result;
#else
  (void)value; return {};
#endif
}

bool decode_hex(std::string_view value, std::string& output) {
  if (value.size() % 2 != 0) return false;
  output.clear(); output.reserve(value.size() / 2);
  const auto digit = [](char c) -> int { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1; };
  for (size_t i = 0; i < value.size(); i += 2) { const int high = digit(value[i]), low = digit(value[i + 1]); if (high < 0 || low < 0) return false; output.push_back(static_cast<char>((high << 4) | low)); }
  return true;
}

bool split_line(std::string_view line, std::vector<std::string_view>& fields) {
  fields.clear(); size_t start = 0;
  while (start <= line.size()) { const auto end = line.find('\t', start); fields.push_back(line.substr(start, end == std::string_view::npos ? line.size() - start : end - start)); if (end == std::string_view::npos) break; start = end + 1; }
  return fields.size() == 6;
}

bool safe_content_id(std::string_view value) {
  return !value.empty() && value.find("..") == std::string_view::npos &&
      value.find('/') == std::string_view::npos && value.find('\\') == std::string_view::npos;
}

bool parse_unit(std::string_view line, Unit& unit) {
  if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
  std::vector<std::string_view> fields; if (!split_line(line, fields)) return false;
  std::vector<std::string> values(6); for (size_t i = 0; i < values.size(); ++i) if (!decode_hex(fields[i], values[i])) return false;
  unit.schema_version = 0;
  const auto parsed = std::from_chars(values[5].data(), values[5].data() + values[5].size(), unit.schema_version);
  if (parsed.ec != std::errc{} || parsed.ptr != values[5].data() + values[5].size()) return false;
  unit.content_id = std::move(values[0]); unit.title = std::move(values[1]); unit.status = std::move(values[2]); unit.language = std::move(values[3]); unit.content_hash = std::move(values[4]);
  const auto valid = validate(unit);
  return valid.ok;
}

bool parse_exercise(std::string_view line, Exercise& exercise) {
  if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
  std::vector<std::string_view> fields;
  size_t start = 0;
  while (start <= line.size()) {
    const auto end = line.find('\t', start);
    fields.push_back(line.substr(start, end == std::string_view::npos ? line.size() - start : end - start));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  if (fields.size() != 4) return false;
  std::string values[4];
  for (size_t index = 0; index < 4; ++index) if (!decode_hex(fields[index], values[index])) return false;
  exercise = {std::move(values[0]), std::move(values[1]), std::move(values[2]), std::move(values[3])};
  return validate(exercise).ok;
}

}  // namespace

ContentRepository::ContentRepository(std::filesystem::path content_root) : content_root_(std::move(content_root)) {}

app::Result ContentRepository::list_published(std::vector<Unit>& units) const {
  units.clear();
  if (content_root_.empty() || !content_root_.is_absolute()) return app::Result::failure("内容根目录必须是绝对路径");
  std::error_code root_error;
  const auto root_status = std::filesystem::symlink_status(content_root_, root_error);
  if (root_error || std::filesystem::is_symlink(root_status) ||
      !std::filesystem::is_directory(root_status)) {
    return app::Result::failure("内容根目录类型无效");
  }
  std::error_code catalog_status_error;
  const auto catalog_status = std::filesystem::symlink_status(content_root_ / "catalog.v1.tsv",
      catalog_status_error);
  if (catalog_status_error || std::filesystem::is_symlink(catalog_status) ||
      !std::filesystem::is_regular_file(catalog_status)) {
    return app::Result::failure("内容清单文件类型无效");
  }
  std::ifstream input(content_root_ / "catalog.v1.tsv", std::ios::binary);
  if (!input) return app::Result::failure("内容清单不存在");
  std::error_code size_error;
  const auto catalog_size = std::filesystem::file_size(content_root_ / "catalog.v1.tsv", size_error);
  if (size_error || catalog_size > kMaxCatalogBytes) return app::Result::failure("内容清单超过大小上限");
  std::unordered_set<std::string> ids;
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxCatalogLineBytes) return app::Result::failure("内容清单记录超过大小上限");
    Unit unit; if (!parse_unit(line, unit)) return app::Result::failure("内容清单存在无效记录");
    if (unit.status != "published") continue;
    if (!ids.insert(unit.content_id).second) return app::Result::failure("内容 ID 重复");
    units.push_back(std::move(unit));
  }
  return input.eof() ? app::Result::success("已读取已发布内容清单") : app::Result::failure("读取内容清单失败");
}

app::Result ContentRepository::read_published(std::string_view content_id, LoadedUnit& unit) const {
  if (!safe_content_id(content_id)) return app::Result::failure("内容 ID 格式无效");
  std::vector<Unit> units; const auto listed = list_published(units); if (!listed.ok) return listed;
  const auto found = std::find_if(units.begin(), units.end(), [content_id](const auto& item) { return item.content_id == content_id; });
  if (found == units.end()) return app::Result::failure("未找到已发布内容");
  const auto body_path = content_root_ / (found->content_id + ".txt");
  std::error_code error;
  const auto body_status = std::filesystem::symlink_status(body_path, error);
  if (error || std::filesystem::is_symlink(body_status) ||
      !std::filesystem::is_regular_file(body_status)) {
    return app::Result::failure("内容正文文件类型无效");
  }
  const auto canonical_root = std::filesystem::weakly_canonical(content_root_, error); if (error) return app::Result::failure("内容根目录不可访问");
  const auto canonical_body = std::filesystem::weakly_canonical(body_path, error); if (error || canonical_body.parent_path() != canonical_root) return app::Result::failure("内容路径越界");
  std::ifstream body(canonical_body, std::ios::binary); if (!body) return app::Result::failure("内容正文不存在");
  std::string text((std::istreambuf_iterator<char>(body)), std::istreambuf_iterator<char>()); if (!body.eof() && body.fail()) return app::Result::failure("读取内容正文失败");
  if (text.size() > kMaxBodyBytes) return app::Result::failure("内容正文超过大小上限");
  if (!valid_utf8_without_nul(text)) return app::Result::failure("内容正文不是有效 UTF-8 文本");
  if (sha256_bytes(text) != found->content_hash) return app::Result::failure("内容正文 hash 校验失败");
  unit = {*found, std::move(text)};
  return app::Result::success("内容正文已读取");
}

app::Result ContentRepository::list_exercises(std::string_view content_id,
    std::vector<Exercise>& exercises) const {
  exercises.clear();
  std::vector<Unit> units;
  const auto listed = list_published(units);
  if (!listed.ok) return listed;
  if (std::none_of(units.begin(), units.end(), [content_id](const auto& unit) {
        return unit.content_id == content_id;
      })) return app::Result::failure("未找到已发布内容");
  const auto exercises_path = content_root_ / "exercises.v1.tsv";
  std::error_code exercise_status_error;
  const auto exercise_status = std::filesystem::symlink_status(exercises_path,
      exercise_status_error);
  if (exercise_status_error && exercise_status_error !=
      std::make_error_code(std::errc::no_such_file_or_directory)) {
    return app::Result::failure("练习清单状态不可读取");
  }
  if (!exercise_status_error && std::filesystem::is_symlink(exercise_status)) {
    return app::Result::failure("练习清单文件类型无效");
  }
  std::ifstream input(exercises_path, std::ios::binary);
  if (!input) {
    if (exercise_status_error && exercise_status_error != std::make_error_code(std::errc::no_such_file_or_directory)) {
      return app::Result::failure("练习清单状态不可读取");
    }
    return app::Result::success("该内容没有练习元数据");
  }
  if (exercise_status_error || std::filesystem::is_symlink(exercise_status) ||
      !std::filesystem::is_regular_file(exercise_status)) {
    return app::Result::failure("练习清单文件类型无效");
  }
  std::error_code size_error;
  const auto exercise_size = std::filesystem::file_size(content_root_ / "exercises.v1.tsv", size_error);
  if (size_error || exercise_size > kMaxCatalogBytes) return app::Result::failure("练习清单超过大小上限");
  std::unordered_set<std::string> ids;
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxCatalogLineBytes) return app::Result::failure("练习记录超过大小上限");
    Exercise exercise;
    if (!parse_exercise(line, exercise)) return app::Result::failure("练习清单存在无效记录");
    if (exercise.content_id != content_id) continue;
    if (!ids.insert(exercise.exercise_id).second) return app::Result::failure("练习 ID 重复");
    exercises.push_back(std::move(exercise));
  }
  return input.eof() ? app::Result::success("练习元数据已读取") : app::Result::failure("读取练习清单失败");
}

app::Result ContentRepository::read_hints(std::string_view content_id, std::string& hints) const {
  hints.clear();
  std::vector<Unit> units;
  const auto listed = list_published(units);
  if (!listed.ok) return listed;
  if (!safe_content_id(content_id) || std::none_of(units.begin(), units.end(),
      [content_id](const auto& unit) { return unit.content_id == content_id; })) {
    return app::Result::failure("未找到已发布内容");
  }
  std::error_code error;
  const auto manifest = content_root_ / "hints.v1.tsv";
  auto status = std::filesystem::symlink_status(manifest, error);
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
    return app::Result::failure("提示清单类型无效");
  }
  const auto size = std::filesystem::file_size(manifest, error);
  if (error || size > kMaxCatalogBytes) return app::Result::failure("提示清单过大");
  std::ifstream input(manifest, std::ios::binary);
  if (!input) return app::Result::failure("提示清单不可读取");
  std::string line, expected;
  std::unordered_set<std::string> ids;
  while (std::getline(input, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    const auto tab = line.find('\t');
    std::string id, digest;
    if (line.size() > kMaxCatalogLineBytes || tab == std::string::npos ||
        line.find('\t', tab + 1) != std::string::npos ||
        !decode_hex(std::string_view(line).substr(0, tab), id) ||
        !decode_hex(std::string_view(line).substr(tab + 1), digest) ||
        !is_stable_id(id) || !is_content_hash(digest) || !ids.insert(id).second) {
      return app::Result::failure("提示清单记录无效");
    }
    if (id == content_id) expected = std::move(digest);
  }
  if (!input.eof() || expected.empty()) return app::Result::failure("该课程没有提示");
  const auto directory = content_root_ / "hints";
  status = std::filesystem::symlink_status(directory, error);
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_directory(status)) {
    return app::Result::failure("提示目录类型无效");
  }
  const auto path = directory / (std::string(content_id) + ".txt");
  status = std::filesystem::symlink_status(path, error);
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
    return app::Result::failure("提示文件类型无效");
  }
  const auto body_size = std::filesystem::file_size(path, error);
  if (error || body_size > kMaxBodyBytes) return app::Result::failure("提示文件过大");
  std::ifstream body(path, std::ios::binary);
  if (!body) return app::Result::failure("提示不可读取");
  std::string text((std::istreambuf_iterator<char>(body)), std::istreambuf_iterator<char>());
  if (body.fail() || text.size() > kMaxBodyBytes || !valid_utf8_without_nul(text) ||
      sha256_bytes(text) != expected) return app::Result::failure("提示编码或 hash 校验失败");
  hints = std::move(text);
  return app::Result::success("已读取提示；本次尝试不计为独立完成");
}

app::Result ContentRepository::read_starter(std::string_view content_id,
    std::string& language, std::string& code, std::string& execution_policy) const {
  language.clear(); code.clear(); execution_policy.clear();
  std::vector<Unit> units;
  const auto listed = list_published(units);
  if (!listed.ok) return listed;
  const auto unit = std::find_if(units.begin(), units.end(), [content_id](const auto& item) {
    return item.content_id == content_id;
  });
  if (unit == units.end()) return app::Result::failure("未找到已发布内容");
  const auto read_row = [&](const char* name, std::size_t width,
      std::vector<std::string>& selected) -> app::Result {
    std::error_code error;
    const auto path = content_root_ / name;
    const auto status = std::filesystem::symlink_status(path, error);
    if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) {
      return app::Result::failure("课程配置文件类型无效");
    }
    const auto bytes = std::filesystem::file_size(path, error);
    if (error || bytes > kMaxCatalogBytes) return app::Result::failure("课程配置超过大小上限");
    std::ifstream input(path, std::ios::binary);
    if (!input) return app::Result::failure("课程配置不可读取");
    std::unordered_set<std::string> ids;
    std::string line;
    while (std::getline(input, line)) {
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (line.empty()) continue;
      if (line.size() > kMaxCatalogLineBytes) return app::Result::failure("课程配置记录过大");
      std::vector<std::string> values;
      std::size_t start = 0;
      while (start <= line.size()) {
        const auto end = line.find('\t', start);
        std::string value;
        if (!decode_hex(std::string_view(line).substr(start,
            end == std::string::npos ? line.size() - start : end - start), value) ||
            !valid_utf8_without_nul(value)) return app::Result::failure("课程配置编码无效");
        values.push_back(std::move(value));
        if (end == std::string::npos) break;
        start = end + 1;
      }
      if (values.size() != width || !is_stable_id(values[0]) ||
          !ids.insert(values[0]).second) return app::Result::failure("课程配置字段或 ID 无效");
      if (values[0] == content_id) selected = std::move(values);
    }
    if (!input.eof()) return app::Result::failure("读取课程配置失败");
    if (selected.empty()) return app::Result::failure("课程没有起始代码配置");
    return app::Result::success("课程配置已读取");
  };
  std::vector<std::string> starter, metadata;
  auto result = read_row("starter-code.v1.tsv", 3, starter);
  if (!result.ok) return result;
  result = read_row("metadata.v1.tsv", 6, metadata);
  if (!result.ok) return result;
  if (starter[1] != unit->language ||
      (metadata[3] != "native" && metadata[3] != "external")) {
    return app::Result::failure("课程运行配置与内容清单不一致");
  }
  language = std::move(starter[1]); code = std::move(starter[2]);
  execution_policy = std::move(metadata[3]);
  return app::Result::success("已读取起始代码与运行要求");
}

}  // namespace codeweave::content
