#include "migration_staging.hpp"

#include <fstream>
#include <cstdint>
#include <system_error>
#include <algorithm>
#include <cwctype>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::migration {
namespace {

constexpr const char* kMarker = "codeweave.migration-fixture";

std::filesystem::path canonical_for_comparison(const std::filesystem::path& value) {
  std::error_code error;
  const auto canonical = std::filesystem::weakly_canonical(value, error);
  return error ? value.lexically_normal() : canonical.lexically_normal();
}

bool same_path(const std::filesystem::path& left, const std::filesystem::path& right) {
  auto left_value = left.generic_wstring();
  auto right_value = right.generic_wstring();
#ifdef _WIN32
  std::transform(left_value.begin(), left_value.end(), left_value.begin(),
      [](wchar_t character) { return std::towlower(character); });
  std::transform(right_value.begin(), right_value.end(), right_value.begin(),
      [](wchar_t character) { return std::towlower(character); });
#endif
  return left_value == right_value;
}

bool is_same_or_descendant(const std::filesystem::path& candidate,
    const std::filesystem::path& root) {
  const auto candidate_value = canonical_for_comparison(candidate);
  const auto root_value = canonical_for_comparison(root);
  const auto relative = candidate_value.lexically_relative(root_value);
  if (same_path(candidate_value, root_value)) return true;
  if (relative.empty()) return false;
  for (const auto& component : relative) {
    if (same_path(component, "..")) return false;
  }
  return true;
}

bool safe_roots(const std::filesystem::path& source, const std::filesystem::path& target) {
  if (source.empty() || target.empty() || !source.is_absolute() || !target.is_absolute()) {
    return false;
  }
  std::error_code error;
  const auto source_status = std::filesystem::symlink_status(source, error);
  if (error || !std::filesystem::is_directory(source_status) ||
      std::filesystem::is_symlink(source_status)) return false;
  // Keep the staged copy outside the source tree so rollback cannot traverse
  // into source data through a path alias.
  return !is_same_or_descendant(target, source);
}

bool marker_present(const std::filesystem::path& root) {
  const auto marker_path = root / std::filesystem::path(kMarker);
  std::error_code error;
  const auto status = std::filesystem::symlink_status(marker_path, error);
  if (error || std::filesystem::is_symlink(status) ||
      !std::filesystem::is_regular_file(status)) return false;
  std::ifstream marker(marker_path, std::ios::binary);
  return marker.good();
}

bool has_symlink_component(const std::filesystem::path& value) {
  auto current = std::filesystem::path{};
  std::error_code error;
  for (const auto& component : value) {
    current /= component;
    if (current == value.root_name() || current == value.root_path()) continue;
    const auto status = std::filesystem::symlink_status(current, error);
    if (!error && std::filesystem::is_symlink(status)) return true;
    if (error == std::make_error_code(std::errc::no_such_file_or_directory) ||
        error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND) {
      error.clear();
      continue;
    }
    if (error) return true;
  }
  return false;
}

bool fingerprint_file(const std::filesystem::path& path, std::uintmax_t& size,
    std::uint64_t& fingerprint) {
  std::ifstream input(path, std::ios::binary);
  if (!input) return false;
  constexpr std::uint64_t offset = 14695981039346656037ull;
  constexpr std::uint64_t prime = 1099511628211ull;
  fingerprint = offset;
  size = 0;
  char buffer[8192];
  while (input.read(buffer, sizeof(buffer)) || input.gcount() > 0) {
    const auto count = input.gcount();
    for (std::streamsize index = 0; index < count; ++index) {
      fingerprint ^= static_cast<unsigned char>(buffer[index]);
      fingerprint *= prime;
    }
    size += static_cast<std::uintmax_t>(count);
  }
  return input.eof();
}

}  // namespace

app::Result stage_fixture_copy(const std::filesystem::path& source,
    const std::filesystem::path& target, StagingReport& report) {
  report = {};
  report.fixture_only = true;
  if (!safe_roots(source, target)) return app::Result::failure("迁移源和目标必须是不同的绝对路径");
  if (has_symlink_component(target.parent_path())) {
    return app::Result::failure("迁移目标父目录不能经过符号链接");
  }
  if (!marker_present(source)) return app::Result::failure("只允许带迁移夹具标记的隔离源");
  std::error_code target_error;
  const auto target_status = std::filesystem::symlink_status(target, target_error);
  if (target_error && target_error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      target_error.value() != ERROR_FILE_NOT_FOUND && target_error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取隔离目标失败");
  }
  if (!target_error && target_status.type() != std::filesystem::file_type::not_found) {
    return app::Result::failure("隔离目标必须不存在，避免覆盖已有目录");
  }
  target_error.clear();
  Report scan;
  const auto inspected = inspect_read_only(source, scan);
  if (!inspected.ok) return inspected;
  std::error_code error;
  const auto cleanup_target = [&] {
    std::error_code ignored;
    std::filesystem::remove_all(target, ignored);
  };
  if (!std::filesystem::create_directories(target.parent_path(), error) && error) {
    return app::Result::failure("创建隔离目标父目录失败");
  }
  error.clear();
  if (!std::filesystem::create_directory(target, error)) {
    if (error) return app::Result::failure("创建隔离目标失败");
    return app::Result::failure("隔离目标在创建前已被占用");
  }
  for (const auto& entry : scan.entries) {
    if (!entry.regular || entry.relative_path == kMarker) continue;
    const auto from = source / std::filesystem::path(entry.relative_path);
    const auto to = target / std::filesystem::path(entry.relative_path);
    std::filesystem::create_directories(to.parent_path(), error);
    if (error) {
      cleanup_target();
      return app::Result::failure("创建隔离目标目录失败");
    }
    std::filesystem::copy_file(from, to, std::filesystem::copy_options::none, error);
    if (error) {
      cleanup_target();
      return app::Result::failure("复制隔离夹具失败");
    }
    StagingReport::Receipt receipt{entry.relative_path, 0, 0};
    if (!fingerprint_file(from, receipt.size, receipt.fingerprint)) {
      cleanup_target();
      return app::Result::failure("读取隔离夹具文件失败");
    }
    report.receipts.push_back(std::move(receipt));
    ++report.copied_files;
  }
  report.staged = true;
  Report target_scan;
  const auto verified = inspect_read_only(target, target_scan);
  if (!verified.ok || target_scan.file_count != report.copied_files) {
    report.issues.push_back("target_file_count_mismatch");
    cleanup_target();
    return app::Result::failure("隔离目标校验失败");
  }
  for (const auto& receipt : report.receipts) {
    std::uintmax_t size = 0;
    std::uint64_t fingerprint = 0;
    if (!fingerprint_file(target / std::filesystem::path(receipt.relative_path), size, fingerprint) ||
        size != receipt.size || fingerprint != receipt.fingerprint) {
      report.issues.push_back("target_fingerprint_mismatch:" + receipt.relative_path);
      cleanup_target();
      return app::Result::failure("隔离目标内容校验失败");
    }
  }
  report.verified = true;
  report.committed = true;
  report.staged_target = target;
  return app::Result::success("隔离副本演练完成");
}

app::Result rollback_fixture_copy(const std::filesystem::path& target, StagingReport& report) {
  if (!report.fixture_only || !report.committed || target.empty() || !target.is_absolute() ||
      report.staged_target != target) {
    return app::Result::failure("隔离回滚条件不满足");
  }
  std::error_code error;
  std::filesystem::remove_all(target, error);
  if (error) return app::Result::failure("隔离副本回滚失败");
  report.rolled_back = true;
  report.committed = false;
  return app::Result::success("隔离副本已回滚");
}

}  // namespace codeweave::migration
