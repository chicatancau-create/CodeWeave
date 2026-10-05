#include "execution_plan.hpp"

#include <algorithm>
#include <cwctype>

namespace codeweave::execution {

app::Result build_process_plan(const Request& request, const std::filesystem::path& executable,
    const std::filesystem::path& working_directory, ProcessPlan& plan) {
  if (const auto valid = validate_request(request); !valid.ok) return valid;
  if (request.language == "cpp" &&
      !std::all_of(request.session_id.begin(), request.session_id.end(), [](unsigned char character) {
        return (character >= 'a' && character <= 'z') ||
            (character >= 'A' && character <= 'Z') ||
            (character >= '0' && character <= '9') || character == '-' || character == '_';
      })) {
    return app::Result::failure("C++ execution session ID must use ASCII letters, digits, hyphens, or underscores");
  }
  std::vector<std::wstring> arguments;
  if (request.language == "javascript") arguments.push_back(L"-");
  if (request.language == "python") arguments = {L"-X", L"utf8", L"-"};
  if (request.language == "cpp") {
    const auto filename = executable.filename().wstring();
    std::wstring lower = filename;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t character) {
      return static_cast<wchar_t>(std::towlower(character));
    });
    // Keep generated filenames within the process-contract length budget even
    // when a caller supplies the maximum legal session ID.
    std::wstring safe_session(request.session_id.begin(), request.session_id.end());
    if (safe_session.size() > 72) safe_session.resize(72);
    const auto output = std::wstring(L"codeweave-program-") + safe_session + L".exe";
    const auto source = std::wstring(L"codeweave-source-") + safe_session + L".cpp";
    if (lower == L"cl.exe") {
      arguments = {L"/nologo", L"/std:c++latest", L"/EHsc", L"/Fe:" + output, source};
    } else {
      arguments = {L"-std=c++23", L"-O0", L"-pipe", L"-x", L"c++", L"-o", output, L"-"};
    }
  } else if (request.language == "java") {
    // Java source is compiled by the service into an isolated session folder.
    // The returned plan is the runtime phase; the source file is always Main.java.
    arguments = {L"-cp", working_directory.wstring(), L"Main"};
  }
  ProcessPlan candidate{
      ProcessRequest{executable, std::move(arguments), working_directory, request.language}, request.source,
      request.timeout_ms,
      request.output_limit};
  if (const auto valid = validate_process_request(candidate.process); !valid.ok) return valid;
  plan = std::move(candidate);
  return app::Result::success("执行进程计划有效");
}

}  // namespace codeweave::execution
