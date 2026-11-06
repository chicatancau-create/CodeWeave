#pragma once

#include "app_core.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>

namespace codeweave::learning::operation_index {

inline constexpr std::uint64_t kFingerprintOffset = 14695981039346656037ull;

struct Entry {
  std::string operation_id;
  std::uintmax_t offset{};
  std::uintmax_t length{};
};

struct Snapshot {
  std::uintmax_t ledger_size{};
  std::size_t record_count{};
  std::uint64_t ledger_fingerprint{kFingerprintOffset};
};

using ParseOperation = std::function<bool(std::string_view line, std::string& operation_id)>;

// Derived metadata only. The original ledger remains the sole source of truth.
app::Result load_or_rebuild(const std::filesystem::path& index_dir,
    const std::filesystem::path& ledger_path, const std::filesystem::path& data_root,
    std::uintmax_t max_ledger_bytes, std::size_t max_line_bytes,
    std::size_t max_records, const ParseOperation& parse_operation, Snapshot& snapshot);

app::Result rebuild(const std::filesystem::path& index_dir,
    const std::filesystem::path& ledger_path, const std::filesystem::path& data_root,
    std::uintmax_t max_ledger_bytes, std::size_t max_line_bytes,
    std::size_t max_records, const ParseOperation& parse_operation, Snapshot& snapshot);

app::Result find(const std::filesystem::path& index_dir, std::string_view operation_id,
    const Snapshot& snapshot, Entry& entry, bool& found);

app::Result append(const std::filesystem::path& index_dir,
    const std::filesystem::path& ledger_path, const std::filesystem::path& data_root,
    const Entry& entry, Snapshot& snapshot);

app::Result clear(const std::filesystem::path& index_dir,
    const std::filesystem::path& data_root);

app::Result read_entry(const std::filesystem::path& ledger_path, const Entry& entry,
    std::string& line);

}  // namespace codeweave::learning::operation_index
