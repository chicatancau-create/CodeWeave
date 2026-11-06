#pragma once

#include "app_core.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::backup {

struct FileReceipt {
  std::string relative_path;
  std::uintmax_t size{};
  std::uint64_t fingerprint{};
};

struct Report {
  bool fixture_only{};
  bool source_verified{};
  bool target_verified{};
  bool committed{};
  bool rolled_back{};
  std::filesystem::path target;
  std::vector<FileReceipt> receipts;
  std::vector<std::string> issues;
};

app::Result create_fixture_backup(const std::filesystem::path& source,
    const std::filesystem::path& target, Report& report);
app::Result restore_fixture_backup(const std::filesystem::path& backup,
    const std::filesystem::path& target, Report& report);
app::Result rollback_fixture_target(const std::filesystem::path& target, Report& report);

// Explicit user-selected copies: source stays untouched and target must not
// exist. Restores always create a separate data root; no live data is replaced.
app::Result create_native_backup(const std::filesystem::path& source,
    const std::filesystem::path& target, Report& report);
app::Result restore_native_backup(const std::filesystem::path& backup,
    const std::filesystem::path& target, Report& report);

}  // namespace codeweave::backup
