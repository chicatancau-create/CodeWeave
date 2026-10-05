#include "content_access.hpp"
#include "content_contract.hpp"

#include <fstream>
#include <array>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

namespace codeweave::content {
namespace {

bool safe_relative(const std::filesystem::path& path) {
  if (path.empty() || path.is_absolute() || path.has_root_name() ||
      path.has_root_directory()) return false;
  for (const auto& part : path) {
    if (part == ".." || part == ".") return false;
  }
  return true;
}

bool has_symlink_component(const std::filesystem::path& root,
    const std::filesystem::path& relative) {
  auto current = root;
  std::error_code error;
  for (const auto& component : relative) {
    current /= component;
    const auto status = std::filesystem::symlink_status(current, error);
    if (error) return true;
    if (std::filesystem::is_symlink(status)) return true;
  }
  return false;
}

std::string hex(const unsigned char* bytes, std::size_t size) {
  constexpr char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(size * 2);
  for (std::size_t index = 0; index < size; ++index) {
    result.push_back(digits[bytes[index] >> 4]);
    result.push_back(digits[bytes[index] & 0x0f]);
  }
  return result;
}

bool sha256(const std::filesystem::path& path, std::string& result) {
#ifdef _WIN32
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) return false;
  DWORD object_size = 0;
  DWORD result_size = 0;
  bool ok = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
      reinterpret_cast<PUCHAR>(&object_size), sizeof(object_size), &result_size, 0) == 0;
  std::vector<unsigned char> object(object_size);
  std::array<unsigned char, 32> digest{};
  ok = ok && BCryptCreateHash(algorithm, &hash, object.data(), object_size,
      nullptr, 0, 0) == 0;
  std::ifstream input(path, std::ios::binary);
  char buffer[8192];
  while (ok && (input.read(buffer, sizeof(buffer)) || input.gcount() > 0)) {
    ok = BCryptHashData(hash, reinterpret_cast<PUCHAR>(buffer),
        static_cast<ULONG>(input.gcount()), 0) == 0;
  }
  if (ok) ok = input.eof() && BCryptFinishHash(hash, digest.data(),
      static_cast<ULONG>(digest.size()), 0) == 0;
  if (hash) BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (ok) result = hex(digest.data(), digest.size());
  return ok;
#else
  (void)path; (void)result;
  return false;
#endif
}

}  // namespace

app::Result validate_binding(const VaultBinding& binding) {
  if (!is_stable_id(binding.vault_id) || !is_stable_id(binding.owner_id)) {
    return app::Result::failure("资料库 ID 或拥有者 ID 无效");
  }
  if (binding.root.empty() || !binding.root.is_absolute()) {
    return app::Result::failure("资料库根目录必须是绝对路径");
  }
  if (!binding.read_only) {
    return app::Result::failure("原生资料库绑定必须只读");
  }
  return app::Result::success("资料库绑定有效");
}

app::Result inspect_attachment(const VaultBinding& binding,
    const Attachment& attachment, AccessReport& report) {
  report = {};
  const auto valid = validate_binding(binding);
  if (!valid.ok) {
    report.issues.push_back(valid.message);
    return valid;
  }
  report.owner_verified = true;
  report.read_only = binding.read_only;
  std::error_code root_status_error;
  const auto root_status = std::filesystem::symlink_status(binding.root, root_status_error);
  if (root_status_error || std::filesystem::is_symlink(root_status) ||
      !std::filesystem::is_directory(root_status)) {
    report.issues.push_back("资料库根目录类型无效");
    return app::Result::failure("资料库根目录类型无效");
  }
  if (!safe_relative(attachment.relative_path)) {
    report.issues.push_back("附件路径必须是资料库内的相对路径");
    return app::Result::failure("附件路径越界");
  }
  report.path_safe = true;
  if (has_symlink_component(binding.root, attachment.relative_path)) {
    report.issues.push_back("附件路径包含符号链接组件");
    return app::Result::failure("附件路径不能经过符号链接");
  }
  if (attachment.attachment_id.empty() || attachment.content_hash.size() != 64) {
    report.issues.push_back("附件 ID 或 hash 无效");
    return app::Result::failure("附件元数据无效");
  }
  std::error_code error;
  const auto root = std::filesystem::weakly_canonical(binding.root, error);
  const auto file = std::filesystem::weakly_canonical(binding.root / attachment.relative_path, error);
  const auto relative = error ? std::filesystem::path{} : std::filesystem::relative(file, root, error);
  if (error || relative.empty() || relative.is_absolute() || relative == ".." ||
      relative.string().starts_with("..\\") || relative.generic_string().starts_with("../")) {
    report.issues.push_back("附件解析路径越界或不可访问");
    return app::Result::failure("附件解析路径无效");
  }
  const auto file_status = std::filesystem::symlink_status(file, error);
  if (error || std::filesystem::is_symlink(file_status) ||
      !std::filesystem::is_regular_file(file_status)) {
    report.issues.push_back("附件不存在");
    return app::Result::failure("附件不存在");
  }
  const auto size = std::filesystem::file_size(file, error);
  std::string actual_hash;
  if (error || size != attachment.size || !sha256(file, actual_hash) ||
      actual_hash != attachment.content_hash) {
    report.issues.push_back("附件大小与清单不一致");
    return app::Result::failure("附件内容校验失败");
  }
  report.attachments_verified = true;
  return app::Result::success("附件元数据已验证（只读）");
}

}  // namespace codeweave::content
