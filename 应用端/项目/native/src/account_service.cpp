#include "account_service.hpp"

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

#include <array>

namespace {
std::string new_account_id() {
#ifdef _WIN32
  std::array<unsigned char, 16> bytes{};
  if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) return {};
  constexpr char digits[] = "0123456789abcdef";
  std::string id = "native-user-";
  for (const auto byte : bytes) { id.push_back(digits[byte >> 4]); id.push_back(digits[byte & 0x0f]); }
  return id;
#else
  return {};
#endif
}
}

namespace codeweave::account {

AccountService::AccountService(AccountStore& store) : store_(store) {}

app::Result AccountService::register_account(std::string name, std::string identifier,
    std::string_view password) {
  if (name.empty() || name.size() > 128) return app::Result::failure("账户名称长度无效");
  if (password.empty() || password.size() > 128) return app::Result::failure("密码长度无效");
  std::string email;
  std::string phone;
  if (is_email(identifier)) email = std::move(identifier);
  else if (is_phone(identifier)) phone = normalized_phone(identifier);
  else return app::Result::failure("邮箱或手机号格式无效");
  const auto id = new_account_id();
  if (id.empty()) return app::Result::failure("生成账户 ID 失败");
  Record created;
  const auto result = store_.register_with_password(id, std::move(email), std::move(phone),
      std::move(name), password, created);
  if (!result.ok) return result;
  current_ = std::move(created);
  return app::Result::success("注册成功，已登录原生账户");
}

app::Result AccountService::login(std::string_view identifier, std::string_view password) {
  if (identifier.empty() || password.empty() || password.size() > 128) return app::Result::failure("账户或凭据无效");
  Record authenticated;
  const auto result = store_.authenticate_password(identifier, password, authenticated);
  if (!result.ok) return result;
  current_ = std::move(authenticated);
  return app::Result::success("登录成功");
}

app::Result AccountService::change_password(std::string_view current_password,
    std::string_view new_password) {
  if (!current_) return app::Result::failure("请先登录");
  const auto result = store_.change_password(current_->id, current_password, new_password);
  if (!result.ok) return result;
  const auto identifier = current_->email.empty() ? current_->phone : current_->email;
  Record refreshed;
  const auto refreshed_result = store_.authenticate_password(identifier, new_password, refreshed);
  if (!refreshed_result.ok) return app::Result::failure("密码已保存但会话刷新失败");
  current_ = std::move(refreshed);
  return app::Result::success("密码已修改");
}

app::Result AccountService::logout() {
  current_.reset();
  return app::Result::success("已退出原生账户");
}

app::Result AccountService::adopt_authenticated_record(Record record) {
  const auto valid = validate(record);
  if (!valid.ok) return app::Result::failure("认证账户记录无效");
  current_ = std::move(record);
  return app::Result::success("认证会话已接管");
}

app::Result AccountService::learning_data_root(
    const std::filesystem::path& native_data_root,
    std::filesystem::path& result) const {
  result.clear();
  if (!current_) return app::Result::failure("请先登录后再访问学习数据");
  if (native_data_root.empty() || !native_data_root.is_absolute()) {
    return app::Result::failure("原生数据根必须是绝对路径");
  }
  const auto accounts_root = native_data_root.lexically_normal() / "accounts";
  const auto account_root = accounts_root / current_->id;
  std::error_code error;
  std::filesystem::path candidate;
  for (const auto& component : account_root) {
    candidate /= component;
    if (candidate == account_root.root_name() || candidate == account_root.root_path()) continue;
    const auto status = std::filesystem::symlink_status(candidate, error);
    bool missing = error == std::make_error_code(std::errc::no_such_file_or_directory);
#ifdef _WIN32
    missing = missing || error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND;
#endif
    if (error && !missing) {
      return app::Result::failure("读取账户学习数据根失败");
    }
    error.clear();
    if (std::filesystem::is_symlink(status) ||
        (status.type() != std::filesystem::file_type::not_found &&
         !std::filesystem::is_directory(status))) {
      return app::Result::failure("账户学习数据根不能是符号链接");
    }
  }
  result = account_root;
  return app::Result::success("账户学习数据根已解析");
}

}  // namespace codeweave::account
