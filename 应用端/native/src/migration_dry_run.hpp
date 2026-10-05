#pragma once

#include "app_core.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::migration {

struct Entry {
  std::string relative_path;
  std::uintmax_t size{};
  bool directory{};
  bool regular{};
  bool symlink{};
};

struct Report {
  bool content_read{};
  bool writes_performed{};
  bool migration_committed{};
  std::size_t directory_count{};
  std::size_t file_count{};
  std::vector<Entry> entries;
  std::vector<std::string> issues;
};

app::Result inspect_read_only(const std::filesystem::path& root, Report& report);

}  // namespace codeweave::migration
