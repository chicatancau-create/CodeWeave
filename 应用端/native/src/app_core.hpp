#pragma once

#include <filesystem>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>

namespace codeweave::app {

struct Result {
  bool ok{};
  std::string message;

  static Result success(std::string message = {}) { return {true, std::move(message)}; }
  static Result failure(std::string message) { return {false, std::move(message)}; }
};

class ApplicationCore final {
 public:
  ~ApplicationCore();

  Result open_workspace(const std::filesystem::path& workspace);
  Result open_workspace(const std::filesystem::path& workspace,
      const std::filesystem::path& data_root);
  Result close_workspace();
  Result save_draft(std::string_view draft_id, std::string_view contents);
  Result load_draft(std::string_view draft_id, std::string& contents) const;

  [[nodiscard]] bool is_open() const noexcept { return open_; }
  [[nodiscard]] const std::filesystem::path& workspace() const noexcept { return workspace_; }
  [[nodiscard]] const std::filesystem::path& data_root() const noexcept { return data_root_; }

 private:
  static Result validate_id(std::string_view draft_id);
  static Result write_atomically(const std::filesystem::path& destination, std::string_view contents);
  static std::filesystem::path draft_path(const std::filesystem::path& data_root, std::string_view draft_id);

  bool open_{};
  std::filesystem::path workspace_;
  std::filesystem::path data_root_;
  std::intptr_t lock_handle_{-1};
};

}  // namespace codeweave::app
