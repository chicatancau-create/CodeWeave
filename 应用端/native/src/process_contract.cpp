#include "process_contract.hpp"

#include <algorithm>
#include <cctype>
#include <cwctype>

namespace codeweave::execution {
namespace {

bool production_executable(std::string_view language, std::wstring_view filename) {
  std::wstring lower(filename);
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t character) {
    return static_cast<wchar_t>(std::towlower(character));
  });
  if (language == "javascript") return lower == L"node.exe";
  if (language == "python") return lower == L"python.exe" || lower == L"python3.exe";
  if (language == "java") return lower == L"java.exe";
  if (language == "java-compile") return lower == L"javac.exe";
  if (language == "cpp") return lower == L"g++.exe" || lower == L"clang++.exe" ||
      lower == L"cl.exe";
  return false;
}

bool generated_cpp_executable(std::wstring_view filename) {
  std::wstring lower(filename);
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t character) {
    return static_cast<wchar_t>(std::towlower(character));
  });
  return lower.size() > 20 && lower.starts_with(L"codeweave-program-") &&
      lower.ends_with(L".exe");
}

bool supported_test_runner(std::wstring_view filename) {
  std::wstring lower(filename);
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t character) {
    return static_cast<wchar_t>(std::towlower(character));
  });
  return lower == L"codeweave-cpp-runner.exe";
}

bool safe_argument(std::wstring_view argument) {
  return argument.size() <= 4096 && argument.find(L'\0') == std::wstring_view::npos;
}

}  // namespace

app::Result validate_process_request(const ProcessRequest& request) {
  if (request.executable.empty() || !request.executable.is_absolute()) {
    return app::Result::failure("执行器路径必须是绝对路径");
  }
  const auto filename = request.executable.filename().wstring();
  const bool valid_generated_cpp = request.language == "cpp-runtime" &&
      generated_cpp_executable(filename);
  if (!production_executable(request.language, filename) &&
      !valid_generated_cpp &&
      !(request.language == "cpp" && supported_test_runner(filename))) {
    return app::Result::failure("执行器不在语言白名单中");
  }
  if (request.working_directory.empty() || !request.working_directory.is_absolute()) {
    return app::Result::failure("执行工作目录必须是绝对路径");
  }
  if (request.arguments.size() > 32) return app::Result::failure("执行参数数量超过上限");
  for (const auto& argument : request.arguments) {
    if (!safe_argument(argument)) return app::Result::failure("执行参数包含非法内容");
  }
  return app::Result::success("执行器请求有效");
}

}  // namespace codeweave::execution
