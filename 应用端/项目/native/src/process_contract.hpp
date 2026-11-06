#pragma once

#include "execution_contract.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::execution {

struct ProcessRequest {
  std::filesystem::path executable;
  std::vector<std::wstring> arguments;
  std::filesystem::path working_directory;
  std::string language;
};

app::Result validate_process_request(const ProcessRequest& request);

}  // namespace codeweave::execution
