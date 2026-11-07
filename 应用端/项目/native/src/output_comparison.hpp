#pragma once

#include <algorithm>
#include <string>
#include <string_view>
#include <vector>

namespace codeweave::learning {

inline std::string_view trim_output(std::string_view value) {
  constexpr std::string_view whitespace = " \t\r\n";
  const auto first = value.find_first_not_of(whitespace);
  if (first == std::string_view::npos) return {};
  const auto last = value.find_last_not_of(whitespace);
  return value.substr(first, last - first + 1);
}

inline bool output_matches(std::string_view actual, std::string_view expected) {
  return trim_output(actual) == trim_output(expected);
}

struct OutputCase {
  std::string expected;
  bool matched{};
  std::string actual;
  std::string reason;
};

struct OutputJudgement {
  bool passed{};
  std::vector<OutputCase> cases;
  std::vector<std::string> extra_lines;
};

inline std::vector<std::string> output_lines(std::string_view output) {
  std::vector<std::string> lines;
  if (output.empty()) return lines;
  std::size_t start = 0;
  while (start < output.size()) {
    const auto end = output.find('\n', start);
    const auto length = end == std::string_view::npos ? output.size() - start : end - start;
    auto line = output.substr(start, length);
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    lines.emplace_back(trim_output(line));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  return lines;
}

inline OutputJudgement judge_output(const std::vector<std::string>& expected,
    const std::vector<std::string>& actual_lines) {
  OutputJudgement result;
  std::vector<bool> used(actual_lines.size(), false);
  result.cases.reserve(expected.size());
  for (const auto& want : expected) {
    const auto target = trim_output(want);
    std::size_t match = actual_lines.size();
    for (std::size_t index = 0; index < actual_lines.size(); ++index) {
      if (!used[index] && trim_output(actual_lines[index]) == target) {
        match = index;
        break;
      }
    }
    if (match != actual_lines.size()) {
      used[match] = true;
      result.cases.push_back({want, true, actual_lines[match], {}});
      continue;
    }
    std::string reason = "没有与之相等的输出行";
    bool has_unused_line = false;
    for (std::size_t index = 0; index < actual_lines.size(); ++index) {
      if (used[index]) continue;
      has_unused_line = true;
      if (trim_output(actual_lines[index]).find(target) != std::string_view::npos) {
        reason = "只有包含验收点的输出行";
        break;
      }
    }
    if (!has_unused_line) reason = "没有多余的输出行可以匹配（每行只能用一次）";
    result.cases.push_back({want, false, {}, std::move(reason)});
  }
  for (std::size_t index = 0; index < actual_lines.size(); ++index) {
    if (!used[index]) result.extra_lines.push_back(actual_lines[index]);
  }
  result.passed = !result.cases.empty() &&
      std::all_of(result.cases.begin(), result.cases.end(),
          [](const auto& item) { return item.matched; });
  return result;
}

inline OutputJudgement judge_output(const std::vector<std::string>& expected,
    std::string_view actual) {
  return judge_output(expected, output_lines(actual));
}

}  // namespace codeweave::learning
