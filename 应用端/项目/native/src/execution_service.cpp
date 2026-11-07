#include "execution_service.hpp"
#include "javascript_trace_runner.hpp"

#include <fstream>
#include <random>
#include <system_error>

namespace codeweave::execution {

namespace {

class TemporaryFile final {
 public:
  explicit TemporaryFile(std::filesystem::path path) : path_(std::move(path)) {}
  ~TemporaryFile() {
    if (!path_.empty()) {
      std::error_code ignored;
      std::filesystem::remove(path_, ignored);
    }
  }
  TemporaryFile(const TemporaryFile&) = delete;
  TemporaryFile& operator=(const TemporaryFile&) = delete;

 private:
  std::filesystem::path path_;
};

class TemporaryDirectory final {
 public:
  explicit TemporaryDirectory(std::filesystem::path path) : path_(std::move(path)) {}
  ~TemporaryDirectory() {
    if (!path_.empty()) {
      std::error_code ignored;
      std::filesystem::remove_all(path_, ignored);
    }
  }
  TemporaryDirectory(const TemporaryDirectory&) = delete;
  TemporaryDirectory& operator=(const TemporaryDirectory&) = delete;

 private:
  std::filesystem::path path_;
};

std::filesystem::path generated_cpp_path(const ProcessPlan& plan) {
  for (const auto& argument : plan.process.arguments) {
    if (argument.starts_with(L"codeweave-program-")) {
      return plan.process.working_directory / argument;
    }
    if (argument.starts_with(L"/Fe:")) {
      return plan.process.working_directory / argument.substr(4);
    }
  }
  return {};
}

std::filesystem::path generated_cpp_source_path(const ProcessPlan& plan) {
  for (const auto& argument : plan.process.arguments) {
    if (argument.starts_with(L"codeweave-source-")) {
      return plan.process.working_directory / argument;
    }
  }
  return {};
}

std::filesystem::path java_source_path(const std::filesystem::path& working_directory) {
  return working_directory / "Main.java";
}

std::filesystem::path sibling_java_compiler(const std::filesystem::path& java_tool) {
  return java_tool.parent_path() / "javac.exe";
}

std::filesystem::path unique_java_directory(const std::filesystem::path& root,
    std::string_view session_id) {
  std::random_device random;
  return root / ("java-" + std::string(session_id) + "-" +
      std::to_string(random()) + "-" + std::to_string(random()));
}

std::filesystem::path unique_source_trace_directory(const std::filesystem::path& root,
    std::string_view language) {
  std::random_device random;
  return root / (std::string(language) + "-" + std::to_string(random()) + "-" + std::to_string(random()));
}

bool write_file(const std::filesystem::path& path, std::string_view contents) {
  std::ofstream file(path, std::ios::binary | std::ios::trunc);
  if (!file) return false;
  file.write(contents.data(), static_cast<std::streamsize>(contents.size()));
  file.flush();
  return static_cast<bool>(file);
}

constexpr std::string_view kPythonTraceRunner = R"PY(
import json
import itertools
import pathlib
import sys

source_path = pathlib.Path(sys.argv[1])
snapshot_path = pathlib.Path(sys.argv[2])
sys.argv = ["-"]
sys.path[0] = str(pathlib.Path.cwd())
source = source_path.read_text(encoding="utf-8")
step_count = 0
step_bytes = 0

def trace(frame, event, arg):
    global step_count, step_bytes
    if event not in ("line", "return", "exception") or frame.f_code.co_filename != "<codeweave>":
        return trace
    if step_count >= 512 or step_bytes >= 262144:
        return None
    values = {}
    for name, value in itertools.islice(frame.f_locals.items(), 16):
        if type(name) is not str or name.startswith("__"):
            continue
        if type(value) is str:
            rendered = repr(value[:160]) + ("..." if len(value) > 160 else "")
        elif type(value) is int:
            rendered = repr(value) if value.bit_length() <= 512 else "<large int>"
        elif value is None or type(value) in (bool, float):
            rendered = repr(value)
        else:
            rendered = "<object>"
        values[name[:128]] = rendered
    record = json.dumps({"line": frame.f_lineno, "phase": event, "variables": values}, ensure_ascii=True,
                        separators=(",", ":")) + "\n"
    encoded_size = len(record.encode("utf-8"))
    if encoded_size <= 8192 and step_bytes + encoded_size <= 262144:
        with snapshot_path.open("a", encoding="utf-8", newline="\n") as snapshots:
            snapshots.write(record)
        step_count += 1
        step_bytes += encoded_size
    return trace

sys.settrace(trace)
try:
    exec(compile(source, "<codeweave>", "exec"), {"__name__": "__main__"})
finally:
    sys.settrace(None)
)PY";

bool append_source_steps(const std::filesystem::path& snapshot_path, Trace& trace) {
  std::error_code error;
  const auto status = std::filesystem::symlink_status(snapshot_path, error);
  if (error || !std::filesystem::is_regular_file(status) || std::filesystem::is_symlink(status)) return false;
  std::ifstream input(snapshot_path, std::ios::binary);
  if (!input) return false;
  std::string line;
  std::size_t total_bytes = 0;
  std::size_t steps = 0;
  char character = 0;
  while (input.get(character)) {
    if (++total_bytes > 256 * 1024 || line.size() >= 8192 || steps >= 512) break;
    if (character != '\n') {
      line.push_back(character);
      continue;
    }
    if (line.empty()) continue;
    const auto result = trace.append_source_step(line);
    if (!result.ok) break;
    line.clear();
    ++steps;
  }
  return !input.bad();
}

}  // namespace

ServiceResult ExecutionService::validate(const Request& request, const std::filesystem::path& executable,
    const std::filesystem::path& working_directory) const {
  ProcessPlan plan{};
  const auto result = build_process_plan(request, executable, working_directory, plan);
  return {result, std::nullopt, std::nullopt};
}

ServiceResult ExecutionService::run(const Request& request, const std::filesystem::path& executable,
    const std::filesystem::path& working_directory, const std::atomic_bool* cancellation,
    ExecutionControl* control) const {
  ProcessPlan plan{};
  const auto validation = build_process_plan(request, executable, working_directory, plan);
  if (!validation.ok) return {validation, std::nullopt, std::nullopt};
  if (request.language == "python" || request.language == "javascript") {
    const bool python = request.language == "python";
    std::error_code directory_error;
    const auto trace_directory = unique_source_trace_directory(working_directory, request.language);
    const bool created = std::filesystem::create_directory(trace_directory, directory_error);
    if (!created || directory_error) {
      return {app::Result::failure(created ? "源码追踪隔离工作目录创建后不可用"
                                           : "源码追踪隔离工作目录已被占用或无法创建"),
          std::nullopt, std::nullopt};
    }
    TemporaryDirectory trace_cleanup(trace_directory);
    const auto source_path = trace_directory / (python ? "program.py" : "program.cjs");
    const auto runner_path = trace_directory / (python ? "runner.py" : "runner.cjs");
    const auto snapshot_path = trace_directory / "snapshots.jsonl";
    const auto syntax_fallback_path = trace_directory / "syntax-fallback";
    if (!write_file(source_path, request.source) ||
        !write_file(runner_path, python ? kPythonTraceRunner : kJavaScriptTraceRunner)) {
      return {app::Result::failure("创建源码追踪文件失败"), std::nullopt, std::nullopt};
    }
    std::vector<std::wstring> arguments;
    if (python) arguments = {L"-X", L"utf8"};
    arguments.insert(arguments.end(), {runner_path.wstring(), source_path.wstring(), snapshot_path.wstring()});
    if (!python) arguments.push_back(syntax_fallback_path.wstring());
    ProcessPlan trace_plan{
        {executable, std::move(arguments), working_directory, request.language},
        {}, request.timeout_ms, request.output_limit};
    if (const auto valid = validate_process_request(trace_plan.process); !valid.ok) {
      return {valid, std::nullopt, std::nullopt};
    }
    Trace trace(request.session_id);
    trace.append(EventKind::Started);
    auto process = runner_.run(trace_plan, cancellation, control);
    if (!python && process.exit_code != 0 && !process.cancelled && !process.timed_out &&
        !(cancellation && cancellation->load())) {
      std::error_code fallback_error;
      const auto status = std::filesystem::symlink_status(syntax_fallback_path, fallback_error);
      if (!fallback_error && std::filesystem::is_regular_file(status) && !std::filesystem::is_symlink(status)) {
        std::ifstream marker(syntax_fallback_path, std::ios::binary);
        // The marker is written only by the parser, before any learner code runs.
        if (marker.get() == '1') process = runner_.run(plan, cancellation, control);
      }
    }
    append_source_steps(snapshot_path, trace);
    for (const auto& event : process.control_events) {
      if (event.command == ControlCommand::Pause) trace.append(EventKind::Paused);
      if (event.command == ControlCommand::Resume || event.command == ControlCommand::Step) {
        trace.append(EventKind::Resumed);
      }
    }
    if (!process.output.empty()) trace.append(EventKind::Output, process.output);
    if (process.timed_out || process.error_code == "execution_timeout") trace.append(EventKind::Failed, process.error_code);
    else if (process.cancelled) trace.append(EventKind::Cancelled);
    else if (process.exit_code == 0 && process.error_code.empty()) trace.append(EventKind::Completed);
    else trace.append(EventKind::Failed, process.error_code.empty() ? "process_exit_nonzero" : process.error_code);
    return {validation, std::move(process), std::move(trace)};
  }
  if (request.language == "java") {
    std::error_code directory_error;
    const auto java_directory = unique_java_directory(working_directory, request.session_id);
    const bool created = std::filesystem::create_directory(java_directory, directory_error);
    if (!created || directory_error) {
      return {app::Result::failure(created ? "Java 隔离工作目录创建后不可用"
                                           : "Java 隔离工作目录已被占用或无法创建"),
          std::nullopt, std::nullopt};
    }
    TemporaryDirectory java_cleanup(java_directory);
    const auto source_path = java_source_path(java_directory);
    {
      std::ofstream source_file(source_path, std::ios::binary | std::ios::trunc);
      if (!source_file) return {app::Result::failure("无法创建 Java 源文件"), std::nullopt, std::nullopt};
      source_file.write(request.source.data(), static_cast<std::streamsize>(request.source.size()));
      source_file.flush();
      if (!source_file) return {app::Result::failure("写入 Java 源文件失败"), std::nullopt, std::nullopt};
    }
    const auto compiler = sibling_java_compiler(executable);
    const ProcessRequest compile_request{
        compiler, {L"-encoding", L"UTF-8", L"Main.java"}, java_directory, "java-compile"};
    if (const auto compile_valid = validate_process_request(compile_request); !compile_valid.ok) {
      return {app::Result::failure("Java 编译器未配置或不在同一 JDK 中"), std::nullopt, std::nullopt};
    }
    Trace trace(request.session_id);
    trace.append(EventKind::Started);
    auto compilation = runner_.run({compile_request, {}, request.timeout_ms, request.output_limit}, cancellation, control);
    if (!compilation.started || compilation.exit_code != 0 || !compilation.error_code.empty() ||
        (cancellation && cancellation->load())) {
      compilation.execution_output_valid = false;
      if (!compilation.error_code.empty()) trace.append(EventKind::Failed, compilation.error_code);
      else trace.append(EventKind::Failed, "java_compilation_failed");
      if (!compilation.output.empty()) trace.append(EventKind::Output, compilation.output);
      return {validation, std::move(compilation), std::move(trace)};
    }
    ProcessPlan runtime_plan{
        {executable, {L"-cp", java_directory.wstring(), L"Main"}, java_directory, "java"},
        {}, request.timeout_ms, request.output_limit};
    auto process = runner_.run(runtime_plan, cancellation, control);
    for (const auto& event : process.control_events) {
      if (event.command == ControlCommand::Pause) trace.append(EventKind::Paused);
      if (event.command == ControlCommand::Resume || event.command == ControlCommand::Step) trace.append(EventKind::Resumed);
    }
    if (!process.output.empty()) trace.append(EventKind::Output, process.output);
    if (process.timed_out || process.error_code == "execution_timeout") trace.append(EventKind::Failed, process.error_code);
    else if (process.cancelled) trace.append(EventKind::Cancelled);
    else if (process.exit_code == 0 && process.error_code.empty()) trace.append(EventKind::Completed);
    else trace.append(EventKind::Failed, process.error_code.empty() ? "process_exit_nonzero" : process.error_code);
    return {validation, std::move(process), std::move(trace)};
  }
  Trace trace(request.session_id);
  trace.append(EventKind::Started);
  const auto source_path = request.language == "cpp" ? generated_cpp_source_path(plan)
      : std::filesystem::path{};
  const auto program_path = request.language == "cpp" ? generated_cpp_path(plan)
      : std::filesystem::path{};
  if (!source_path.empty() || !program_path.empty()) {
    std::error_code exists_error;
    if ((!source_path.empty() && std::filesystem::exists(source_path, exists_error)) ||
        exists_error ||
        (!program_path.empty() && std::filesystem::exists(program_path, exists_error)) ||
        exists_error) {
      trace.append(EventKind::Failed, "temporary_path_already_exists");
      return {app::Result::failure("执行临时文件路径已存在"), std::nullopt, std::move(trace)};
    }
  }
  TemporaryFile source_cleanup(source_path);
  TemporaryFile program_cleanup(program_path);
  if (!source_path.empty()) {
    std::ofstream source_file(source_path, std::ios::binary | std::ios::trunc);
    if (!source_file) {
      trace.append(EventKind::Failed, "cpp_source_write_failed");
      return {app::Result::failure("无法创建 C++ 源文件"), std::nullopt, std::move(trace)};
    }
    source_file.write(request.source.data(), static_cast<std::streamsize>(request.source.size()));
    source_file.flush();
    if (!source_file) {
      std::error_code ignored;
      std::filesystem::remove(source_path, ignored);
      trace.append(EventKind::Failed, "cpp_source_write_failed");
      return {app::Result::failure("写入 C++ 源文件失败"), std::nullopt, std::move(trace)};
    }
  }
  auto process = runner_.run(plan, cancellation, control);
  if (request.language == "cpp") {
    const bool compilation_succeeded = process.started && process.error_code.empty() &&
        process.exit_code == 0 && !(cancellation && cancellation->load());
    if (!compilation_succeeded) {
      process.execution_output_valid = false;
    } else {
    ProcessPlan runtime_plan{
        {program_path, {}, working_directory, "cpp-runtime"},
        {}, plan.timeout_ms, plan.output_limit};
    const auto runtime_valid = validate_process_request(runtime_plan.process);
    if (!runtime_valid.ok) {
      process.started = false;
      process.error_code = "compiled_program_invalid";
      process.execution_output_valid = false;
    } else {
      process = runner_.run(runtime_plan, cancellation, control);
    }
    }
  }
  for (const auto& event : process.control_events) {
    if (event.command == ControlCommand::Pause) trace.append(EventKind::Paused);
    if (event.command == ControlCommand::Resume || event.command == ControlCommand::Step) {
      trace.append(EventKind::Resumed);
    }
  }
  if (!process.output.empty()) trace.append(EventKind::Output, process.output);
  if (process.timed_out || process.error_code == "execution_timeout") {
    trace.append(EventKind::Failed, process.error_code);
  } else if (process.cancelled) {
    trace.append(EventKind::Cancelled);
  } else if (process.exit_code == 0 && process.error_code.empty()) {
    trace.append(EventKind::Completed);
  } else {
    trace.append(EventKind::Failed, process.error_code.empty() ? "process_exit_nonzero" : process.error_code);
  }
  return {validation, std::move(process), std::move(trace)};
}

}  // namespace codeweave::execution
