#include "migration_dry_run.hpp"

#include <algorithm>

namespace codeweave::migration {

app::Result inspect_read_only(const std::filesystem::path& root, Report& report) {
  report = {};
  if (root.empty() || !root.is_absolute()) return app::Result::failure("迁移预检根目录必须是绝对路径");
  std::error_code error;
  const auto root_status = std::filesystem::symlink_status(root, error);
  if (error || !std::filesystem::is_directory(root_status) || std::filesystem::is_symlink(root_status)) {
    return app::Result::failure("迁移预检根目录不存在或不可访问");
  }
  // A migration preflight must fail closed. Permission-denied entries must
  // not be silently omitted from a report that claims a complete scan.
  std::filesystem::recursive_directory_iterator iterator(root,
      std::filesystem::directory_options::none, error);
  if (error) return app::Result::failure("迁移预检无法打开根目录");
  const auto end = std::filesystem::recursive_directory_iterator{};
  for (; iterator != end; iterator.increment(error)) {
    if (error) {
      report.issues.push_back("directory_scan_failed");
      return app::Result::failure("迁移预检无法完整扫描目录");
    }
    const auto& item = *iterator;
    const auto relative = std::filesystem::relative(item.path(), root, error);
    if (error) {
      report.issues.push_back("relative_path_failed");
      return app::Result::failure("迁移预检无法解析相对路径");
    }
    const auto status = item.symlink_status(error);
    if (error) {
      report.issues.push_back("metadata_read_failed");
      return app::Result::failure("迁移预检无法读取文件元数据");
    }
    const bool symlink = std::filesystem::is_symlink(status);
    const bool directory = std::filesystem::is_directory(status);
    const bool regular = std::filesystem::is_regular_file(status);
    std::uintmax_t size = 0;
    if (regular) {
      size = item.file_size(error);
      if (error) {
        report.issues.push_back("file_size_failed");
        return app::Result::failure("迁移预检无法读取文件大小");
      }
    }
    report.entries.push_back({relative.generic_string(), size, directory, regular, symlink});
    if (directory) ++report.directory_count;
    if (regular) ++report.file_count;
    if (symlink) report.issues.push_back("symlink_not_migrated:" + relative.generic_string());
    if (symlink) iterator.disable_recursion_pending();
  }
  // increment(error) may set the iterator to end, bypassing the loop body.
  if (error) {
    report.issues.push_back("directory_scan_failed");
    return app::Result::failure("迁移预检无法完整扫描目录");
  }
  std::sort(report.entries.begin(), report.entries.end(), [](const Entry& left, const Entry& right) {
    return left.relative_path < right.relative_path;
  });
  return report.issues.empty() ? app::Result::success("迁移只读预检完成")
      : app::Result::failure("迁移预检包含不可复制项目");
}

}  // namespace codeweave::migration

