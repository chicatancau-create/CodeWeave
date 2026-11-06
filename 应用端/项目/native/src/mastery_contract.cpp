#include "mastery_contract.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>

namespace codeweave::learning {
namespace {

constexpr int kMaximumMasteryLevel = 6;

bool safe_identifier(std::string_view value, std::size_t maximum) {
  return !value.empty() && value.size() <= maximum &&
      std::isalnum(static_cast<unsigned char>(value.front())) != 0 &&
      std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return std::isalnum(c) != 0 || c == '-' || c == '_' || c == '.';
      });
}

bool valid_utf8(std::string_view value) {
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

bool valid_timestamp(std::string_view value) {
  if ((value.size() != 20 && (value.size() < 22 || value[value.size() - 1] != 'Z')) ||
      value[4] != '-' || value[7] != '-' || value[10] != 'T' ||
      value[13] != ':' || value[16] != ':' || (value.back() != 'Z' && value.back() != 'z')) return false;
  if (value.size() > 20) {
    if (value[19] != '.') return false;
    for (std::size_t index = 20; index + 1 < value.size(); ++index) {
      if (value[index] < '0' || value[index] > '9') return false;
    }
  }
  int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  const auto parse = [](std::string_view part, int& out) {
    const auto result = std::from_chars(part.data(), part.data() + part.size(), out);
    return result.ec == std::errc{} && result.ptr == part.data() + part.size();
  };
  if (!parse(value.substr(0, 4), year) || !parse(value.substr(5, 2), month) ||
      !parse(value.substr(8, 2), day) || !parse(value.substr(11, 2), hour) ||
      !parse(value.substr(14, 2), minute) || !parse(value.substr(17, 2), second)) return false;
  using namespace std::chrono;
  return year >= 2000 && year <= 2100 &&
      year_month_day{std::chrono::year{year}, std::chrono::month{static_cast<unsigned>(month)},
      std::chrono::day{static_cast<unsigned>(day)}}.ok() && hour < 24 && minute < 60 && second < 60;
}

bool valid_kind(MasteryEvidenceKind kind) {
  return kind == MasteryEvidenceKind::Lesson || kind == MasteryEvidenceKind::Challenge ||
      kind == MasteryEvidenceKind::Review || kind == MasteryEvidenceKind::Bugfix ||
      kind == MasteryEvidenceKind::Snooze;
}

}  // namespace

app::Result validate_mastery_evidence(const MasteryEvidence& evidence) {
  if (!safe_identifier(evidence.id, 96) || !safe_identifier(evidence.ref_id, 128)) {
    return app::Result::failure("掌握度证据标识无效");
  }
  if (!valid_kind(evidence.kind) || !valid_timestamp(evidence.at) ||
      evidence.note.size() > 4000 || !valid_utf8(evidence.note)) {
    return app::Result::failure("掌握度证据字段无效");
  }
  if (evidence.verification != CompletionVerification::AutoVerified &&
      evidence.verification != CompletionVerification::SelfDeclared) {
    return app::Result::failure("完成验证来源无效");
  }
  if (evidence.ran_by != RanBy::Learner && evidence.ran_by != RanBy::Assistant &&
      evidence.ran_by != RanBy::Unknown) {
    return app::Result::failure("掌握度执行者无效");
  }
  if (evidence.hint_level != "L1" && evidence.hint_level != "L2" &&
      evidence.hint_level != "L3" && evidence.hint_level != "L4") {
    return app::Result::failure("掌握度提示等级无效");
  }
  if (!is_operation_id(evidence.operation_id)) {
    return app::Result::failure("掌握度 operationId 无效");
  }
  if (evidence.independent && (evidence.ran_by != RanBy::Learner ||
      evidence.hint_level == "L3" || evidence.hint_level == "L4")) {
    return app::Result::failure("独立掌握度证据不符合学习者资格");
  }
  if (evidence.kind == MasteryEvidenceKind::Snooze && evidence.passed) {
    return app::Result::failure("延期复习事件不能标记为通过");
  }
  return app::Result::success("掌握度证据有效");
}

bool mastery_eligible(const MasteryEvidence& evidence) {
  return evidence.passed && evidence.independent && evidence.ran_by == RanBy::Learner &&
      (evidence.hint_level == "L1" || evidence.hint_level == "L2");
}

app::Result apply_mastery_evidence(const MasteryRecord* record,
    const MasteryEvidence& evidence, std::size_t plan_length, MasteryRecord& output) {
  const auto valid = validate_mastery_evidence(evidence);
  if (!valid.ok) return valid;
  if (record && (record->level < 0 || record->level > kMaximumMasteryLevel)) {
    return app::Result::failure("现有掌握等级超出范围");
  }
  output = record ? *record : MasteryRecord{evidence.ref_id, evidence.kind, 0, {}, evidence.at};
  if (output.ref_id != evidence.ref_id) return app::Result::failure("掌握度记录引用不匹配");
  output.evidence.push_back(evidence);
  output.kind = evidence.kind;
  output.updated_at = evidence.at;
  if (evidence.kind == MasteryEvidenceKind::Snooze) {
    // Snooze is an auditable scheduling event; it never changes mastery.
  } else if (evidence.passed && mastery_eligible(evidence)) {
    output.level = std::min(kMaximumMasteryLevel, output.level + 1);
    if (evidence.kind == MasteryEvidenceKind::Review) {
      output.review_step = std::min(plan_length, output.review_step + 1);
      output.review_due_key.clear();
    }
  } else if (!evidence.passed && evidence.kind == MasteryEvidenceKind::Review &&
      evidence.ran_by == RanBy::Learner &&
      (evidence.hint_level == "L1" || evidence.hint_level == "L2")) {
    output.level = std::max(0, output.level - 1);
  }
  return app::Result::success("掌握度已更新");
}

}  // namespace codeweave::learning
