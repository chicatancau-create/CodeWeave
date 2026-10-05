#pragma once

#include "app_core.hpp"

#include <string>

namespace codeweave::account {

struct Record {
  std::string id;
  std::string email;
  std::string phone;
  std::string name;
  std::string password_hash;
};

app::Result validate(const Record& record);
std::string normalized_phone(std::string_view value);
bool is_email(std::string_view value);
bool is_phone(std::string_view value);
bool is_supported_password_hash(std::string_view value);

}  // namespace codeweave::account
