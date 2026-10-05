#include "account_store.hpp"
#include "password_crypto.hpp"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <random>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::account {
namespace {

constexpr std::uintmax_t kMaxAccountFileBytes = 16 * 1024 * 1024;
constexpr std::size_t kMaxAccountLineBytes = 256 * 1024;

std::string encode_hex(std::string_view value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string encoded; encoded.reserve(value.size() * 2);
  for (const unsigned char byte : value) { encoded.push_back(digits[byte >> 4]); encoded.push_back(digits[byte & 0x0f]); }
  return encoded;
}

bool decode_hex(std::string_view value, std::string& output) {
  if (value.size() % 2 != 0) return false;
  const auto digit = [](char value) -> int {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
  };
  output.clear(); output.reserve(value.size() / 2);
  for (size_t index = 0; index < value.size(); index += 2) {
    const int high = digit(value[index]); const int low = digit(value[index + 1]);
    if (high < 0 || low < 0) return false;
    output.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

bool split(std::string_view line, std::vector<std::string_view>& fields) {
  fields.clear(); size_t start = 0;
  while (start <= line.size()) {
    const auto end = line.find('\t', start);
    fields.push_back(line.substr(start, end == std::string_view::npos ? line.size() - start : end - start));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  return fields.size() == 5;
}

bool parse(std::string_view line, Record& record) {
  if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
  std::vector<std::string_view> fields; if (!split(line, fields)) return false;
  std::vector<std::string> values(5);
  for (size_t index = 0; index < values.size(); ++index) if (!decode_hex(fields[index], values[index])) return false;
  record = {std::move(values[0]), std::move(values[1]), std::move(values[2]), std::move(values[3]), std::move(values[4])};
  return validate(record).ok;
}

std::string temporary_suffix() {
  return ".tmp." + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "." + std::to_string(std::random_device{}());
}

app::Result write_atomically(const std::filesystem::path& destination, std::string_view contents) {
  auto temporary = destination; temporary += temporary_suffix();
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return app::Result::failure("无法创建账户临时文件");
    output.write(contents.data(), static_cast<std::streamsize>(contents.size())); output.flush();
    if (!output) { std::error_code ignored; std::filesystem::remove(temporary, ignored); return app::Result::failure("写入账户文件失败"); }
  }
#ifdef _WIN32
  const auto temporary_handle = CreateFileW(
      temporary.wstring().c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (temporary_handle == INVALID_HANDLE_VALUE || !FlushFileBuffers(temporary_handle)) {
    if (temporary_handle != INVALID_HANDLE_VALUE) CloseHandle(temporary_handle);
    std::error_code ignored;
    std::filesystem::remove(temporary, ignored);
    return app::Result::failure("刷盘账户文件失败");
  }
  CloseHandle(temporary_handle);
#endif
  std::error_code error;
#ifdef _WIN32
  if (!MoveFileExW(temporary.wstring().c_str(), destination.wstring().c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
#else
  std::filesystem::rename(temporary, destination, error);
#endif
  if (error) { std::error_code ignored; std::filesystem::remove(temporary, ignored); return app::Result::failure("提交账户文件失败"); }
  return app::Result::success("账户文件已保存");
}

bool same_identifier(const Record& record, std::string_view identifier) {
  return record.id == identifier || (!record.email.empty() && record.email == identifier) || (!record.phone.empty() && normalized_phone(record.phone) == normalized_phone(identifier));
}

bool constant_time_equal(std::string_view left, std::string_view right) {
  const size_t length = std::max(left.size(), right.size()); unsigned char difference = static_cast<unsigned char>(left.size() ^ right.size());
  for (size_t index = 0; index < length; ++index) {
    const unsigned char lhs = index < left.size() ? static_cast<unsigned char>(left[index]) : 0; const unsigned char rhs = index < right.size() ? static_cast<unsigned char>(right[index]) : 0; difference = static_cast<unsigned char>(difference | (lhs ^ rhs));
  }
  return difference == 0;
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

bool has_symlink_component(const std::filesystem::path& value) {
  auto current = std::filesystem::path{};
  std::error_code error;
  for (const auto& component : value) {
    current /= component;
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

app::Result list_accounts_unlocked(const std::filesystem::path& path,
    const std::filesystem::path& data_root, std::vector<Record>& records) {
  records.clear();
  if (data_root.empty() || !data_root.is_absolute()) {
    return app::Result::failure("账户数据根必须是绝对路径");
  }
  std::error_code status_error;
  const auto file_status = std::filesystem::symlink_status(path, status_error);
  if (status_error && status_error.value() != ERROR_FILE_NOT_FOUND &&
      status_error.value() != ERROR_PATH_NOT_FOUND &&
      status_error != std::make_error_code(std::errc::no_such_file_or_directory)) {
    return app::Result::failure("读取账户文件状态失败");
  }
  status_error.clear();
  if (file_status.type() == std::filesystem::file_type::not_found) {
    return app::Result::success("账户文件尚不存在");
  }
  if (std::filesystem::is_symlink(file_status) ||
      !std::filesystem::is_regular_file(file_status)) {
    return app::Result::failure("账户文件类型无效");
  }
  std::ifstream input(path, std::ios::binary);
  if (!input) return app::Result::failure("打开账户文件失败");
  std::error_code size_error;
  if (const auto size = std::filesystem::file_size(path, size_error);
      size_error || size > kMaxAccountFileBytes) {
    return app::Result::failure("账户文件超过大小上限");
  }
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    if (line.size() > kMaxAccountLineBytes) return app::Result::failure("账户记录超过大小上限");
    Record record;
    if (!parse(line, record)) return app::Result::failure("账户文件存在无效记录");
    records.push_back(std::move(record));
  }
  return input.eof() ? app::Result::success("账户已读取")
                    : app::Result::failure("读取账户文件失败");
}

}  // namespace

AccountStore::AccountStore(std::filesystem::path data_root) : data_root_(std::move(data_root)) {}
std::filesystem::path AccountStore::path() const { return data_root_ / "profile" / "accounts.v1.tsv"; }

app::Result AccountStore::list_accounts(std::vector<Record>& records) const {
  std::lock_guard lock(mutex_);
  return list_accounts_unlocked(path(), data_root_, records);
}

app::Result AccountStore::register_account(const Record& record) {
  std::lock_guard lock(mutex_);
  const auto valid = validate(record); if (!valid.ok) return valid; std::vector<Record> records; const auto loaded = list_accounts_unlocked(path(), data_root_, records); if (!loaded.ok) return loaded;
  if (std::any_of(records.begin(), records.end(), [&record](const Record& existing) { return existing.id == record.id || (!record.email.empty() && existing.email == record.email) || (!record.phone.empty() && normalized_phone(existing.phone) == normalized_phone(record.phone)); })) return app::Result::failure("账户 ID 或联系方式已存在");
  records.push_back(record); if (has_symlink_component(path().parent_path())) return app::Result::failure("账户目录路径不能经过符号链接"); std::error_code error; std::filesystem::create_directories(path().parent_path(), error); if (error) return app::Result::failure("创建账户目录失败");
  std::string serialized; for (const auto& item : records) serialized += encode_hex(item.id) + '\t' + encode_hex(item.email) + '\t' + encode_hex(item.phone) + '\t' + encode_hex(item.name) + '\t' + encode_hex(item.password_hash) + '\n';
  return write_atomically(path(), serialized);
}

app::Result AccountStore::register_with_password(std::string id, std::string email, std::string phone,
    std::string name, std::string_view password, Record& created) {
  std::string password_hash;
  const auto hashed = hash_password(password, password_hash);
  if (!hashed.ok) return hashed;
  created = {std::move(id), std::move(email), std::move(phone), std::move(name), std::move(password_hash)};
  return register_account(created);
}

app::Result AccountStore::authenticate_hash(std::string_view identifier, std::string_view password_hash, Record& record) const {
  std::lock_guard lock(mutex_);
  if (identifier.empty() || password_hash.empty()) return app::Result::failure("登录凭据无效"); std::vector<Record> records; const auto loaded = list_accounts_unlocked(path(), data_root_, records); if (!loaded.ok) return loaded;
  const auto found = std::find_if(records.begin(), records.end(), [identifier](const Record& item) { return same_identifier(item, identifier); });
  if (found == records.end() || !constant_time_equal(found->password_hash, password_hash)) return app::Result::failure("账户或凭据无效");
  record = *found; return app::Result::success("登录凭据有效");
}

app::Result AccountStore::authenticate_password(std::string_view identifier, std::string_view password,
    Record& record) const {
  std::lock_guard lock(mutex_);
  if (password.empty() || password.size() > 128) return app::Result::failure("账户或凭据无效");
  std::vector<Record> records;
  const auto loaded = list_accounts_unlocked(path(), data_root_, records);
  if (!loaded.ok) return loaded;
  const auto found = std::find_if(records.begin(), records.end(), [identifier](const Record& item) {
    return same_identifier(item, identifier);
  });
  if (found == records.end()) return app::Result::failure("账户或凭据无效");
  bool matches = false;
  const auto verified = verify_password(password, found->password_hash, matches);
  if (!verified.ok || !matches) return app::Result::failure("账户或凭据无效");
  record = *found;
  return app::Result::success("登录凭据有效");
}

app::Result AccountStore::change_password(std::string_view identifier, std::string_view current_password,
    std::string_view new_password) {
  std::lock_guard lock(mutex_);
  if (new_password.empty() || new_password.size() > 128) return app::Result::failure("新密码长度无效");
  Record current;
  std::vector<Record> records;
  const auto loaded = list_accounts_unlocked(path(), data_root_, records);
  if (!loaded.ok) return loaded;
  const auto found_current = std::find_if(records.begin(), records.end(), [identifier](const Record& item) {
    return same_identifier(item, identifier);
  });
  if (found_current == records.end()) return app::Result::failure("账户或凭据无效");
  bool matches = false;
  const auto verified = verify_password(current_password, found_current->password_hash, matches);
  if (!verified.ok || !matches) return app::Result::failure("账户或凭据无效");
  current = *found_current;
  std::string replacement;
  const auto hashed = hash_password(new_password, replacement);
  if (!hashed.ok) return hashed;
  const auto found = std::find_if(records.begin(), records.end(), [&current](const Record& item) { return item.id == current.id; });
  if (found == records.end()) return app::Result::failure("账户不存在");
  found->password_hash = std::move(replacement);
  std::string serialized;
  for (const auto& item : records) serialized += encode_hex(item.id) + '\t' + encode_hex(item.email) + '\t' + encode_hex(item.phone) + '\t' + encode_hex(item.name) + '\t' + encode_hex(item.password_hash) + '\n';
  if (has_symlink_component(path().parent_path())) return app::Result::failure("账户目录路径不能经过符号链接");
  std::error_code error; std::filesystem::create_directories(path().parent_path(), error); if (error) return app::Result::failure("创建账户目录失败");
  return write_atomically(path(), serialized);
}

}  // namespace codeweave::account
