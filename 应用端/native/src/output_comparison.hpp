#pragma once

#include <string_view>

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

}  // namespace codeweave::learning
