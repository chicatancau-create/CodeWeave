#include "content_contract.hpp"

#include <algorithm>
#include <cctype>

namespace codeweave::content {
namespace {

bool is_hex(std::string_view value) {
  return !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return std::isxdigit(character) != 0;
  });
}

bool valid_utf8(std::string_view value) {
  for (std::size_t index = 0; index < value.size();) {
    const auto first = static_cast<unsigned char>(value[index]);
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
        (codepoint >= 0xD800 && codepoint <= 0xDFFF) || codepoint > 0x10FFFF) return false;
    index += width;
  }
  return true;
}

bool ascii_identifier(std::string_view value) {
  return !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return (character >= 'a' && character <= 'z') ||
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') || character == '-' ||
        character == '_' || character == '.';
  });
}

}  // namespace

bool is_stable_id(std::string_view value) {
  if (value.empty() || value.size() > 128) return false;
  return ascii_identifier(value);
}

bool is_content_hash(std::string_view value) {
  return value.size() == 64 && is_hex(value);
}

bool is_status(std::string_view value) {
  return value == "draft" || value == "published" || value == "retired";
}

app::Result validate(const Unit& unit) {
  if (!is_stable_id(unit.content_id)) return app::Result::failure("内容 ID 格式无效");
  if (unit.title.empty() || unit.title.size() > 512 || !valid_utf8(unit.title)) return app::Result::failure("内容标题编码或长度无效");
  if (!is_status(unit.status)) return app::Result::failure("内容状态不受支持");
  if (unit.language.empty() || unit.language.size() > 64 || !valid_utf8(unit.language)) return app::Result::failure("内容语言编码无效");
  if (!is_content_hash(unit.content_hash)) return app::Result::failure("内容 hash 格式无效");
  if (unit.schema_version != 1) return app::Result::failure("内容 schema 版本不受支持");
  return app::Result::success("内容单元有效");
}

app::Result validate(const Exercise& exercise) {
  if (!is_stable_id(exercise.content_id)) return app::Result::failure("练习内容 ID 格式无效");
  if (!is_stable_id(exercise.exercise_id)) return app::Result::failure("练习 ID 格式无效");
  if (exercise.expected_output.size() > 4000 || !valid_utf8(exercise.expected_output)) return app::Result::failure("练习预期输出编码或长度无效");
  if (exercise.hint_level != "L1" && exercise.hint_level != "L2" &&
      exercise.hint_level != "L3" && exercise.hint_level != "L4") {
    return app::Result::failure("练习提示等级无效");
  }
  return app::Result::success("练习有效");
}

}  // namespace codeweave::content
