#include "backup_service.hpp"
#include "account_store.hpp"

#include <algorithm>
#include <cwctype>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::backup {
namespace {

constexpr std::string_view kMarker = "codeweave.migration-fixture";
constexpr std::string_view kBackupMarker = "codeweave.native-backup.v1";

bool valid_roots(const std::filesystem::path& source,
    const std::filesystem::path& target) {
  if (source.empty() || target.empty() || !source.is_absolute() ||
      !target.is_absolute()) return false;
  std::error_code error;
  const auto source_status = std::filesystem::symlink_status(source, error);
  if (error || !std::filesystem::is_directory(source_status) ||
      std::filesystem::is_symlink(source_status)) return false;
  const auto canonical = [](const std::filesystem::path& value) {
    std::error_code canonical_error;
    const auto result = std::filesystem::weakly_canonical(value, canonical_error);
    return canonical_error ? value.lexically_normal() : result.lexically_normal();
  };
  const auto same_path = [](const std::filesystem::path& left,
      const std::filesystem::path& right) {
    auto left_value = left.generic_wstring();
    auto right_value = right.generic_wstring();
#ifdef _WIN32
    std::transform(left_value.begin(), left_value.end(), left_value.begin(),
        [](wchar_t character) { return std::towlower(character); });
    std::transform(right_value.begin(), right_value.end(), right_value.begin(),
        [](wchar_t character) { return std::towlower(character); });
#endif
    return left_value == right_value;
  };
  const auto source_value = canonical(source);
  const auto target_value = canonical(target);
  if (same_path(source_value, target_value)) return false;
  // lexically_relative has no result across Windows volumes. Different drive
  // roots cannot be descendants, so they are valid backup destinations.
  if (!same_path(source_value.root_name(), target_value.root_name())) return true;
  const auto relative = target_value.lexically_relative(source_value);
  if (relative.empty()) return false;
  bool leaves_source = false;
  for (const auto& component : relative) {
    if (same_path(component, "..")) {
      leaves_source = true;
      break;
    }
  }
  return leaves_source;
}

bool marked_fixture(const std::filesystem::path& root) {
  std::error_code error;
  const auto status = std::filesystem::symlink_status(root / kMarker, error);
  return !error && !std::filesystem::is_symlink(status) &&
      std::filesystem::is_regular_file(status);
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

bool fingerprint(const std::filesystem::path& path, std::uintmax_t& size,
    std::uint64_t& value) {
  std::ifstream input(path, std::ios::binary);
  if (!input) return false;
  value = 14695981039346656037ull;
  size = 0;
  char buffer[8192];
  while (input.read(buffer, sizeof(buffer)) || input.gcount() > 0) {
    const auto count = input.gcount();
    for (std::streamsize index = 0; index < count; ++index) {
      value ^= static_cast<unsigned char>(buffer[index]);
      value *= 1099511628211ull;
    }
    size += static_cast<std::uintmax_t>(count);
  }
  return input.eof();
}

bool collect(const std::filesystem::path& root,
    std::vector<FileReceipt>& receipts, bool native = false) {
  receipts.clear();
  std::error_code error;
  for (std::filesystem::recursive_directory_iterator iterator(
           root, std::filesystem::directory_options::none, error),
       end; iterator != end; iterator.increment(error)) {
    if (error) return false;
    const auto status = iterator->symlink_status(error);
    if (error) return false;
    if (std::filesystem::is_symlink(status)) {
      return false;
    }
    if (!std::filesystem::is_regular_file(status)) continue;
    const auto relative = std::filesystem::relative(iterator->path(), root, error);
    if (error) return false;
    if (relative.generic_string().find_first_of("\r\n") != std::string::npos) return false;
    if (relative.generic_string() == kMarker ||
        relative.generic_string() == kBackupMarker ||
        (native && relative.filename() == ".native.lock")) continue;
    FileReceipt receipt{relative.generic_string(), 0, 0};
    if (!fingerprint(iterator->path(), receipt.size, receipt.fingerprint)) return false;
    receipts.push_back(std::move(receipt));
  }
  if (error) return false;
  std::sort(receipts.begin(), receipts.end(),
      [](const auto& left, const auto& right) {
        return left.relative_path < right.relative_path;
      });
  return true;
}

bool verify(const std::filesystem::path& root,
    const std::vector<FileReceipt>& receipts) {
  for (const auto& receipt : receipts) {
    std::uintmax_t size = 0;
    std::uint64_t value = 0;
    if (!fingerprint(root / std::filesystem::path(receipt.relative_path),
                     size, value) ||
        size != receipt.size || value != receipt.fingerprint) {
      return false;
    }
  }
  return true;
}

app::Result copy_tree(const std::filesystem::path& source,
    const std::filesystem::path& target, Report& report, bool native = false) {
  if (!valid_roots(source, target)) {
    return app::Result::failure("备份源和目标必须是不同的绝对路径");
  }
  if (has_symlink_component(target.parent_path())) {
    return app::Result::failure("备份目标父目录不能经过符号链接");
  }
  if (!native && !marked_fixture(source)) {
    return app::Result::failure("只允许带迁移夹具标记的隔离源");
  }
  std::error_code error;
  const auto target_status = std::filesystem::symlink_status(target, error);
  if (error && error != std::make_error_code(std::errc::no_such_file_or_directory) &&
      error.value() != ERROR_FILE_NOT_FOUND && error.value() != ERROR_PATH_NOT_FOUND) {
    return app::Result::failure("读取备份目标失败");
  }
  if (!error && target_status.type() != std::filesystem::file_type::not_found) {
    return app::Result::failure("备份目标必须不存在，避免覆盖已有数据");
  }
  error.clear();
  if (!collect(source, report.receipts, native)) {
    return app::Result::failure("读取隔离夹具失败");
  }
  report.source_verified = verify(source, report.receipts);
  if (!report.source_verified) {
    return app::Result::failure("隔离源校验失败");
  }
  std::filesystem::create_directories(target.parent_path(), error);
  if (error || !std::filesystem::create_directory(target, error) || error) {
    return app::Result::failure("创建备份目标失败或目标已被占用");
  }
  for (const auto& receipt : report.receipts) {
    const auto from = source / std::filesystem::path(receipt.relative_path);
    const auto to = target / std::filesystem::path(receipt.relative_path);
    std::filesystem::create_directories(to.parent_path(), error);
    if (error) break;
    std::filesystem::copy_file(from, to, std::filesystem::copy_options::none,
        error);
    if (error) break;
  }
  if (!error) {
    std::ofstream marker(target / (native ? kBackupMarker : kMarker), std::ios::binary | std::ios::trunc);
    marker << (native ? "CodeWeave native data backup v1\n" : "fixture-backup\n");
    if (native) {
      for (const auto& receipt : report.receipts) {
        marker << receipt.size << ' ' << receipt.fingerprint << ' '
            << std::quoted(receipt.relative_path) << '\n';
      }
    }
    if (!marker) error = std::make_error_code(std::errc::io_error);
  }
  if (error || !verify(target, report.receipts)) {
    report.issues.push_back("target_verification_failed");
    std::error_code ignored;
    std::filesystem::remove_all(target, ignored);
    return app::Result::failure("备份目标校验失败");
  }
  // A concurrent writer must not turn a partial point-in-time copy into a
  // successful backup. Compare the source again after the copy.
  std::vector<FileReceipt> after;
  if (!collect(source, after, native) || after.size() != report.receipts.size() ||
      !std::equal(after.begin(), after.end(), report.receipts.begin(),
          [](const auto& left, const auto& right) {
            return left.relative_path == right.relative_path &&
                left.size == right.size && left.fingerprint == right.fingerprint;
          })) {
    report.issues.push_back("source_changed_during_backup");
    std::error_code ignored;
    std::filesystem::remove_all(target, ignored);
    return app::Result::failure("备份期间源数据发生变化，未提交副本");
  }
  report.target = target;
  report.target_verified = true;
  report.committed = true;
  return app::Result::success("隔离备份已创建");
}

}  // namespace

app::Result create_fixture_backup(const std::filesystem::path& source,
    const std::filesystem::path& target, Report& report) {
  report = {};
  report.fixture_only = true;
  return copy_tree(source, target, report);
}

app::Result restore_fixture_backup(const std::filesystem::path& backup,
    const std::filesystem::path& target, Report& report) {
  report = {};
  report.fixture_only = true;
  const auto result = copy_tree(backup, target, report);
  if (result.ok) report.target = target;
  return result.ok ? app::Result::success("隔离备份已恢复") : result;
}

app::Result rollback_fixture_target(const std::filesystem::path& target,
    Report& report) {
  if (!report.fixture_only || !report.committed || target.empty() ||
      !target.is_absolute() || report.target != target) {
    return app::Result::failure("隔离备份回滚条件不满足");
  }
  std::error_code error;
  std::filesystem::remove_all(target, error);
  if (error) return app::Result::failure("隔离备份回滚失败");
  report.rolled_back = true;
  report.committed = false;
  return app::Result::success("隔离备份已回滚");
}

app::Result create_native_backup(const std::filesystem::path& source,
    const std::filesystem::path& target, Report& report) {
  report = {};
  if (source.empty() || !source.is_absolute() || has_symlink_component(source)) {
    return app::Result::failure("原生备份源路径无效");
  }
  // The account store is the format authority. Reading a missing profile is
  // valid for new users, but an arbitrary directory must not be accepted.
  std::error_code error;
  bool native_data = false;
  for (const auto& name : {"profile", "accounts", "drafts", "learning"}) {
    if (std::filesystem::is_directory(source / name, error)) native_data = true;
    if (error && error != std::make_error_code(std::errc::no_such_file_or_directory)
#ifdef _WIN32
        && error.value() != ERROR_FILE_NOT_FOUND && error.value() != ERROR_PATH_NOT_FOUND
#endif
        ) {
      return app::Result::failure("读取原生备份源失败");
    }
    error.clear();
  }
  if (!native_data) return app::Result::failure("所选目录不包含原生数据结构");
  codeweave::account::AccountStore accounts(source);
  std::vector<codeweave::account::Record> records;
  if (!accounts.list_accounts(records).ok) return app::Result::failure("原生账户数据校验失败");
  return copy_tree(source, target, report, true);
}

app::Result restore_native_backup(const std::filesystem::path& backup,
    const std::filesystem::path& target, Report& report) {
  report = {};
  if (backup.empty() || !backup.is_absolute() || has_symlink_component(backup)) {
    return app::Result::failure("原生备份路径无效");
  }
  std::error_code error;
  const auto marker = backup / kBackupMarker;
  const auto status = std::filesystem::symlink_status(marker, error);
  if (error || !std::filesystem::is_regular_file(status) || std::filesystem::is_symlink(status)) {
    return app::Result::failure("所选目录不是原生备份");
  }
  std::ifstream input(marker, std::ios::binary);
  std::string header;
  std::getline(input, header);
  if (header != "CodeWeave native data backup v1") return app::Result::failure("原生备份版本无效");
  if (std::filesystem::file_size(marker, error) > 16 * 1024 * 1024 || error) {
    return app::Result::failure("原生备份清单过大");
  }
  std::vector<FileReceipt> expected;
  std::string line;
  while (std::getline(input, line)) {
    if (line.size() > 65536 || expected.size() >= 100000) {
      return app::Result::failure("原生备份清单超过上限");
    }
    std::istringstream parser(line);
    FileReceipt receipt;
    if (!(parser >> receipt.size >> receipt.fingerprint >> std::quoted(receipt.relative_path)) ||
        !(parser >> std::ws).eof()) return app::Result::failure("原生备份清单损坏");
    expected.push_back(std::move(receipt));
  }
  if (!input.eof()) return app::Result::failure("读取原生备份清单失败");
  std::vector<FileReceipt> actual;
  if (!collect(backup, actual, true) || expected.size() != actual.size() ||
      !std::equal(expected.begin(), expected.end(), actual.begin(),
          [](const auto& left, const auto& right) {
            return left.relative_path == right.relative_path && left.size == right.size &&
                left.fingerprint == right.fingerprint;
          })) return app::Result::failure("原生备份内容与清单不一致");
  input.close();
  const auto result = create_native_backup(backup, target, report);
  return result.ok ? app::Result::success("原生备份已恢复到新目录") : result;
}

}  // namespace codeweave::backup

