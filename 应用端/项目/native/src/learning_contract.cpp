#include "learning_contract.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>
#include <optional>
#include <regex>
#include <string>
#include <system_error>

namespace codeweave::learning {
namespace {

bool safe_identifier(std::string_view value, size_t max_length) {
  if (value.empty() || value.size() > max_length) return false;
  return std::isalnum(static_cast<unsigned char>(value.front())) != 0 &&
      std::all_of(value.begin(), value.end(), [](unsigned char character) {
        return std::isalnum(character) != 0 || character == '-' || character == '_' || character == '.';
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

bool date_value(std::string_view value) {
  if (value.size() != 10 || value[4] != '-' || value[7] != '-') return false;
  for (size_t index = 0; index < value.size(); ++index) {
    if (index == 4 || index == 7) continue;
    if (!std::isdigit(static_cast<unsigned char>(value[index]))) return false;
  }
  int year = 0;
  int month = 0;
  int day = 0;
  if (std::from_chars(value.data(), value.data() + 4, year).ec != std::errc{} ||
      std::from_chars(value.data() + 5, value.data() + 7, month).ec != std::errc{} ||
      std::from_chars(value.data() + 8, value.data() + 10, day).ec != std::errc{}) {
    return false;
  }
  using namespace std::chrono;
  const year_month_day date{std::chrono::year{year}, std::chrono::month{static_cast<unsigned>(month)},
      std::chrono::day{static_cast<unsigned>(day)}};
  return date.ok();
}

bool valid_hint(std::string_view value) {
  return value == "L1" || value == "L2" || value == "L3" || value == "L4";
}

bool valid_state(EvidenceState state) {
  return state == EvidenceState::Pending || state == EvidenceState::Synced ||
      state == EvidenceState::Partial;
}

}  // namespace

MasteryLevel parse_mastery_level(std::string_view raw) {
  std::string text(raw);
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back()))) text.pop_back();
  constexpr std::string_view suffix = "级";
  if (text.size() < suffix.size() || text.compare(text.size() - suffix.size(), suffix.size(), suffix) != 0) {
    return {MasteryKind::Uncertain, 0, 0, 0, text.empty() ? "未填写" : text};
  }
  text.erase(text.size() - suffix.size());
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back()))) text.pop_back();
  const auto separator = [&text]() -> std::pair<size_t, size_t> {
    for (const std::string_view candidate : {"—", "–", "至", "-", "~"}) {
      const auto position = text.find(candidate);
      if (position != std::string::npos) return {position, candidate.size()};
    }
    return {std::string::npos, 0};
  }();
  const auto parse_number = [](std::string_view value) -> std::optional<int> {
    if (value.empty()) return std::nullopt;
    int result = 0;
    for (const unsigned char character : value) {
      if (std::isspace(character) != 0) continue;
      if (std::isdigit(character) == 0) return std::nullopt;
      const int digit = character - '0';
      if (result > (1000000 - digit) / 10) return std::nullopt;
      result = result * 10 + digit;
    }
    return result;
  };
  if (separator.first == std::string::npos) {
    if (const auto value = parse_number(text)) {
      return {MasteryKind::Numeric, *value, 0, 0, std::to_string(*value) + " 级"};
    }
  } else {
    const auto low = parse_number(std::string_view(text).substr(0, separator.first));
    const auto high = parse_number(std::string_view(text).substr(separator.first + separator.second));
    if (low && high && *low <= *high) {
      return {MasteryKind::Range, 0, *low, *high, std::to_string(*low) + "—" + std::to_string(*high) + " 级"};
    }
  }
  const std::string original(raw);
  return {MasteryKind::Uncertain, 0, 0, 0, original.empty() ? "未填写" : original};
}

bool is_operation_id(std::string_view value) {
  static const std::regex pattern(R"(^op-[a-z0-9]{6,20}-[0-9a-f]{6}$)");
  return std::regex_match(value.begin(), value.end(), pattern);
}

app::Result validate_evidence(const EvidenceRecord& record) {
  if (!safe_identifier(record.evidence_id, 96)) return app::Result::failure("证据 ID 格式无效");
  if (!safe_identifier(record.content_id, 128)) return app::Result::failure("证据内容 ID 格式无效");
  if (!record.exercise_id.empty() && !safe_identifier(record.exercise_id, 128)) {
    return app::Result::failure("证据练习 ID 格式无效");
  }
  if (!date_value(record.at)) return app::Result::failure("证据日期格式无效");
  if (record.expected_result.size() > 4000 || record.actual_result.size() > 8192 ||
      !valid_utf8_without_nul(record.expected_result) ||
      !valid_utf8_without_nul(record.actual_result)) {
    return app::Result::failure("证据结果过长");
  }
  if (record.ran_by == RanBy::Assistant && record.independent) {
    return app::Result::failure("AI 执行不能标记为学习者独立完成");
  }
  if (!valid_hint(record.hint_level)) return app::Result::failure("提示等级无效");
  if (record.independent && (record.hint_level == "L3" || record.hint_level == "L4")) {
    return app::Result::failure("L3/L4 提示下的作答不能标记为独立完成");
  }
  if (record.artifact_refs.size() > 20 || record.unfinished_items.size() > 20) {
    return app::Result::failure("证据列表条数超限");
  }
  for (const auto& artifact : record.artifact_refs) {
    if (artifact.empty() || artifact.size() > 900 || !valid_utf8_without_nul(artifact)) return app::Result::failure("产物引用无效");
  }
  for (const auto& item : record.unfinished_items) {
    if (item.empty() || item.size() > 300 || !valid_utf8_without_nul(item)) return app::Result::failure("未完成项无效");
  }
  if (!valid_state(record.state)) return app::Result::failure("证据状态无效");
  if (!is_operation_id(record.operation_id)) return app::Result::failure("证据 operationId 无效");
  return app::Result::success("证据记录有效");
}

}  // namespace codeweave::learning
