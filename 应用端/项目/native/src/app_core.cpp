#include "app_core.hpp"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <random>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::app {
namespace {

constexpr std::string_view kWorkspaceMarker = "config/codeweave.config.example.json";
constexpr std::string_view kDraftDirectory = "drafts";
constexpr std::size_t kMaxDraftBytes = 4 * 1024 * 1024;

std::string error_message(std::string_view action, const std::error_code& error) {
  return std::string(action) + ": " + error.message();
}

bool is_missing_path_error(const std::error_code& error) {
  if (!error) return false;
  if (error == std::make_error_code(std::errc::no_such_file_or_directory)) return true;
#ifdef _WIN32
  return error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND;
#else
  return false;
#endif
}

std::string temporary_suffix() {
  const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
  std::random_device random;
  return ".tmp." + std::to_string(now) + "." + std::to_string(random());
}

bool has_symlink_component(const std::filesystem::path& value) {
  auto current = std::filesystem::path{};
  std::error_code error;
  for (const auto& component : value) {
    current /= component;
    // On Windows, probing the drive root with symlink_status may report a
    // platform-specific error even though the root is a valid directory.
    // Root names cannot be symlink components, so skip them explicitly.
    if (current == value.root_name() || current == value.root_path()) continue;
    const auto status = std::filesystem::symlink_status(current, error);
    if (!error && std::filesystem::is_symlink(status)) return true;
    if (is_missing_path_error(error)) {
      error.clear();
      continue;
    }
    if (error) return true;
  }
  return false;
}

}  // namespace

ApplicationCore::~ApplicationCore() { close_workspace(); }

Result ApplicationCore::open_workspace(const std::filesystem::path& workspace) {
  return open_workspace(workspace, {});
}

Result ApplicationCore::open_workspace(const std::filesystem::path& workspace,
    const std::filesystem::path& requested_data_root) {
  if (open_) return Result::failure("工作区已经打开");
  if (workspace.empty()) return Result::failure("工作区路径不能为空");

  std::error_code error;
  const auto absolute = std::filesystem::absolute(workspace, error);
  if (error) return Result::failure(error_message("解析工作区路径失败", error));
  const auto workspace_status = std::filesystem::symlink_status(absolute, error);
  if (error || std::filesystem::is_symlink(workspace_status) ||
      !std::filesystem::is_directory(workspace_status)) {
    if (error) return Result::failure(error_message("读取工作区失败", error));
    return Result::failure("工作区目录不存在: " + absolute.string());
  }
  if (!std::filesystem::is_regular_file(absolute / kWorkspaceMarker, error)) {
    if (error) return Result::failure(error_message("读取工作区标记失败", error));
    return Result::failure("工作区缺少配置标记: " + (absolute / kWorkspaceMarker).string());
  }
  std::error_code marker_status_error;
  const auto marker_status = std::filesystem::symlink_status(absolute / kWorkspaceMarker,
      marker_status_error);
  if (marker_status_error || std::filesystem::is_symlink(marker_status)) {
    return Result::failure("工作区配置标记不能是符号链接");
  }

  const auto data_root = requested_data_root.empty()
      ? absolute / "data" / "runtime" / "native"
      : std::filesystem::absolute(requested_data_root, error);
  if (error || data_root.empty() || !data_root.is_absolute()) {
    return Result::failure("解析应用数据根失败");
  }
  const auto data_absolute = std::filesystem::absolute(data_root, error);
  if (error || data_absolute.empty() || !data_absolute.is_absolute()) {
    return Result::failure("解析应用数据根失败");
  }
  const auto data_status = std::filesystem::symlink_status(data_absolute, error);
  if (error && !is_missing_path_error(error)) {
    return Result::failure(error_message("读取应用数据根失败", error));
  }
  if (!error && std::filesystem::is_symlink(data_status)) {
    return Result::failure("应用数据根不能是符号链接");
  }
  if (has_symlink_component(data_absolute)) {
    return Result::failure("应用数据根路径不能经过符号链接");
  }
  error.clear();
  std::filesystem::create_directories(data_absolute / kDraftDirectory, error);
  if (error) return Result::failure(error_message("创建应用数据目录失败", error));

#ifdef _WIN32
  const auto lock_path = (data_absolute / ".native.lock").wstring();
  const auto handle = CreateFileW(lock_path.c_str(), GENERIC_READ, FILE_SHARE_READ,
      nullptr, CREATE_NEW, FILE_ATTRIBUTE_HIDDEN | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    if (GetLastError() == ERROR_FILE_EXISTS) return Result::failure("工作区正被另一个应用实例使用");
    return Result::failure("创建工作区锁失败");
  }
  lock_handle_ = reinterpret_cast<std::intptr_t>(handle);
#else
  const auto lock_path = data_absolute / ".native.lock";
  if (!std::filesystem::create_directory(lock_path, error)) {
    return Result::failure(error ? error_message("创建工作区锁失败", error) : "工作区正被另一个应用实例使用");
  }
#endif

  workspace_ = absolute;
  data_root_ = data_absolute;
  open_ = true;
  return Result::success("工作区已打开");
}

Result ApplicationCore::close_workspace() {
  if (!open_) return Result::success();
#ifdef _WIN32
  if (lock_handle_ != -1) {
    CloseHandle(reinterpret_cast<HANDLE>(lock_handle_));
    lock_handle_ = -1;
  }
#else
  std::error_code error;
  std::filesystem::remove(data_root_ / ".native.lock", error);
  if (error) return Result::failure(error_message("释放工作区锁失败", error));
#endif
  open_ = false;
  workspace_.clear();
  data_root_.clear();
  return Result::success("工作区已关闭");
}

Result ApplicationCore::validate_id(std::string_view draft_id) {
  if (draft_id.empty() || draft_id.size() > 96) return Result::failure("草稿 ID 长度无效");
  for (const char character : draft_id) {
    const bool valid = (character >= 'a' && character <= 'z') ||
                       (character >= 'A' && character <= 'Z') ||
                       (character >= '0' && character <= '9') || character == '-' || character == '_';
    if (!valid) return Result::failure("草稿 ID 含有非法字符");
  }
  return Result::success();
}

std::filesystem::path ApplicationCore::draft_path(const std::filesystem::path& data_root,
                                                   std::string_view draft_id) {
  return data_root / kDraftDirectory / (std::string(draft_id) + ".txt");
}

Result ApplicationCore::write_atomically(const std::filesystem::path& destination,
                                         std::string_view contents) {
  auto temporary = destination;
  temporary += temporary_suffix();
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return Result::failure("无法创建草稿临时文件: " + temporary.string());
    output.write(contents.data(), static_cast<std::streamsize>(contents.size()));
    output.flush();
    if (!output) {
      std::error_code ignored;
      std::filesystem::remove(temporary, ignored);
      return Result::failure("写入草稿失败: " + temporary.string());
    }
  }

#ifdef _WIN32
  // `ofstream::flush` only hands bytes to the OS cache. Flush the temporary
  // file before the atomic replace so a successful save survives an immediate
  // power loss more reliably on Windows.
  const auto temporary_handle = CreateFileW(
      temporary.wstring().c_str(), GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (temporary_handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(temporary_handle)) {
    if (temporary_handle != INVALID_HANDLE_VALUE) CloseHandle(temporary_handle);
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return Result::failure("刷盘草稿失败: " + temporary.string());
  }
  CloseHandle(temporary_handle);
#endif

  std::error_code error;
#ifdef _WIN32
  if (!MoveFileExW(std::filesystem::path(temporary).wstring().c_str(), destination.wstring().c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
  }
#else
  std::filesystem::rename(temporary, destination, error);
#endif
  if (error) {
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return Result::failure(error_message("提交草稿失败", error));
  }
  return Result::success("草稿已保存");
}

Result ApplicationCore::save_draft(std::string_view draft_id, std::string_view contents) {
  if (!open_) return Result::failure("尚未打开工作区");
  if (has_symlink_component(data_root_ / kDraftDirectory)) {
    return Result::failure("草稿目录路径不能经过符号链接");
  }
  const auto valid = validate_id(draft_id);
  if (!valid.ok) return valid;
  if (contents.size() > kMaxDraftBytes) return Result::failure("草稿超过大小上限");
  if (contents.find('\0') != std::string_view::npos) return Result::failure("草稿不能包含 NUL 字节");
  const auto destination = draft_path(data_root_, draft_id);
  std::error_code status_error;
  const auto status = std::filesystem::symlink_status(destination, status_error);
  if (status_error && !is_missing_path_error(status_error)) {
    return Result::failure("读取草稿目标状态失败");
  }
  if (!status_error && (std::filesystem::is_symlink(status) ||
      !std::filesystem::is_regular_file(status))) {
    return Result::failure("草稿目标文件类型无效");
  }
  return write_atomically(destination, contents);
}

Result ApplicationCore::load_draft(std::string_view draft_id, std::string& contents) const {
  if (!open_) return Result::failure("尚未打开工作区");
  const auto valid = validate_id(draft_id);
  if (!valid.ok) return valid;
  const auto path = draft_path(data_root_, draft_id);
  std::error_code status_error;
  const auto file_status = std::filesystem::symlink_status(path, status_error);
  if (status_error) return Result::failure("读取草稿状态失败");
  if (file_status.type() == std::filesystem::file_type::not_found) {
    return Result::failure("草稿不存在");
  }
  if (std::filesystem::is_symlink(file_status) ||
      !std::filesystem::is_regular_file(file_status)) {
    return Result::failure("草稿文件类型无效");
  }
  std::ifstream input(path, std::ios::binary);
  if (!input) return Result::failure("打开草稿失败");
  input.seekg(0, std::ios::end);
  const auto size = input.tellg();
  if (size < 0 || static_cast<std::uintmax_t>(size) > kMaxDraftBytes) {
    return Result::failure("草稿超过大小上限");
  }
  input.seekg(0, std::ios::beg);
  contents.assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
  if (!input.eof() && input.fail()) return Result::failure("读取草稿失败");
  return Result::success("草稿已读取");
}

}  // namespace codeweave::app
