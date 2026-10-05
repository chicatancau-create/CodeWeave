#pragma once

#include "app_core.hpp"
#include <filesystem>
#include <string>

namespace codeweave::migration {

struct LegacyImportReport {
  bool committed{};
  std::size_t accounts{};
  std::size_t history_categories{};
  std::filesystem::path target;
};

app::Result import_legacy_users(const std::filesystem::path& source,
    const std::filesystem::path& new_native_root, LegacyImportReport& report);
app::Result import_legacy_learning(const std::filesystem::path& source,
    const std::string& account_id, const std::filesystem::path& new_history_directory,
    LegacyImportReport& report);

}  // namespace codeweave::migration
