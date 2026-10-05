#include "account.hpp"

#include <algorithm>
#include <cctype>
#include <regex>

namespace codeweave::account {
namespace {

bool is_hex(std::string_view value, size_t expected) {
  if (value.size() != expected) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return std::isxdigit(character) != 0;
  });
}

bool valid_identifier(std::string_view value) {
  if (value.empty() || value.size() > 96) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return std::isalnum(character) != 0 || character == '-' || character == '_';
  });
}

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
    if ((width == 3 && codepoint < 0x800) || (width == 4 && codepoint < 0x10000) ||
        (codepoint >= 0xD800 && codepoint <= 0xDFFF) || codepoint > 0x10FFFF) return false;
    index += width;
  }
  return true;
}

}  // namespace

std::string normalized_phone(std::string_view value) {
  std::string result;
  result.reserve(value.size());
  for (const unsigned char character : value) {
    if (std::isdigit(character) != 0) result.push_back(static_cast<char>(character));
  }
  return result;
}

bool is_phone(std::string_view value) {
  const auto normalized = normalized_phone(value);
  return normalized.size() == 11 && normalized.front() == '1' &&
      normalized[1] >= '3' && normalized[1] <= '9';
}

bool is_email(std::string_view value) {
  static const std::regex pattern(R"(^[^\s@]+@[^\s@]+\.[^\s@]+$)", std::regex::ECMAScript);
  return !value.empty() && value.size() <= 320 && std::regex_match(value.begin(), value.end(), pattern);
}

bool is_supported_password_hash(std::string_view value) {
  constexpr std::string_view prefix = "scrypt$v1$";
  const auto body = value.starts_with(prefix) ? value.substr(prefix.size()) : value;
  const auto separator = body.find(':');
  if (separator == std::string_view::npos) return false;
  return is_hex(body.substr(0, separator), 32) && is_hex(body.substr(separator + 1), 128);
}

app::Result validate(const Record& record) {
  if (!valid_identifier(record.id)) return app::Result::failure("账户 ID 格式无效");
  if (record.name.empty() || record.name.size() > 128 || !valid_utf8_without_nul(record.name)) return app::Result::failure("账户名称长度或编码无效");
  if (record.email.empty() && record.phone.empty()) return app::Result::failure("账户缺少联系方式");
  if (!record.email.empty() && (!valid_utf8_without_nul(record.email) || !is_email(record.email))) return app::Result::failure("账户邮箱格式无效");
  if (!record.phone.empty() && !is_phone(record.phone)) return app::Result::failure("账户手机号格式无效");
  if (!is_supported_password_hash(record.password_hash)) return app::Result::failure("账户密码哈希格式不受支持");
  return app::Result::success("账户记录有效");
}

}  // namespace codeweave::account
