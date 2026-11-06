#include "external_evidence_service.hpp"

#include <array>
#include <chrono>
#include <ctime>
#include <regex>
#include <sstream>

namespace codeweave::learning {
namespace {

bool whitespace(std::uint32_t cp) {
  return cp == 0x20 || (cp >= 9 && cp <= 13) || cp == 0xa0 || cp == 0x1680 ||
      (cp >= 0x2000 && cp <= 0x200a) || cp == 0x2028 || cp == 0x2029 ||
      cp == 0x202f || cp == 0x205f || cp == 0x3000 || cp == 0xfeff;
}

bool normalized(std::string_view input, std::string& output, std::size_t& length) {
  if (input.size() > 8192) return false;
  std::size_t begin = input.size(), end = 0, count = 0, trailing = 0;
  for (std::size_t at = 0; at < input.size();) {
    const auto start = at;
    const auto first = static_cast<unsigned char>(input[at++]);
    std::uint32_t cp = first;
    unsigned extra = 0;
    if (first < 0x80) {}
    else if (first >= 0xc2 && first <= 0xdf) { cp &= 0x1f; extra = 1; }
    else if (first >= 0xe0 && first <= 0xef) { cp &= 0xf; extra = 2; }
    else if (first >= 0xf0 && first <= 0xf4) { cp &= 7; extra = 3; }
    else return false;
    if (at + extra > input.size()) return false;
    for (unsigned i = 0; i < extra; ++i) {
      const auto next = static_cast<unsigned char>(input[at++]);
      if ((next & 0xc0) != 0x80) return false;
      cp = (cp << 6) | (next & 63);
    }
    if (cp == 0 || (extra == 1 && cp < 0x80) || (extra == 2 && cp < 0x800) ||
        (extra == 3 && cp < 0x10000) || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return false;
    const std::size_t units = cp > 0xffff ? 2 : 1;
    if (whitespace(cp)) { if (begin != input.size()) trailing += units; continue; }
    if (begin == input.size()) begin = start;
    count += trailing + units; trailing = 0; end = at;
  }
  output = begin < end ? std::string(input.substr(begin, end-begin)) : std::string{};
  length = count;
  return true;
}

bool contains_sensitive(std::string_view value) {
  static const std::array<std::regex, 6> patterns{
      std::regex(R"(-----BEGIN [A-Z ]*PRIVATE KEY-----)"),
      std::regex(R"(\b(?:password|passwd|pwd)\s*[:=]\s*\S+)", std::regex::icase),
      std::regex(R"(\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*\S+)", std::regex::icase),
      std::regex(R"(\bauthorization\s*:\s*bearer\s+\S+)", std::regex::icase),
      std::regex(R"(\b(?:cookie|set-cookie)\s*:\s*\S+)", std::regex::icase),
      std::regex(R"(\b(?:mysql|postgres(?:ql)?|mongodb|redis)://[^\s@]*:[^\s@]*@)", std::regex::icase)};
  for (const auto& pattern : patterns) if (std::regex_search(value.begin(), value.end(), pattern)) return true;
  return false;
}

bool reproduced_date(std::string_view text) {
  if (text.size() != 10 || text[4] != '-' || text[7] != '-') return false;
  for (std::size_t i = 0; i < text.size(); ++i) {
    if (i != 4 && i != 7 && (text[i] < '0' || text[i] > '9')) return false;
  }
  const int year = std::stoi(std::string(text.substr(0,4)));
  const unsigned month = static_cast<unsigned>(std::stoi(std::string(text.substr(5,2))));
  const unsigned day = static_cast<unsigned>(std::stoi(std::string(text.substr(8,2))));
  using namespace std::chrono;
  const year_month_day date{std::chrono::year{year}, std::chrono::month{month}, std::chrono::day{day}};
  if (!date.ok()) return false;
  const auto now = std::time(nullptr);
  std::tm local{};
#ifdef _WIN32
  if (localtime_s(&local, &now) != 0) return false;
#else
  if (!localtime_r(&now, &local)) return false;
#endif
  const year_month_day today{std::chrono::year{local.tm_year + 1900},
      std::chrono::month{static_cast<unsigned>(local.tm_mon+1)},
      std::chrono::day{static_cast<unsigned>(local.tm_mday)}};
  return sys_days{date} <= sys_days{today};
}
}  // namespace

app::Result save_external_evidence(EvidenceStore& store, std::string_view content_id,
    const ExternalEvidenceFields& fields, std::string_view operation_id,
    std::string_view evidence_id) {
  const std::array<std::string_view, 5> values{fields.environment, fields.command,
      fields.result_summary, fields.artifact_ref, fields.reproduced_on};
  std::array<std::string, 5> clean;
  std::size_t total = 0;
  for (std::size_t i = 0; i < values.size(); ++i) {
    std::size_t characters = 0;
    if (!normalized(values[i], clean[i], characters)) return app::Result::failure("外部证据字段编码无效");
    if (i != 3 && clean[i].empty()) return app::Result::failure("外部证据必填字段不能为空");
    if (characters > (i == 3 ? 300u : 600u)) return app::Result::failure("外部证据字段超过字符上限");
    if (contains_sensitive(clean[i])) return app::Result::failure("外部证据疑似包含凭据，请先脱敏");
    total += characters;
  }
  if (total < 20 || total > 2000) return app::Result::failure("外部证据合计需要 20–2000 个字符");
  if (!reproduced_date(clean[4])) return app::Result::failure("复现日期无效或晚于今天");
  const auto actual = "执行环境：" + clean[0] + "\n执行命令：" + clean[1] +
      "\n结果摘要：" + clean[2] + "\n复现日期：" + clean[4];
  EvidenceRecord evidence{std::string(evidence_id), std::string(content_id),
      std::string(kExternalEvidenceExerciseId), clean[4], "外部证据待人工确认",
      actual, RanBy::Learner, false, "L1",
      clean[3].empty() ? std::vector<std::string>{} : std::vector<std::string>{clean[3]},
      {"外部执行真实性和验收点尚未人工确认"}, EvidenceState::Pending, std::string(operation_id)};
  bool duplicate = false;
  const auto saved = store.append_idempotent(evidence, duplicate);
  if (!saved.ok) return saved;
  return app::Result::success(duplicate ? "该外部证据已提交，未重复写入"
      : "外部证据已提交待确认，未计入正式进度");
}

}  // namespace codeweave::learning
