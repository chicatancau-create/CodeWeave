#include "execution_service.hpp"

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
