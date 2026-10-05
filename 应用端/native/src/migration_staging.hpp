#pragma once

#include "migration_dry_run.hpp"

#include <filesystem>
#include <string>

namespace codeweave::migration {

struct StagingReport {
  bool fixture_only{};
  bool staged{};
  bool verified{};
  bool committed{};
  bool rolled_back{};
  std::filesystem::path staged_target;
  std::size_t copied_files{};
  struct Receipt {
    std::string relative_path;
    std::uintmax_t size{};
    std::uint64_t fingerprint{};
  };
  std::vector<Receipt> receipts;
  std::vector<std::string> issues;
};

// The marker is mandatory so production workspaces cannot be passed accidentally.
app::Result stage_fixture_copy(const std::filesystem::path& source,
    const std::filesystem::path& target, StagingReport& report);

app::Result rollback_fixture_copy(const std::filesystem::path& target, StagingReport& report);

}  // namespace codeweave::migration
