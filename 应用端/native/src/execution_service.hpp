#pragma once

#include "process_runner.hpp"
#include "trace_contract.hpp"

#include <filesystem>
#include <atomic>
#include <optional>

namespace codeweave::execution {

struct ServiceResult {
  app::Result validation;
  std::optional<ProcessResult> process;
  std::optional<Trace> trace;
};

class ExecutionService final {
 public:
  ServiceResult validate(const Request& request, const std::filesystem::path& executable,
      const std::filesystem::path& working_directory) const;
  ServiceResult run(const Request& request, const std::filesystem::path& executable,
      const std::filesystem::path& working_directory,
      const std::atomic_bool* cancellation = nullptr,
      ExecutionControl* control = nullptr) const;

 private:
  ProcessRunner runner_;
};

}  // namespace codeweave::execution
