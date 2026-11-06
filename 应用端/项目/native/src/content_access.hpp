#pragma once

#include "app_core.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::content {

enum class Visibility { Private, Shared, Public };

struct VaultBinding {
  std::string vault_id;
  std::string owner_id;
  std::filesystem::path root;
  Visibility visibility{Visibility::Private};
  bool read_only{true};
};

struct Attachment {
  std::string attachment_id;
  std::filesystem::path relative_path;
  std::string content_hash;
  std::uintmax_t size{};
};

struct AccessReport {
  bool owner_verified{};
  bool read_only{};
  bool path_safe{};
  bool attachments_verified{};
  std::vector<std::string> issues;
};

app::Result validate_binding(const VaultBinding& binding);
app::Result inspect_attachment(const VaultBinding& binding,
    const Attachment& attachment, AccessReport& report);

}  // namespace codeweave::content
