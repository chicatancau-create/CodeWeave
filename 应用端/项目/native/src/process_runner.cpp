#include "process_runner.hpp"

#ifdef _WIN32
#include <windows.h>
#endif

#include <algorithm>
#include <atomic>
#include <cwctype>
#include <cwchar>
#include <thread>

namespace codeweave::execution {

app::Result ExecutionControl::request(ControlCommand command) {
  std::lock_guard lock(mutex_);
  if (!handler_) return app::Result::failure("执行进程尚未启动");
  return handler_(command);
}

void ExecutionControl::attach(Handler handler) {
  std::lock_guard lock(mutex_);
  handler_ = std::move(handler);
}

void ExecutionControl::detach() {
  std::lock_guard lock(mutex_);
  handler_ = {};
  paused_.store(false);
}

#ifdef _WIN32
namespace {

std::wstring quote_argument(std::wstring_view value) {
  std::wstring result = L"\"";
  unsigned backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
    } else if (character == L'\"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(L'\"');
      backslashes = 0;
    } else {
      result.append(backslashes, L'\\');
      result.push_back(character);
      backslashes = 0;
    }
  }
  result.append(backslashes * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

struct HandleGuard {
  HANDLE value{nullptr};
  explicit HandleGuard(HANDLE handle) : value(handle) {}
  ~HandleGuard() {
    if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value);
  }
  HandleGuard(const HandleGuard&) = delete;
  HandleGuard& operator=(const HandleGuard&) = delete;
};

std::vector<wchar_t> compiler_environment(const ProcessPlan& plan) {
  const auto& request = plan.process;
  const auto directory = request.language == "cpp" || request.language == "cpp-debugger"
      ? request.executable.parent_path() : plan.environment_path_prefix;
  if (directory.empty()) return {};
  const auto inherited = GetEnvironmentStringsW();
  if (!inherited) return {};
  std::vector<wchar_t> environment;
  bool path_found = false;
  for (const wchar_t* entry = inherited; *entry; entry += std::wcslen(entry) + 1) {
    const std::wstring_view value(entry);
    if (value.size() >= 5 && _wcsnicmp(entry, L"PATH=", 5) == 0) {
      const auto path = L"PATH=" + directory.wstring() + L";" + std::wstring(value.substr(5));
      environment.insert(environment.end(), path.begin(), path.end());
      path_found = true;
    } else {
      environment.insert(environment.end(), value.begin(), value.end());
    }
    environment.push_back(L'\0');
  }
  FreeEnvironmentStringsW(inherited);
  if (!path_found) {
    const auto path = L"PATH=" + directory.wstring();
    environment.insert(environment.end(), path.begin(), path.end());
    environment.push_back(L'\0');
  }
  environment.push_back(L'\0');
  return environment;
}

}  // namespace
#endif

ProcessResult ProcessRunner::run(const ProcessPlan& plan, const std::atomic_bool* cancellation,
    ExecutionControl* control) const {
  ProcessResult result;
#ifndef _WIN32
  result.error_code = "windows_only_runner";
  return result;
#else
  if (const auto valid = validate_process_request(plan.process); !valid.ok) {
    result.error_code = "invalid_process_plan";
    return result;
  }
  if (!plan.environment_path_prefix.empty() && !plan.environment_path_prefix.is_absolute()) {
    result.error_code = "invalid_process_plan";
    return result;
  }

  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE raw_read = nullptr;
  HANDLE raw_write = nullptr;
  HANDLE input_read = nullptr;
  HANDLE input_write = nullptr;
  if (!CreatePipe(&raw_read, &raw_write, &security, 0) ||
      !CreatePipe(&input_read, &input_write, &security, 0)) {
    if (raw_read) CloseHandle(raw_read);
    if (raw_write) CloseHandle(raw_write);
    if (input_read) CloseHandle(input_read);
    if (input_write) CloseHandle(input_write);
    result.error_code = "pipe_create_failed";
    return result;
  }
  HandleGuard read_guard{raw_read};
  HandleGuard write_guard{raw_write};
  HandleGuard input_read_guard{input_read};
  HandleGuard input_write_guard{input_write};
  if (!SetHandleInformation(raw_read, HANDLE_FLAG_INHERIT, 0)) {
    result.error_code = "pipe_configure_failed";
    return result;
  }
  if (!SetHandleInformation(input_write, HANDLE_FLAG_INHERIT, 0)) {
    result.error_code = "stdin_open_failed";
    return result;
  }

  std::wstring command = quote_argument(plan.process.executable.wstring());
  for (const auto& argument : plan.process.arguments) {
    command.push_back(L' ');
    command += quote_argument(argument);
  }
  std::vector<wchar_t> command_buffer(command.begin(), command.end());
  command_buffer.push_back(L'\0');

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = input_read;
  startup.hStdOutput = raw_write;
  startup.hStdError = raw_write;
  PROCESS_INFORMATION process_info{};
  auto environment = compiler_environment(plan);
  const BOOL created = CreateProcessW(
      plan.process.executable.wstring().c_str(), command_buffer.data(), nullptr, nullptr, TRUE,
      CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
      environment.empty() ? nullptr : environment.data(),
      plan.process.working_directory.wstring().c_str(), &startup, &process_info);
  if (!created) {
    result.error_code = "process_create_failed";
    return result;
  }
  HandleGuard process_guard{process_info.hProcess};
  HandleGuard thread_guard{process_info.hThread};
  HandleGuard job_guard{CreateJobObjectW(nullptr, nullptr)};
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job_guard.value ||
      !SetInformationJobObject(job_guard.value, JobObjectExtendedLimitInformation,
          &limits, sizeof(limits)) ||
      !AssignProcessToJobObject(job_guard.value, process_info.hProcess)) {
    TerminateProcess(process_info.hProcess, 1);
    WaitForSingleObject(process_info.hProcess, 5000);
    result.error_code = "job_assign_failed";
    return result;
  }
  if (ResumeThread(process_info.hThread) == static_cast<DWORD>(-1)) {
    TerminateJobObject(job_guard.value, 1);
    WaitForSingleObject(process_info.hProcess, 5000);
    result.error_code = "process_resume_failed";
    return result;
  }
  std::mutex control_events_mutex;
  std::vector<ControlEvent> control_events;
  if (control) {
    control->attach([&](ControlCommand command) -> app::Result {
      auto record = [&](ControlCommand event) {
        std::lock_guard lock(control_events_mutex);
        control_events.push_back({event});
      };
      if (command == ControlCommand::Pause) {
        if (control->is_paused()) return app::Result::failure("执行已经暂停");
        if (SuspendThread(process_info.hThread) == static_cast<DWORD>(-1)) {
          return app::Result::failure("暂停执行进程失败");
        }
        control->set_paused(true);
        record(command);
        return app::Result::success("执行已暂停");
      }
      if (command == ControlCommand::Resume) {
        if (!control->is_paused()) return app::Result::failure("执行当前未暂停");
        if (ResumeThread(process_info.hThread) == static_cast<DWORD>(-1)) {
          return app::Result::failure("继续执行进程失败");
        }
        control->set_paused(false);
        record(command);
        return app::Result::success("执行已继续");
      }
      if (!control->is_paused()) return app::Result::failure("单步前必须先暂停执行");
      if (ResumeThread(process_info.hThread) == static_cast<DWORD>(-1)) {
        return app::Result::failure("单步继续执行失败");
      }
      control->set_paused(false);
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
      if (SuspendThread(process_info.hThread) == static_cast<DWORD>(-1)) {
        return app::Result::failure("单步暂停执行失败");
      }
      control->set_paused(true);
      record(command);
      return app::Result::success("已执行一个受控步");
    });
  }

  CloseHandle(raw_write);
  write_guard.value = nullptr;
  CloseHandle(input_read);
  input_read_guard.value = nullptr;
  const auto source = plan.source;
  const HANDLE source_writer = input_write;
  input_write_guard.value = nullptr;
  std::thread input_writer([source, source_writer] {
    const char* data = source.data();
    std::size_t remaining = source.size();
    while (remaining > 0) {
      DWORD written = 0;
      if (!WriteFile(source_writer, data, static_cast<DWORD>(std::min<std::size_t>(remaining, 64 * 1024)),
          &written, nullptr) || written == 0) break;
      data += written;
      remaining -= written;
    }
    CloseHandle(source_writer);
  });
  result.started = true;
  std::atomic<bool> output_limit_hit{false};
  std::string captured_output;
  bool captured_output_truncated = false;
  std::thread reader([&captured_output, &captured_output_truncated, &output_limit_hit,
      raw_read, limit = plan.output_limit] {
    char buffer[8192];
    DWORD read = 0;
    while (ReadFile(raw_read, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
      const auto remaining = limit > captured_output.size() ? limit - captured_output.size() : 0;
      const auto accepted = std::min<std::size_t>(remaining, read);
      captured_output.append(buffer, accepted);
      if (accepted < read) {
        captured_output_truncated = true;
        output_limit_hit.store(true);
        break;
      }
    }
  });

  const auto deadline = GetTickCount64() + plan.timeout_ms;
  DWORD wait = WAIT_TIMEOUT;
  while (true) {
    wait = WaitForSingleObject(process_info.hProcess, 50);
    if (wait != WAIT_TIMEOUT || output_limit_hit.load() ||
        (cancellation && cancellation->load())) break;
    if (GetTickCount64() >= deadline) break;
    if (control && control->is_paused()) continue;
  }
  if (cancellation && cancellation->load() && wait == WAIT_TIMEOUT && !output_limit_hit.load()) {
    TerminateJobObject(job_guard.value, 126);
    WaitForSingleObject(process_info.hProcess, 5000);
    result.cancelled = true;
    result.error_code = "execution_cancelled";
  } else if (output_limit_hit.load()) {
    TerminateJobObject(job_guard.value, 125);
    WaitForSingleObject(process_info.hProcess, 5000);
    result.error_code = "output_limit_exceeded";
  } else if (wait == WAIT_TIMEOUT && result.error_code.empty()) {
    result.timed_out = true;
    TerminateJobObject(job_guard.value, 124);
    WaitForSingleObject(process_info.hProcess, 5000);
    result.error_code = "execution_timeout";
  } else if (wait == WAIT_FAILED && result.error_code.empty()) {
    TerminateJobObject(job_guard.value, 1);
    result.error_code = "process_wait_failed";
  }
  GetExitCodeProcess(process_info.hProcess, &result.exit_code);
  // Descendants can outlive their parent and retain the pipe handles. End the
  // entire job before joining I/O threads, even after a normal parent exit.
  TerminateJobObject(job_guard.value, 0);
  if (input_writer.joinable()) {
    if (result.cancelled || result.timed_out || result.output_truncated ||
        !result.error_code.empty()) {
      // A child may stop consuming stdin while it is being terminated. Cancel
      // the synchronous WriteFile so shutdown cannot wait forever on the
      // writer thread.
      CancelSynchronousIo(reinterpret_cast<HANDLE>(input_writer.native_handle()));
    }
    input_writer.join();
  }
  if (reader.joinable()) reader.join();
  result.output = std::move(captured_output);
  result.output_truncated = captured_output_truncated;
  if (control) {
    control->detach();
    std::lock_guard lock(control_events_mutex);
    result.control_events = std::move(control_events);
  }
  CloseHandle(raw_read);
  read_guard.value = nullptr;
  if (result.output_truncated && result.error_code.empty()) result.error_code = "output_limit_exceeded";
  if (result.exit_code != 0 && result.error_code.empty()) result.error_code = "process_exit_nonzero";
  return result;
#endif
}

}  // namespace codeweave::execution
