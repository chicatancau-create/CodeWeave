#pragma once

#include "account_store.hpp"

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace codeweave::account {

class AccountService final {
 public:
  explicit AccountService(AccountStore& store);
  app::Result register_account(std::string name, std::string identifier, std::string_view password);
  app::Result login(std::string_view identifier, std::string_view password);
  app::Result change_password(std::string_view current_password, std::string_view new_password);
  app::Result logout();
  // Resolve an account-owned learning root without creating it. Callers must
  // snapshot this before constructing learning stores; no-session access fails
  // closed instead of falling back to a shared ledger.
  app::Result learning_data_root(const std::filesystem::path& native_data_root,
      std::filesystem::path& result) const;
  [[nodiscard]] bool authenticated() const noexcept { return current_.has_value(); }
  [[nodiscard]] const std::optional<Record>& current() const noexcept { return current_; }

 private:
  AccountStore& store_;
  std::optional<Record> current_;
};

}  // namespace codeweave::account
