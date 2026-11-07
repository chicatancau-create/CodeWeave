#pragma once

#include "execution_contract.hpp"
#include "process_contract.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::execution {

struct ProcessPlan {
  ProcessRequest process;
  std::string source;
  std::uint32_t timeout_ms{};
  std::size_t output_limit{};
  std::filesystem::path environment_path_prefix{};
};

app::Result build_process_plan(const Request& request, const std::filesystem::path& executable,
    const std::filesystem::path& working_directory, ProcessPlan& plan);

}  // namespace codeweave::execution
