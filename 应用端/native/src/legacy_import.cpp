#include "legacy_import.hpp"
#include "account_store.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <fstream>
#include <map>
#include <set>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace codeweave::migration {
namespace {
constexpr std::size_t kMaxJsonBytes = 16 * 1024 * 1024;

struct Json {
  enum class Type { Object, Array, String, Number, Boolean, Null } type{Type::Null};
  std::map<std::string, Json> object;
  std::vector<Json> array;
  std::string text;
};

// A bounded parser used only at the explicit import boundary. Duplicate keys,
// excessive nesting, non-JSON numbers and invalid UTF-8 are rejected.
class Parser {
 public:
  explicit Parser(std::string_view text) : text_(text) {}
  bool parse(Json& out) { return value(out, 0) && (space(), at_ == text_.size()); }
 private:
  void space() { while (at_ < text_.size() && (text_[at_] == ' ' || text_[at_] == '\t' ||
      text_[at_] == '\r' || text_[at_] == '\n')) ++at_; }
  bool take(char c) { space(); if (at_ == text_.size() || text_[at_] != c) return false; ++at_; return true; }
  bool hex(unsigned& value) {
    value = 0;
    for (int i = 0; i < 4; ++i) {
      if (at_ == text_.size()) return false;
      const char c = text_[at_++];
      const int n = c >= '0' && c <= '9' ? c-'0' :
          c >= 'a' && c <= 'f' ? c-'a'+10 : c >= 'A' && c <= 'F' ? c-'A'+10 : -1;
      if (n < 0) return false;
      value = value * 16 + n;
    }
    return true;
  }
  bool string(std::string& out) {
    if (!take('"')) return false;
    out.clear();
    while (at_ < text_.size()) {
      const auto c = static_cast<unsigned char>(text_[at_++]);
      if (c == '"') return true;
      if (c < 32) return false;
      if (c != '\\') { out.push_back(static_cast<char>(c)); continue; }
      if (at_ == text_.size()) return false;
      const char escaped = text_[at_++];
      if (escaped == '"' || escaped == '\\' || escaped == '/') out.push_back(escaped);
      else if (escaped == 'b') out.push_back('\b');
      else if (escaped == 'f') out.push_back('\f');
      else if (escaped == 'n') out.push_back('\n');
      else if (escaped == 'r') out.push_back('\r');
      else if (escaped == 't') out.push_back('\t');
      else if (escaped == 'u') {
        unsigned cp = 0;
        if (!hex(cp) || cp == 0) return false;
        if (cp >= 0xd800 && cp <= 0xdbff) {
          if (at_ + 2 > text_.size() || text_.substr(at_, 2) != "\\u") return false;
          at_ += 2; unsigned low = 0;
          if (!hex(low) || low < 0xdc00 || low > 0xdfff) return false;
          cp = 0x10000 + ((cp-0xd800)<<10) + low-0xdc00;
        } else if (cp >= 0xdc00 && cp <= 0xdfff) return false;
        if (cp < 0x80) out.push_back(static_cast<char>(cp));
        else if (cp < 0x800) { out.push_back(static_cast<char>(0xc0|(cp>>6))); out.push_back(static_cast<char>(0x80|(cp&63))); }
        else if (cp < 0x10000) { out.push_back(static_cast<char>(0xe0|(cp>>12))); out.push_back(static_cast<char>(0x80|((cp>>6)&63))); out.push_back(static_cast<char>(0x80|(cp&63))); }
        else { out.push_back(static_cast<char>(0xf0|(cp>>18))); out.push_back(static_cast<char>(0x80|((cp>>12)&63))); out.push_back(static_cast<char>(0x80|((cp>>6)&63))); out.push_back(static_cast<char>(0x80|(cp&63))); }
      } else return false;
    }
    return false;
  }
  bool value(Json& out, unsigned depth) {
    if (depth > 32 || ++nodes_ > 100000) return false;
    space(); if (at_ == text_.size()) return false;
    const char c = text_[at_];
    if (c == '"') { out.type = Json::Type::String; return string(out.text); }
    if (c == '{') {
      ++at_; out.type = Json::Type::Object;
      if (take('}')) return true;
      do {
        std::string key; Json item;
        if (!string(key) || !take(':') || !value(item, depth+1) ||
            !out.object.emplace(key, std::move(item)).second) return false;
        if (take('}')) return true;
      } while (take(','));
      return false;
    }
    if (c == '[') {
      ++at_; out.type = Json::Type::Array;
      if (take(']')) return true;
      do { Json item; if (!value(item, depth+1)) return false; out.array.push_back(std::move(item));
        if (take(']')) return true; } while (take(','));
      return false;
    }
    for (const auto literal : {"true", "false", "null"}) {
      const std::string_view token(literal);
      if (text_.substr(at_, token.size()) == token) {
        at_ += token.size(); out.type = token == "null" ? Json::Type::Null : Json::Type::Boolean;
        out.text = token; return true;
      }
    }
    const auto start = at_;
    if (text_[at_] == '-') ++at_;
    if (at_ == text_.size()) return false;
    if (text_[at_] == '0') ++at_;
    else {
      if (text_[at_] < '1' || text_[at_] > '9') return false;
      while (at_ < text_.size() && text_[at_] >= '0' && text_[at_] <= '9') ++at_;
    }
    if (at_ < text_.size() && text_[at_] == '.') {
      ++at_; const auto digits = at_;
      while (at_ < text_.size() && text_[at_] >= '0' && text_[at_] <= '9') ++at_;
      if (at_ == digits) return false;
    }
    if (at_ < text_.size() && (text_[at_] == 'e' || text_[at_] == 'E')) {
      ++at_; if (at_ < text_.size() && (text_[at_] == '+' || text_[at_] == '-')) ++at_;
      const auto digits = at_;
      while (at_ < text_.size() && text_[at_] >= '0' && text_[at_] <= '9') ++at_;
      if (at_ == digits) return false;
    }
    out.type = Json::Type::Number; out.text = text_.substr(start, at_-start); return true;
  }
  std::string_view text_;
  std::size_t at_{}, nodes_{};
};

bool safe_path(const std::filesystem::path& path) {
  if (path.empty() || !path.is_absolute()) return false;
  std::filesystem::path current;
  for (const auto& part : path) {
    if (part == "..") return false;
    current /= part;
    if (current == path.root_name() || current == path.root_path()) continue;
    std::error_code error;
    const auto status = std::filesystem::symlink_status(current, error);
    bool missing = error == std::make_error_code(std::errc::no_such_file_or_directory);
#ifdef _WIN32
    missing = missing || error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND;
#endif
    if ((error && !missing) || std::filesystem::is_symlink(status)) return false;
  }
  return true;
}

bool read_json(const std::filesystem::path& source, std::string& contents, Json& out) {
  if (!safe_path(source)) return false;
  std::error_code error;
  if (!std::filesystem::is_regular_file(source, error) || error) return false;
  const auto size = std::filesystem::file_size(source, error);
  if (error || size == 0 || size > kMaxJsonBytes) return false;
  std::ifstream input(source, std::ios::binary);
  contents.resize(static_cast<std::size_t>(size));
  if (!input.read(contents.data(), static_cast<std::streamsize>(size))) return false;
  if (input.peek() != std::char_traits<char>::eof() || contents.find('\0') != std::string::npos) return false;
#ifdef _WIN32
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, contents.data(),
      static_cast<int>(contents.size()), nullptr, 0)) return false;
#endif
  return Parser(contents).parse(out);
}

bool fields(const Json& value, const std::set<std::string>& allowed) {
  if (value.type != Json::Type::Object) return false;
  return std::all_of(value.object.begin(), value.object.end(),
      [&](const auto& item) { return allowed.contains(item.first); });
}
bool field(const Json& value, std::string_view key, std::string& out, bool optional = false) {
  const auto found = value.object.find(std::string(key));
  if (found == value.object.end()) { out.clear(); return optional; }
  if (found->second.type != Json::Type::String) return false;
  out = found->second.text; return true;
}
bool create_target(const std::filesystem::path& target) {
  if (!safe_path(target)) return false;
  std::error_code error;
  std::filesystem::create_directories(target.parent_path(), error);
  return !error && std::filesystem::create_directory(target, error) && !error;
}
void remove_created_target(const std::filesystem::path& target) {
  std::error_code ignored; std::filesystem::remove_all(target, ignored);
}
bool no_sensitive_fields(const Json& value) {
  for (const auto& [key,item] : value.object) {
    auto lower = key;
    std::transform(lower.begin(), lower.end(), lower.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lower == "password" || lower == "passwordhash" || lower == "token" ||
        lower == "cookie" || lower == "secret" || lower == "apikey" ||
        lower == "authorization" || !no_sensitive_fields(item)) return false;
  }
  for (const auto& item : value.array) if (!no_sensitive_fields(item)) return false;
  return true;
}
}  // namespace

app::Result import_legacy_users(const std::filesystem::path& source,
    const std::filesystem::path& target, LegacyImportReport& report) {
  report = {};
  Json root; std::string contents;
  if (!read_json(source, contents, root) || root.type != Json::Type::Array ||
      root.array.empty() || root.array.size() > 10000) return app::Result::failure("旧账户 JSON 格式或大小无效");
  std::vector<account::Record> accounts;
  std::set<std::string> ids, emails, phones;
  for (const auto& user : root.array) {
    account::Record record;
    if (!fields(user, {"id","name","email","phone","passwordHash","bio","createdAt"}) ||
        !field(user,"id",record.id) || !field(user,"name",record.name) ||
        !field(user,"email",record.email,true) || !field(user,"phone",record.phone,true) ||
        !field(user,"passwordHash",record.password_hash) || !account::validate(record).ok ||
        !ids.insert(record.id).second ||
        (!record.email.empty() && !emails.insert(record.email).second) ||
        (!record.phone.empty() && !phones.insert(account::normalized_phone(record.phone)).second)) {
      return app::Result::failure("旧账户存在无效字段或重复标识");
    }
    for (const auto key : {"bio", "createdAt"}) {
      std::string ignored; if (!field(user,key,ignored,true)) return app::Result::failure("旧账户元数据类型无效");
    }
    accounts.push_back(std::move(record));
  }
  if (!create_target(target)) return app::Result::failure("导入目标必须是尚不存在的绝对目录");
  account::AccountStore store(target);
  for (const auto& account : accounts) {
    if (!store.register_account(account).ok) {
      remove_created_target(target); return app::Result::failure("账户导入失败，未提交新目录");
    }
  }
  // Preserve legacy profile metadata (bio/createdAt) alongside the converted
  // store instead of silently dropping fields the native record does not own.
  bool archived = false;
  {
    std::ofstream archive(target / "profile" / "legacy-users.json", std::ios::binary);
    archive.write(contents.data(), static_cast<std::streamsize>(contents.size()));
    archive.flush(); archived = archive.good();
  }
  Json verified; std::string archived_contents;
  if (!archived || !read_json(target / "profile" / "legacy-users.json", archived_contents, verified) ||
      archived_contents != contents) {
    remove_created_target(target); return app::Result::failure("旧账户元数据存档校验失败");
  }
  report = {true, accounts.size(), 0, target};
  return app::Result::success("旧账户已导入新目录，原文件未修改");
}

app::Result import_legacy_learning(const std::filesystem::path& source,
    const std::string& account_id, const std::filesystem::path& target,
    LegacyImportReport& report) {
  report = {};
  Json root; std::string contents, schema, scope, exported;
  if (!read_json(source, contents, root) ||
      !fields(root, {"schema","version","exportedAt","scope","categories","data"}) ||
      !field(root,"schema",schema) || schema != "codeweave.learning-data" ||
      !field(root,"scope",scope) || scope != account_id || scope.empty() ||
      !field(root,"exportedAt",exported) || exported.empty()) return app::Result::failure("学习导出文件或账户范围无效");
  const auto version = root.object.find("version"), data = root.object.find("data"),
      categories = root.object.find("categories");
  if (version == root.object.end() || version->second.type != Json::Type::Number ||
      version->second.text != "1" || data == root.object.end() ||
      data->second.type != Json::Type::Object || categories == root.object.end() ||
      categories->second.type != Json::Type::Array) return app::Result::failure("学习导出版本或数据结构无效");
  const std::set<std::string> bases{"code-canvas.workspace.v2","code-canvas.projects.v1",
      "code-canvas.challenge-progress.v2","code-canvas.checkin.v1","code-canvas.mastery.v1",
      "code-canvas.challenge-drafts.v1","code-canvas.external-evidence.v1"};
  if (categories->second.array.size() > bases.size() || !no_sensitive_fields(data->second)) {
    return app::Result::failure("学习导出类别过多或含认证字段");
  }
  std::set<std::string> declared_bases;
  for (const auto& category : categories->second.array) {
    std::string base, category_scope, label;
    if (!fields(category, {"base","category","label"}) ||
        !field(category,"base",base) || !bases.contains(base) ||
        !declared_bases.insert(base).second || !field(category,"category",category_scope) ||
        category_scope != "account" || !field(category,"label",label)) {
      return app::Result::failure("学习导出类别描述无效");
    }
  }
  for (const auto& [key,value] : data->second.object) {
    const auto separator = key.rfind(':');
    if (separator == std::string::npos || key.substr(separator+1) != scope ||
        !bases.contains(key.substr(0,separator)) ||
        value.type != Json::Type::Object) return app::Result::failure("学习导出含未知类别或跨账户数据");
  }
  if (!create_target(target)) return app::Result::failure("历史导入目标必须是尚不存在的绝对目录");
  bool written = false;
  {
    std::ofstream output(target / "legacy-learning.json", std::ios::binary);
    output.write(contents.data(), static_cast<std::streamsize>(contents.size()));
    output.flush(); written = output.good();
  }
  if (!written) { remove_created_target(target); return app::Result::failure("保存历史学习文件失败"); }
  Json verified; std::string saved_contents;
  if (!read_json(target / "legacy-learning.json", saved_contents, verified) ||
      saved_contents != contents) {
    remove_created_target(target); return app::Result::failure("历史学习文件写入校验失败");
  }
  report = {true, 0, data->second.object.size(), target};
  return app::Result::success("学习历史已保存为只读参考，未提升正式进度");
}
}  // namespace codeweave::migration
