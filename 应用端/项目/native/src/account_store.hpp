#pragma once

#include "account.hpp"

#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

namespace codeweave::account {

class AccountStore final {
 public:
  explicit AccountStore(std::filesystem::path data_root);

  app::Result register_account(const Record& record);
  app::Result register_with_password(std::string id, std::string email, std::string phone,
      std::string name, std::string_view password, Record& created);
  app::Result list_accounts(std::vector<Record>& records) const;
  app::Result authenticate_hash(std::string_view identifier, std::string_view password_hash,
                                Record& record) const;
  app::Result authenticate_password(std::string_view identifier, std::string_view password,
                                    Record& record) const;
  app::Result change_password(std::string_view identifier, std::string_view current_password,
                              std::string_view new_password);

 private:
  std::filesystem::path path() const;
  std::filesystem::path data_root_;
  mutable std::mutex mutex_;
};

}  // namespace codeweave::account
