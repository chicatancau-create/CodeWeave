#pragma once

#include "app_core.hpp"

#include <string>
#include <string_view>

namespace codeweave::account {

app::Result hash_password_with_salt(std::string_view password, std::string_view salt_hex,
    std::string& encoded_hash);
app::Result hash_password(std::string_view password, std::string& encoded_hash);
app::Result verify_password(std::string_view password, std::string_view encoded_hash, bool& matches);

}  // namespace codeweave::account
