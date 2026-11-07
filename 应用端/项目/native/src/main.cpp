#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <commdlg.h>
#include <shlobj.h>
#endif

#include "app_core.hpp"
#include "account_service.hpp"
#include "account_store.hpp"
#include "content_repository.hpp"
#include "challenge_service.hpp"
#include "evidence_store.hpp"
#include "progress_store.hpp"
#include "execution_contract.hpp"
#include "execution_service.hpp"
#include "trace_store.hpp"
#include "review_service.hpp"
#include "backup_service.hpp"
#include "legacy_import.hpp"
#include "external_evidence_service.hpp"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cwctype>
#include <charconv>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <random>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <vector>
#ifdef _WIN32
#include <bcrypt.h>
#ifndef EM_SETCUEBANNER
// Older MinGW headers omit the edit control cue-banner message.
#define EM_SETCUEBANNER (WM_USER + 1)
#endif
#endif

namespace {
constexpr wchar_t kClassName[] = L"CodeWeaveNativeWindow";
constexpr int kDraftEditId = 1001;
constexpr int kSaveButtonId = 1002;
constexpr int kValidateExecutionButtonId = 1003;
constexpr int kRunExecutionButtonId = 1007;
constexpr int kCancelExecutionButtonId = 1008;
constexpr int kPauseExecutionButtonId = 1024;
constexpr int kResumeExecutionButtonId = 1025;
constexpr int kStepExecutionButtonId = 1026;
constexpr int kTraceStatusId = 1027;
constexpr int kReviewButtonId = 1028;
constexpr int kReviewStatusId = 1029;
constexpr int kSessionEditId = 1004;
constexpr int kLanguageEditId = 1005;
constexpr int kTimeoutEditId = 1006;
constexpr int kListContentButtonId = 1009;
constexpr int kContentListId = 1010;
constexpr int kContentBodyId = 1011;
constexpr int kAccountIdentifierId = 1012;
constexpr int kAccountNameId = 1013;
constexpr int kAccountPasswordId = 1014;
constexpr int kAccountRegisterId = 1015;
constexpr int kAccountLoginId = 1016;
constexpr int kAccountLogoutId = 1017;
constexpr int kAccountStatusId = 1018;
constexpr int kAccountNewPasswordId = 1019;
constexpr int kAccountChangePasswordId = 1020;
constexpr int kExerciseId = 1021;
constexpr int kProgressStatusId = 1022;
constexpr int kIndependentCheckId = 1023;
constexpr int kToolButtonId = 1030;
constexpr int kOutputId = 1031;
constexpr int kHintId = 1032;
constexpr int kScratchId = 1033;
constexpr int kBackupId = 1040;
constexpr int kRestoreId = 1041;
constexpr int kImportUsersId = 1042;
constexpr int kImportLearningId = 1043;
constexpr int kOpenDataId = 1044;
constexpr int kExternalEvidenceId = 1045;
constexpr UINT kExecutionResultMessage = WM_APP + 11;
constexpr int kMinimumClientWidth = 1180;
constexpr int kMinimumClientHeight = 720;
constexpr int kMaximumDraftCharacters = 4 * 1024 * 1024;
constexpr int kMaximumAccountCharacters = 256;

#ifdef _WIN32
HWND g_draft_edit = nullptr;
HWND g_output = nullptr;
HFONT g_ui_font = nullptr;
std::filesystem::path g_executable_directory;
HWND g_status = nullptr;
HWND g_session_edit = nullptr;
HWND g_language_edit = nullptr;
HWND g_timeout_edit = nullptr;
HWND g_run_button = nullptr;
HWND g_cancel_button = nullptr;
HWND g_pause_button = nullptr;
HWND g_resume_button = nullptr;
HWND g_step_button = nullptr;
HWND g_trace_status = nullptr;
HWND g_review_status = nullptr;
HWND g_content_list = nullptr;
HWND g_content_body = nullptr;
HWND g_account_identifier = nullptr;
HWND g_account_name = nullptr;
HWND g_account_password = nullptr;
HWND g_account_new_password = nullptr;
HWND g_account_status = nullptr;
HWND g_exercise_id = nullptr;
HWND g_progress_status = nullptr;
HWND g_independent_check = nullptr;
codeweave::app::ApplicationCore g_core;
codeweave::app::ApplicationCore g_personal_core;
std::string g_selected_content;
std::string g_execution_policy = "native";
std::string g_starter;
std::string g_content_language;
bool g_hint_viewed = false;
bool g_hint_read_failed = false;
bool g_draft_read_failed = false;
bool g_draft_dirty = false;
bool g_loading_draft = false;
codeweave::execution::ExecutionService g_execution;
std::shared_ptr<codeweave::execution::TraceStore> g_trace_store;
std::unique_ptr<codeweave::account::AccountStore> g_account_store;
std::unique_ptr<codeweave::account::AccountService> g_account_service;
std::shared_ptr<codeweave::learning::EvidenceStore> g_evidence_store;
std::shared_ptr<codeweave::learning::ProgressStore> g_progress_store;
std::shared_ptr<codeweave::learning::ChallengeService> g_challenge_service;
std::thread g_execution_thread;
std::atomic<bool> g_execution_running{false};
std::atomic<bool> g_execution_cancelled{false};
codeweave::execution::ExecutionControl g_execution_control;
std::atomic<bool> g_window_closing{false};
bool g_gui_smoke = false;
bool g_gui_interaction_smoke = false;
bool g_gui_smoke_ok = false;
std::mutex g_result_mutex;
std::atomic<std::uint64_t> g_execution_generation{0};
struct PendingResult {
  std::uint64_t generation{};
  std::unique_ptr<codeweave::execution::ServiceResult> result;
  std::string challenge_message;
};
std::deque<PendingResult> g_result_queue;
HANDLE g_single_instance = nullptr;

void layout_controls(HWND window, int width, int height) {
  if (!g_draft_edit) return;
  width = std::max(width, kMinimumClientWidth);
  height = std::max(height, kMinimumClientHeight);
  const int left = width * 3 / 5;
  const int right = left + 24;
  const int bottom = height - 210;
  MoveWindow(g_draft_edit, 24, 142, left - 36, bottom - 142, TRUE);
  MoveWindow(g_output, 24, bottom + 8, left - 36, 92, TRUE);
  MoveWindow(g_content_list, right, 142, width - right - 24, (bottom - 142) / 3, TRUE);
  const int body_top = 152 + (bottom - 142) / 3;
  MoveWindow(g_content_body, right, body_top, width - right - 24, bottom + 100 - body_top, TRUE);
  MoveWindow(GetDlgItem(window, kToolButtonId), 24, 110, 140, 26, TRUE);
  MoveWindow(g_language_edit, 170, 110, 110, 26, TRUE);
  MoveWindow(g_timeout_edit, 286, 110, 80, 26, TRUE);
  MoveWindow(GetDlgItem(window, kValidateExecutionButtonId), 372, 110, 116, 26, TRUE);
  MoveWindow(g_run_button, 494, 110, 100, 26, TRUE);
  MoveWindow(g_cancel_button, 600, 110, 70, 26, TRUE);
  MoveWindow(g_pause_button, 676, 110, 60, 26, TRUE);
  MoveWindow(g_resume_button, 742, 110, 60, 26, TRUE);
  MoveWindow(g_step_button, 808, 110, 60, 26, TRUE);
  MoveWindow(GetDlgItem(window, kListContentButtonId), 874, 110, 100, 26, TRUE);
  MoveWindow(GetDlgItem(window, kHintId), 980, 110, 80, 26, TRUE);
  MoveWindow(GetDlgItem(window, kScratchId), 1066, 110, 80, 26, TRUE);
  MoveWindow(GetDlgItem(window, kSaveButtonId), 24, height - 100, 110, 28, TRUE);
  MoveWindow(GetDlgItem(window, kReviewButtonId), 140, height - 100, 140, 28, TRUE);
  MoveWindow(g_exercise_id, 286, height - 100, 210, 28, TRUE);
  MoveWindow(g_independent_check, 502, height - 100, 130, 28, TRUE);
  MoveWindow(g_progress_status, 640, height - 100, width - 664, 28, TRUE);
  MoveWindow(g_review_status, 24, height - 66, left - 36, 24, TRUE);
  MoveWindow(g_trace_status, right, height - 66, width - right - 24, 24, TRUE);
  MoveWindow(g_status, 24, height - 34, width - 48, 24, TRUE);
  ShowWindow(g_session_edit, SW_HIDE);
}

std::string utf8_from_wide(std::wstring_view value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string result(static_cast<size_t>(size), '\0');
  return WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr) == size ? result : std::string{};
}

std::wstring wide_from_utf8(std::string_view value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(static_cast<size_t>(size), L'\0');
  return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size) == size ? result : std::wstring{};
}

std::string current_date() {
  SYSTEMTIME now{};
  GetLocalTime(&now);
  char buffer[11]{};
  std::snprintf(buffer, sizeof(buffer), "%04u-%02u-%02u",
      static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth),
      static_cast<unsigned>(now.wDay));
  return buffer;
}

std::string operation_id_for(std::string_view session_id, std::uint64_t generation) {
  std::string token;
  for (const unsigned char character : session_id) {
    if (std::isalnum(character) != 0) token.push_back(static_cast<char>(std::tolower(character)));
    if (token.size() == 20) break;
  }
  if (token.size() < 6) token += "native";
  if (token.size() > 20) token.resize(20);
  constexpr char digits[] = "0123456789abcdef";
  std::uint32_t nonce = static_cast<std::uint32_t>(generation);
#ifdef _WIN32
  BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&nonce), sizeof(nonce), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
#endif
  std::string suffix;
  for (int shift = 20; shift >= 0; shift -= 4) suffix.push_back(digits[(nonce >> shift) & 0x0f]);
  return "op-" + token + "-" + suffix;
}

std::string evidence_id_for(std::string_view session_id, std::uint64_t generation) {
  std::string token;
  for (const unsigned char character : session_id) {
    if (std::isalnum(character) != 0) token.push_back(static_cast<char>(std::tolower(character)));
    if (token.size() == 40) break;
  }
  if (token.size() < 6) token += "native";
  constexpr char digits[] = "0123456789abcdef";
  std::uint32_t nonce = static_cast<std::uint32_t>(generation);
#ifdef _WIN32
  BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&nonce), sizeof(nonce), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
#endif
  std::string suffix;
  for (int shift = 20; shift >= 0; shift -= 4) suffix.push_back(digits[(nonce >> shift) & 0x0f]);
  return "evidence-" + token + "-" + suffix;
}

void set_status(std::wstring_view status) { if (g_status) SetWindowTextW(g_status, std::wstring(status).c_str()); }
void set_account_status(std::wstring_view status) { if (g_account_status) SetWindowTextW(g_account_status, std::wstring(status).c_str()); }
void set_edit_cue(HWND control, std::wstring_view cue) {
  if (!control) return;
  SendMessageW(control, EM_SETCUEBANNER, TRUE,
      reinterpret_cast<LPARAM>(std::wstring(cue).c_str()));
}
void set_edit_limit(HWND control, int characters) {
  if (!control) return;
  SendMessageW(control, EM_SETLIMITTEXT, static_cast<WPARAM>(characters), 0);
}
std::string control_text(HWND control) {
  const int length = GetWindowTextLengthW(control);
  std::wstring value(static_cast<size_t>(length) + 1, L'\0');
  if (length > 0) GetWindowTextW(control, value.data(), length + 1);
  value.resize(static_cast<size_t>(length));
  auto text = utf8_from_wide(value);
  for (size_t at = 0; (at = text.find("\r\n", at)) != std::string::npos;) text.replace(at, 2, "\n");
  return text;
}

void set_multiline(HWND control, std::string_view text) {
  std::string normalized;
  normalized.reserve(text.size());
  for (size_t at = 0; at < text.size(); ++at) {
    if (text[at] == '\n' && (at == 0 || text[at - 1] != '\r')) normalized.push_back('\r');
    normalized.push_back(text[at]);
  }
  SetWindowTextW(control, wide_from_utf8(normalized).c_str());
}

std::string draft_id() {
  if (g_selected_content.empty()) return "scratch";
  // Content IDs are stable ASCII identifiers; hash the complete ID to stay
  // within the draft store's path limit without truncation collisions.
  unsigned char hash[32]{};
  if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0,
      reinterpret_cast<PUCHAR>(g_selected_content.data()), static_cast<ULONG>(g_selected_content.size()), hash, sizeof(hash)) != 0) return {};
  constexpr char digits[] = "0123456789abcdef";
  std::string result = "lesson-";
  for (const auto byte : hash) { result += digits[byte >> 4]; result += digits[byte & 15]; }
  return result;
}

bool persist_draft() {
  if (!g_draft_dirty) return true;
  if (g_draft_read_failed) { set_status(L"原草稿读取失败，已阻止覆盖。请从数据菜单备份并检查文件。"); return false; }
  if (!g_personal_core.is_open()) {
    set_status(L"请先登录以保存个人草稿");
    return false;
  }
  const auto result = g_personal_core.save_draft(draft_id(), control_text(g_draft_edit));
  if (!result.ok) { set_status(wide_from_utf8(result.message)); return false; }
  g_draft_dirty = false;
  return true;
}

void load_personal_draft() {
  std::string draft = g_starter;
  g_draft_read_failed = false;
  g_hint_viewed = false;
  g_hint_read_failed = false;
  if (g_personal_core.is_open()) {
    const auto id = draft_id();
    std::error_code error;
    const auto draft_path = g_personal_core.data_root() / "drafts" / (id + ".txt");
    const auto draft_status = std::filesystem::symlink_status(draft_path, error);
    const bool missing = draft_status.type() == std::filesystem::file_type::not_found &&
        (!error || error == std::make_error_code(std::errc::no_such_file_or_directory) ||
         error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND);
    if (error && !missing) {
      g_draft_read_failed = true;
      draft.clear();
      set_status(L"原草稿状态读取失败，已阻止覆盖。请检查数据目录。");
    } else if (!missing && !g_personal_core.load_draft(id, draft).ok) {
      g_draft_read_failed = true;
      draft.clear();
      set_status(L"原草稿读取失败，已阻止覆盖。请检查数据目录。");
    }
    error.clear();
    const auto hint_path = g_personal_core.data_root() / "drafts" / (id + "-hint.txt");
    const auto hint_status = std::filesystem::symlink_status(hint_path, error);
    const bool hint_missing = hint_status.type() == std::filesystem::file_type::not_found &&
        (!error || error == std::make_error_code(std::errc::no_such_file_or_directory) ||
         error.value() == ERROR_FILE_NOT_FOUND || error.value() == ERROR_PATH_NOT_FOUND);
    if (error && !hint_missing) {
      // A metadata lookup error must never silently turn an attempt into an
      // independent one. Fail closed and surface the condition to the user.
      g_hint_read_failed = true;
      g_hint_viewed = true;
      set_status(L"提示记录读取失败，本次按辅助练习处理；请检查数据目录。");
    } else if (!hint_missing) {
      std::string marker;
      const auto read_hint = g_personal_core.load_draft(id + "-hint", marker);
      if (!read_hint.ok || marker != "assisted") {
        g_hint_read_failed = true;
        g_hint_viewed = true;
        set_status(L"提示记录损坏，本次按辅助练习处理；请检查数据目录。");
      } else {
        g_hint_viewed = true;
      }
    }
  }
  g_loading_draft = true;
  set_multiline(g_draft_edit, draft);
  SendMessageW(g_draft_edit, EM_SETREADONLY, g_draft_read_failed ? TRUE : FALSE, 0);
  g_loading_draft = false;
  g_draft_dirty = false;
}

void refresh_progress_status();
void refresh_review_summary();

bool account_change_allowed() {
  if (g_execution_running.load()) {
    set_account_status(L"请等待运行结束或先取消，再切换账户");
    return false;
  }
  if (g_execution_thread.joinable()) g_execution_thread.join();
  return !g_personal_core.is_open() || persist_draft();
}

void refresh_account_stores() {
  ++g_execution_generation;
  { std::lock_guard lock(g_result_mutex); g_result_queue.clear(); }
  if (g_independent_check) SendMessageW(g_independent_check, BM_SETCHECK, BST_UNCHECKED, 0);
  g_personal_core.close_workspace();
  g_challenge_service.reset();
  g_trace_store.reset();
  g_progress_store.reset();
  g_evidence_store.reset();
  if (g_output) SetWindowTextW(g_output, L"尚无本账户的运行输出");
  if (g_trace_status) SetWindowTextW(g_trace_status, L"尚无本账户的执行轨迹");
  // Clear all previous-account views before resolving the new root. A failed
  // open must not leave the old draft or progress visible under the new login.
  g_loading_draft = true;
  if (g_draft_edit) {
    SetWindowTextW(g_draft_edit, L"");
    SendMessageW(g_draft_edit, EM_SETREADONLY, TRUE, 0);
  }
  g_loading_draft = false;
  g_draft_dirty = false;
  g_draft_read_failed = false;
  refresh_progress_status();
  refresh_review_summary();
  std::filesystem::path root;
  if (g_account_service && g_account_service->authenticated()) {
    const auto resolved = g_account_service->learning_data_root(g_core.data_root(), root);
    if (!resolved.ok) { set_account_status(wide_from_utf8(resolved.message)); return; }
    const auto opened = g_personal_core.open_workspace(g_core.workspace(), root);
    if (!opened.ok) { set_account_status(wide_from_utf8(opened.message)); return; }
    g_evidence_store = std::make_shared<codeweave::learning::EvidenceStore>(root);
    g_progress_store = std::make_shared<codeweave::learning::ProgressStore>(root);
    g_challenge_service = std::make_shared<codeweave::learning::ChallengeService>(*g_evidence_store, *g_progress_store);
    g_trace_store = std::make_shared<codeweave::execution::TraceStore>(root);
  }
  load_personal_draft();
  refresh_progress_status();
  refresh_review_summary();
}

void account_register() {
  if (!account_change_allowed()) return;
  if (!g_account_service) return;
  auto name = control_text(g_account_name);
  auto identifier = control_text(g_account_identifier);
  if (name == "姓名") name.clear();
  if (identifier == "邮箱或手机号") identifier.clear();
  const auto result = g_account_service->register_account(std::move(name),
      std::move(identifier), control_text(g_account_password));
  set_account_status(wide_from_utf8(result.message));
  if (result.ok) { refresh_account_stores(); SetWindowTextW(g_account_password, L""); SetWindowTextW(g_account_name, wide_from_utf8(g_account_service->current()->name).c_str()); }
}
void account_login() {
  if (!account_change_allowed()) return;
  if (!g_account_service) return;
  auto identifier = control_text(g_account_identifier);
  if (identifier == "邮箱或手机号") identifier.clear();
  const auto result = g_account_service->login(std::move(identifier),
      control_text(g_account_password));
  set_account_status(wide_from_utf8(result.message));
  if (result.ok) { refresh_account_stores(); SetWindowTextW(g_account_password, L""); SetWindowTextW(g_account_name, wide_from_utf8(g_account_service->current()->name).c_str()); }
}
void account_logout() {
  if (!account_change_allowed()) return;
  if (!g_account_service) return;
  set_account_status(wide_from_utf8(g_account_service->logout().message));
  refresh_account_stores();
}
void account_change_password() {
  if (!account_change_allowed()) return;
  if (!g_account_service) return;
  const auto result = g_account_service->change_password(
      control_text(g_account_password), control_text(g_account_new_password));
  set_account_status(wide_from_utf8(result.message));
}

std::filesystem::path configured_workspace() {
  wchar_t value[32768]{};
  const auto length = GetEnvironmentVariableW(L"CODEWEAVE_NATIVE_WORKSPACE", value, std::size(value));
  return length > 0 && length < std::size(value) ? std::filesystem::path(value, value + length) : std::filesystem::path{};
}

std::filesystem::path configured_data_root() {
  wchar_t value[32768]{};
  const auto length = GetEnvironmentVariableW(L"CODEWEAVE_NATIVE_DATA_ROOT", value, std::size(value));
  if (length > 0 && length < std::size(value)) return std::filesystem::path(value, value + length);
  const auto local_app_data_length = GetEnvironmentVariableW(L"LOCALAPPDATA", value, std::size(value));
  if (local_app_data_length > 0 && local_app_data_length < std::size(value)) {
    const auto base = std::filesystem::path(value, value + local_app_data_length) / L"CodeWeave";
    wchar_t selected[32768]{};
    if (GetPrivateProfileStringW(L"profile", L"active", L"", selected, static_cast<DWORD>(std::size(selected)), (base / L"profiles.ini").c_str()) > 0) return selected;
    return base;
  }
  return {};
}

bool is_workspace(const std::filesystem::path& candidate) {
  std::error_code error;
  return std::filesystem::is_regular_file(candidate / L"config" / L"codeweave.config.example.json", error);
}

std::filesystem::path locate_workspace() {
  const auto configured = configured_workspace();
  if (!configured.empty()) return configured;
  std::vector<std::filesystem::path> bases;
  wchar_t executable[32768]{};
  const auto length = GetModuleFileNameW(nullptr, executable, std::size(executable));
  if (length > 0 && length < std::size(executable)) bases.emplace_back(executable, executable + length);
  bases.push_back(std::filesystem::current_path());
  for (auto base : bases) {
    if (base.has_filename()) base = base.parent_path();
    for (int level = 0; level < 4 && !base.empty(); ++level, base = base.parent_path()) {
      for (const auto& candidate : {base, base / L"工作区", base / L"workspace"}) if (is_workspace(candidate)) return candidate;
    }
  }
  // Never create or silently select an empty workspace during startup. A
  // packaged installation must provide an explicit workspace (or the user
  // must set CODEWEAVE_NATIVE_WORKSPACE); otherwise fail visibly so data is
  // never written to an unexpected root.
  return {};
}

std::filesystem::path configured_content_root() {
  wchar_t value[32768]{};
  const auto length = GetEnvironmentVariableW(L"CODEWEAVE_NATIVE_CONTENT_ROOT", value, std::size(value));
  if (length > 0 && length < std::size(value)) return std::filesystem::path(value, value + length);
  for (const auto& candidate : {g_executable_directory / L"content",
      g_executable_directory.parent_path() / L"content",
      g_executable_directory.parent_path().parent_path() / L"content"}) {
    std::error_code error;
    if (std::filesystem::is_regular_file(candidate / L"catalog.v1.tsv", error)) return candidate;
  }
  return {};
}

std::filesystem::path configured_tool(std::string_view language) {
  std::wstring variable = L"CODEWEAVE_NATIVE_";
  if (language == "cpp") variable += L"CPP_TOOL";
  else if (language == "python") variable += L"PYTHON_TOOL";
  else if (language == "javascript") variable += L"JAVASCRIPT_TOOL";
  else if (language == "java") variable += L"JAVA_TOOL";
  else return {};
  wchar_t value[32768]{};
  const auto length = GetEnvironmentVariableW(variable.c_str(), value, std::size(value));
  if (length > 0 && length < std::size(value)) return std::filesystem::path(value, value + length);
  const auto settings = g_core.data_root() / L"tools.ini";
  const auto key = wide_from_utf8(language);
  if (GetPrivateProfileStringW(L"tools", key.c_str(), L"", value, static_cast<DWORD>(std::size(value)), settings.c_str()) > 0) return value;
  // Search PATH only, never the current working directory, for automatic tool discovery.
  wchar_t path_value[32768]{};
  const auto path_length = GetEnvironmentVariableW(L"PATH", path_value, static_cast<DWORD>(std::size(path_value)));
  if (!path_length || path_length >= std::size(path_value)) return {};
  const wchar_t* name = language == "cpp" ? L"g++.exe" : language == "java" ? L"java.exe" :
      language == "python" ? L"python.exe" : L"node.exe";
  const std::wstring paths(path_value, path_length);
  size_t offset = 0;
  while (offset < paths.size()) {
    const auto end = paths.find(L';', offset);
    auto directory = paths.substr(offset, end == std::wstring::npos ? std::wstring::npos : end - offset);
    if (directory.size() > 1 && directory.front() == L'"' && directory.back() == L'"') directory = directory.substr(1, directory.size() - 2);
    const std::filesystem::path candidate = std::filesystem::path(directory) / name;
    std::error_code error;
    if (candidate.is_absolute() && directory.find(L"WindowsApps") == std::wstring::npos && std::filesystem::is_regular_file(candidate, error)) return candidate;
    if (end == std::wstring::npos) break;
    offset = end + 1;
  }
  return {};
}

void choose_tool() {
  const auto language = control_text(g_language_edit);
  if (language != "cpp" && language != "java" && language != "python" && language != "javascript") {
    set_status(L"请先选择 cpp、java、python 或 javascript 语言"); return;
  }
  wchar_t selected[32768]{};
  OPENFILENAMEW dialog{};
  dialog.lStructSize = sizeof(dialog);
  dialog.hwndOwner = GetParent(g_status);
  dialog.lpstrFilter = L"语言工具 (*.exe)\0*.exe\0\0";
  dialog.lpstrFile = selected;
  dialog.nMaxFile = static_cast<DWORD>(std::size(selected));
  dialog.lpstrTitle = L"选择当前语言的编译器或解释器";
  dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetOpenFileNameW(&dialog)) return;
  const codeweave::execution::ProcessRequest request{selected, {}, g_core.data_root(), language};
  const auto valid = codeweave::execution::validate_process_request(request);
  if (!valid.ok || std::filesystem::path(selected).filename() == L"codeweave-cpp-runner.exe") {
    set_status(L"选择的程序不是当前语言支持的编译器或解释器"); return;
  }
  const auto settings = g_core.data_root() / L"tools.ini";
  const bool saved = WritePrivateProfileStringW(L"tools", wide_from_utf8(language).c_str(), selected, settings.c_str()) != FALSE;
  set_status(saved ? L"语言工具已保存，下次启动自动使用" : L"保存语言工具配置失败");
}

std::filesystem::path choose_directory(HWND window, const wchar_t* title) {
  BROWSEINFOW info{}; info.hwndOwner = window; info.lpszTitle = title;
  info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
  const auto item = SHBrowseForFolderW(&info);
  if (!item) return {};
  wchar_t path[MAX_PATH]{};
  const bool valid = SHGetPathFromIDListW(item, path) != FALSE;
  CoTaskMemFree(item);
  return valid ? std::filesystem::path(path) : std::filesystem::path{};
}

std::filesystem::path choose_json(HWND window) {
  wchar_t path[32768]{};
  OPENFILENAMEW dialog{}; dialog.lStructSize = sizeof(dialog); dialog.hwndOwner = window;
  dialog.lpstrFilter = L"JSON 文件\0*.json\0\0"; dialog.lpstrFile = path;
  dialog.nMaxFile = static_cast<DWORD>(std::size(path)); dialog.Flags = OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;
  return GetOpenFileNameW(&dialog) ? std::filesystem::path(path) : std::filesystem::path{};
}

bool activate_profile(const std::filesystem::path& root) {
  if (!account_change_allowed()) return false;
  g_account_service->logout();
  refresh_account_stores();
  const auto workspace = g_core.workspace();
  const auto previous = g_core.data_root();
  g_core.close_workspace();
  const auto opened = g_core.open_workspace(workspace, root);
  if (!opened.ok) { g_core.open_workspace(workspace, previous); set_status(wide_from_utf8(opened.message)); return false; }
  g_account_service.reset();
  g_account_store = std::make_unique<codeweave::account::AccountStore>(root);
  g_account_service = std::make_unique<codeweave::account::AccountService>(*g_account_store);
  wchar_t local[32768]{};
  if (GetEnvironmentVariableW(L"LOCALAPPDATA", local, static_cast<DWORD>(std::size(local))) > 0) {
    const auto settings = std::filesystem::path(local) / L"CodeWeave" / L"profiles.ini";
    std::error_code error; std::filesystem::create_directories(settings.parent_path(), error);
    if (error || !WritePrivateProfileStringW(L"profile", L"active", root.c_str(), settings.c_str())) {
      set_status(L"已打开新数据目录，但未能保存下次启动配置"); return false;
    }
  }
  set_account_status(L"数据目录已切换，请使用导入或恢复的账户登录");
  return true;
}

LRESULT CALLBACK evidence_window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_CREATE: {
      const wchar_t* labels[] = {L"运行环境 / 工具版本", L"实际执行命令", L"结果摘要（按课程验收点填写）", L"日志 / 截图引用（可选）", L"复现日期 YYYY-MM-DD"};
      const int top[] = {16, 88, 160, 322, 394};
      for (int index = 0; index < 5; ++index) {
        CreateWindowW(L"STATIC", labels[index], WS_CHILD | WS_VISIBLE, 20, top[index], 600, 22, window, nullptr, nullptr, nullptr);
        const auto edit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", index == 4 ? wide_from_utf8(current_date()).c_str() : L"", WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL | (index == 2 ? ES_MULTILINE | ES_AUTOVSCROLL | WS_VSCROLL : 0), 20, top[index] + 24, 620, index == 2 ? 120 : 32, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(2000 + index)), nullptr, nullptr);
        set_edit_limit(edit, index == 3 ? 300 : index == 4 ? 10 : 600);
      }
      CreateWindowW(L"BUTTON", L"保存待核验证据", WS_CHILD | WS_VISIBLE | WS_TABSTOP, 20, 476, 190, 32, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(2010)), nullptr, nullptr);
      CreateWindowW(L"STATIC", L"仅保存本人填写的证据，不自动标为通过或提升进度。", WS_CHILD | WS_VISIBLE, 20, 522, 630, 42, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(2011)), nullptr, nullptr);
      if (g_ui_font) EnumChildWindows(window, [](HWND child, LPARAM font) -> BOOL { SendMessageW(child, WM_SETFONT, static_cast<WPARAM>(font), TRUE); return TRUE; }, reinterpret_cast<LPARAM>(g_ui_font));
      return 0;
    }
    case WM_COMMAND:
      if (LOWORD(wparam) == 2010) {
        codeweave::learning::ExternalEvidenceFields fields{control_text(GetDlgItem(window, 2000)), control_text(GetDlgItem(window, 2001)), control_text(GetDlgItem(window, 2002)), control_text(GetDlgItem(window, 2003)), control_text(GetDlgItem(window, 2004))};
        const auto generation = g_execution_generation.fetch_add(1) + 1;
        const auto result = codeweave::learning::save_external_evidence(*g_evidence_store, g_selected_content, fields, operation_id_for("external", generation), evidence_id_for("external", generation));
        SetWindowTextW(GetDlgItem(window, 2011), wide_from_utf8(result.message).c_str());
        if (result.ok) { refresh_review_summary(); DestroyWindow(window); }
      }
      return 0;
    case WM_CLOSE: DestroyWindow(window); return 0;
    default: return DefWindowProcW(window, message, wparam, lparam);
  }
}

void show_external_evidence(HWND owner) {
  if (!g_evidence_store || g_selected_content.empty() || g_execution_policy != "external") {
    set_status(L"请先登录，并选择需在外部环境完成的课程或挑战"); return;
  }
  if (g_execution_running.load()) { set_status(L"请等待当前代码运行完成"); return; }
  WNDCLASSW klass{}; klass.hInstance = GetModuleHandleW(nullptr); klass.lpfnWndProc = evidence_window_proc;
  klass.lpszClassName = L"CodeWeaveEvidence"; klass.hCursor = LoadCursorW(nullptr, IDC_ARROW); klass.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  RegisterClassW(&klass);
  const auto dialog = CreateWindowExW(WS_EX_DLGMODALFRAME, klass.lpszClassName, L"记录外部实践证据", WS_CAPTION | WS_SYSMENU, CW_USEDEFAULT, CW_USEDEFAULT, 690, 630, owner, nullptr, klass.hInstance, nullptr);
  if (!dialog) { set_status(L"无法打开证据窗口"); return; }
  EnableWindow(owner, FALSE); ShowWindow(dialog, SW_SHOW);
  MSG message{};
  while (IsWindow(dialog) && GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (!IsDialogMessageW(dialog, &message)) { TranslateMessage(&message); DispatchMessageW(&message); }
  }
  EnableWindow(owner, TRUE); SetForegroundWindow(owner);
}

void manage_data(HWND window, int action) {
  if (g_execution_running.load()) { set_status(L"请先等待执行结束或取消任务"); return; }
  if (action == kOpenDataId) { ShellExecuteW(window, L"open", g_core.data_root().c_str(), nullptr, nullptr, SW_SHOWNORMAL); return; }
  if (g_personal_core.is_open() && !persist_draft()) return;
  if (action == kImportLearningId) {
    if (!g_account_service->authenticated()) { set_status(L"请先登录对应的旧账户"); return; }
    const auto source = choose_json(window); if (source.empty()) return;
    const auto target = g_personal_core.data_root() / ("history-" + std::to_string(GetTickCount64()));
    codeweave::migration::LegacyImportReport report;
    const auto result = codeweave::migration::import_legacy_learning(source, g_account_service->current()->id, target, report);
    set_status(wide_from_utf8(result.message));
    if (result.ok) ShellExecuteW(window, L"open", target.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    return;
  }
  const auto source = action == kImportUsersId ? choose_json(window) :
      action == kRestoreId ? choose_directory(window, L"选择 CodeWeave 备份目录") : g_core.data_root();
  if (source.empty()) return;
  const auto parent = choose_directory(window, L"选择保存位置（将在其下创建新目录，不覆盖现有数据）");
  if (parent.empty()) return;
  const auto target = parent / (std::wstring(action == kBackupId ? L"CodeWeave-backup-" : L"CodeWeave-data-") + std::to_wstring(GetTickCount64()));
  codeweave::app::Result result;
  if (action == kImportUsersId) {
    codeweave::migration::LegacyImportReport report;
    result = codeweave::migration::import_legacy_users(source, target, report);
  } else {
    codeweave::backup::Report report;
    result = action == kBackupId ? codeweave::backup::create_native_backup(source, target, report) :
        codeweave::backup::restore_native_backup(source, target, report);
  }
  if (result.ok && action != kBackupId && !activate_profile(target)) return;
  set_status(wide_from_utf8(result.message));
}

bool is_test_runner_path(const std::filesystem::path& path) {
  auto filename = path.filename().wstring();
  std::transform(filename.begin(), filename.end(), filename.begin(), [](wchar_t value) {
    return static_cast<wchar_t>(std::towlower(value));
  });
  return filename == L"codeweave-cpp-runner.exe";
}

bool is_native_ui_runnable(std::string_view language) {
  // These external interpreters are optional per-machine tools. They are only
  // runnable after the same absolute-path and process whitelist checks below.
  return language == "cpp" || language == "java" ||
      language == "python" || language == "javascript";
}

void list_content() {
  const auto root = configured_content_root();
  if (root.empty()) { set_status(L"未配置版本化课程目录（CODEWEAVE_NATIVE_CONTENT_ROOT）"); return; }
  codeweave::content::ContentRepository repository(root);
  std::vector<codeweave::content::Unit> units;
  const auto result = repository.list_published(units);
  if (!result.ok) { set_status(wide_from_utf8(result.message)); return; }
  SendMessageW(g_content_list, LB_RESETCONTENT, 0, 0);
  for (const auto& unit : units) {
    const auto display = wide_from_utf8(unit.title + " [" + unit.content_id + "]");
    SendMessageW(g_content_list, LB_ADDSTRING, 0, reinterpret_cast<LPARAM>(display.c_str()));
  }
  set_status(L"已读取已发布课程目录（只读）");
}

void show_selected_content() {
  if (g_draft_dirty && !persist_draft()) return;
  const int index = static_cast<int>(SendMessageW(g_content_list, LB_GETCURSEL, 0, 0));
  if (index < 0) return;
  const auto root = configured_content_root(); if (root.empty()) return;
  codeweave::content::ContentRepository repository(root); std::vector<codeweave::content::Unit> units;
  if (!repository.list_published(units).ok || static_cast<size_t>(index) >= units.size()) return;
  codeweave::content::LoadedUnit loaded; const auto result = repository.read_published(units[static_cast<size_t>(index)].content_id, loaded);
  if (!result.ok) { set_status(wide_from_utf8(result.message)); return; }
  g_selected_content = loaded.metadata.content_id;
  g_hint_viewed = false;
  std::string language;
  const auto starter = repository.read_starter(g_selected_content, language, g_starter, g_execution_policy);
  if (!starter.ok) { g_starter.clear(); g_execution_policy = "external"; }
  SendMessageW(g_independent_check, BM_SETCHECK, BST_UNCHECKED, 0);
  g_content_language = starter.ok ? language : loaded.metadata.language;
  SetWindowTextW(g_language_edit, wide_from_utf8(g_content_language).c_str());
  load_personal_draft();
  set_multiline(g_content_body, loaded.body);
  std::vector<codeweave::content::Exercise> exercises;
  const auto exercises_result = repository.list_exercises(loaded.metadata.content_id, exercises);
  if (!exercises_result.ok) {
    set_status(wide_from_utf8(exercises_result.message));
  } else if (!exercises.empty()) {
    SetWindowTextW(g_exercise_id, wide_from_utf8(exercises.front().exercise_id).c_str());
    set_status(L"已打开课程正文，并载入首个练习元数据（只读）");
  } else {
    SetWindowTextW(g_exercise_id, L"");
    set_status(L"已打开课程正文；该课程没有练习元数据");
  }
}

void refresh_progress_status() {
  if (!g_progress_status) return;
  if (!g_progress_store) { SetWindowTextW(g_progress_status, L"登录后显示个人进度"); return; }
  std::vector<codeweave::learning::ProgressFact> facts;
  const auto result = g_progress_store->read_all(facts);
  if (!result.ok) {
    SetWindowTextW(g_progress_status, wide_from_utf8(result.message).c_str());
    return;
  }
  const auto text = L"正式进度事实：" + std::to_wstring(facts.size()) +
      L" 条（仅独立完成挑战计入）";
  SetWindowTextW(g_progress_status, text.c_str());
}

void refresh_review_summary() {
  if (!g_review_status) return;
  if (!g_evidence_store || !g_progress_store) { SetWindowTextW(g_review_status, L"登录后显示个人复习记录"); return; }
  codeweave::learning::ReviewService service(*g_evidence_store, *g_progress_store);
  codeweave::learning::ReviewSummary summary;
  const auto result = service.summarize(summary);
  if (!result.ok) {
    SetWindowTextW(g_review_status, wide_from_utf8(result.message).c_str());
    return;
  }
  const auto text = L"复习：证据 " + std::to_wstring(summary.evidence_count) +
      L" 条，通过 " + std::to_wstring(summary.passed_count) + L" 次，独立通过 " +
      std::to_wstring(summary.independent_passed_count) + L" 次（只读汇总）";
  SetWindowTextW(g_review_status, text.c_str());
}

void save_draft() {
  if (!g_personal_core.is_open()) { set_status(L"请先登录以保存个人草稿"); return; }
  if (g_draft_read_failed) { set_status(L"原草稿读取失败，已阻止覆盖。请从数据菜单备份并检查文件。"); return; }
  g_draft_dirty = true;
  if (persist_draft()) set_status(L"个人课程草稿已保存");
}

codeweave::execution::Request execution_request() {
  const auto timeout_text = control_text(g_timeout_edit);
  std::uint32_t timeout = 0;
  const auto parsed = std::from_chars(timeout_text.data(), timeout_text.data() + timeout_text.size(), timeout);
  if (parsed.ec != std::errc{} || parsed.ptr != timeout_text.data() + timeout_text.size()) timeout = 0;
  return {control_text(g_session_edit), control_text(g_language_edit), control_text(g_draft_edit), timeout, 64 * 1024};
}

void validate_execution_request() {
  const auto request = execution_request();
  if (!is_native_ui_runnable(request.language)) {
    set_status(L"该语言尚未纳入原生执行支持清单");
    return;
  }
  const auto result = codeweave::execution::validate_request(request);
  set_status(result.ok ? L"执行请求契约有效（尚未启动代码）" : wide_from_utf8(result.message));
}

void run_execution_request() {
  if (g_execution_policy == "external") { set_status(L"本课程需按正文说明在对应工具中完成；应用保留课程与草稿"); return; }
  if (g_execution_running.exchange(true)) {
    set_status(L"已有执行任务正在运行");
    return;
  }
  g_execution_cancelled.store(false);
  const auto generation = g_execution_generation.fetch_add(1) + 1;
  auto request = execution_request();
  unsigned char nonce[16]{};
  if (BCryptGenRandom(nullptr, nonce, sizeof(nonce), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
    g_execution_running.store(false);
    set_status(L"无法生成执行编号，未启动任务");
    return;
  }
  constexpr char digits[] = "0123456789abcdef";
  request.session_id = "run-";
  for (const auto byte : nonce) { request.session_id += digits[byte >> 4]; request.session_id += digits[byte & 15]; }
  SetWindowTextW(g_session_edit, wide_from_utf8(request.session_id).c_str());
  if (!is_native_ui_runnable(request.language)) {
    g_execution_running.store(false);
    set_status(L"该语言尚未纳入原生执行支持清单");
    return;
  }
  const auto content_root = configured_content_root();
  const auto trace_store = g_trace_store;
  const auto challenge_service = g_challenge_service;
  const auto evidence_store = g_evidence_store;
  const auto progress_store = g_progress_store;
  if (!trace_store || !challenge_service || !g_account_service || !g_account_service->authenticated()) {
    g_execution_running.store(false);
    set_status(L"请先登录原生账户后再执行并保存学习记录");
    return;
  }
  const auto exercise_id = control_text(g_exercise_id);
  std::string expected_output;
  std::string hint_level = "L1";
  std::string content_id;
  if (!content_root.empty() && !exercise_id.empty()) {
    codeweave::content::ContentRepository repository(content_root);
    std::vector<codeweave::content::Unit> units;
    std::vector<codeweave::content::Exercise> exercises;
    if (repository.list_published(units).ok) {
      for (const auto& unit : units) {
        if (unit.content_id != g_selected_content || request.language != g_content_language) continue;
        if (!repository.list_exercises(unit.content_id, exercises).ok) continue;
        const auto found = std::find_if(exercises.begin(), exercises.end(),
            [&exercise_id](const auto& exercise) { return exercise.exercise_id == exercise_id; });
        if (found != exercises.end()) {
          content_id = found->content_id;
          expected_output = found->expected_output;
          hint_level = g_hint_viewed ? "L3" : found->hint_level;
          break;
        }
      }
    }
  }
  const auto tool = configured_tool(request.language);
  if (tool.empty()) {
    g_execution_running.store(false);
    set_status(wide_from_utf8("未检测到该语言工具，请点击“选择语言工具”指定已安装的编译器或解释器"));
    return;
  }
  std::error_code tool_error;
  if (!tool.is_absolute() || !std::filesystem::is_regular_file(tool, tool_error)) {
    g_execution_running.store(false);
    set_status(L"配置的语言工具不存在或不是绝对路径，已拒绝启动");
    return;
  }
  if (is_test_runner_path(tool)) {
    g_execution_running.store(false);
    set_status(L"测试执行器不能用于正式应用运行，已拒绝启动");
    return;
  }
  if (g_execution_thread.joinable()) g_execution_thread.join();
  std::filesystem::path account_root;
  if (!g_account_service->learning_data_root(g_core.data_root(), account_root).ok) { g_execution_running.store(false); return; }
  const auto working_directory = account_root / L"execution";
  std::error_code directory_error;
  std::filesystem::create_directories(working_directory, directory_error);
  if (directory_error) {
    g_execution_running.store(false);
    set_status(L"无法创建受控执行工作目录，已拒绝启动");
    return;
  }
  const auto window = g_status ? GetParent(g_status) : nullptr;
  const bool independent = !g_hint_viewed && g_independent_check &&
      SendMessageW(g_independent_check, BM_GETCHECK, 0, 0) == BST_CHECKED;
  g_execution_thread = std::thread([request, tool, working_directory, window, generation,
      expected_output, hint_level, content_id, exercise_id, independent,
      trace_store, challenge_service, evidence_store, progress_store] {
    auto result = std::make_unique<codeweave::execution::ServiceResult>(
        g_execution.run(request, tool, working_directory, &g_execution_cancelled, &g_execution_control));
    std::string challenge_message;
    if (result->trace.has_value() && trace_store) {
      const auto trace_saved = trace_store->append(*result->trace);
      if (!trace_saved.ok) challenge_message = trace_saved.message;
    }
    if (result->process.has_value() && result->process->started &&
        result->process->execution_output_valid && challenge_service &&
        !content_id.empty() && !exercise_id.empty()) {
      const auto stamp = current_date();
      const auto operation = operation_id_for(request.session_id, generation);
      codeweave::learning::ChallengeRequest challenge{
          evidence_id_for(request.session_id, generation), content_id, exercise_id, stamp,
          expected_output, operation, independent, hint_level};
      const auto challenge_result = challenge_service->record_course_execution(challenge, *result->process);
      challenge_message = challenge_result.validation.message;
    } else if (result->process.has_value() && result->process->started &&
        !result->process->execution_output_valid) {
      challenge_message = "编译或执行未产生有效结果，未记录学习事实";
    } else if (!exercise_id.empty()) {
      challenge_message = "未找到对应的已发布练习元数据，未写入学习事实";
    }
    if (window && !g_window_closing.load()) {
      {
        std::lock_guard lock(g_result_mutex);
        g_result_queue.push_back(PendingResult{generation, std::move(result), std::move(challenge_message)});
      }
      if (!PostMessageW(window, kExecutionResultMessage, 0, 0)) {
        std::lock_guard lock(g_result_mutex);
        g_result_queue.clear();
      }
    }
    g_execution_running.store(false);
  });
  set_status(L"执行任务已提交，窗口保持可操作");
}

void cancel_execution_request() {
  if (!g_execution_running.load()) {
    set_status(L"当前没有正在运行的执行任务");
    return;
  }
  g_execution_cancelled.store(true);
  set_status(L"正在取消执行任务");
}

void control_execution_request(codeweave::execution::ControlCommand command) {
  if (!g_execution_running.load()) {
    set_status(L"当前没有正在运行的执行任务");
    return;
  }
  const auto result = g_execution_control.request(command);
  set_status(wide_from_utf8(result.message));
}

void show_execution_result() {
  std::unique_ptr<codeweave::execution::ServiceResult> owned;
  std::string challenge_message;
  {
    std::lock_guard lock(g_result_mutex);
    if (g_result_queue.empty()) return;
    if (g_result_queue.front().generation != g_execution_generation.load()) {
      g_result_queue.pop_front();
      return;
    }
    owned = std::move(g_result_queue.front().result);
    challenge_message = std::move(g_result_queue.front().challenge_message);
    g_result_queue.pop_front();
  }
  if (!owned->validation.ok) {
    set_status(wide_from_utf8(owned->validation.message));
    return;
  }
  if (!owned->process.has_value()) {
    set_status(L"执行未产生进程结果");
    return;
  }
  const auto& process = *owned->process;
  std::wstring status = process.error_code.empty() ? L"执行完成" : wide_from_utf8(process.error_code);
  status += L"，输出字节：" + std::to_wstring(process.output.size());
  if (!challenge_message.empty()) {
    status += L"；" + wide_from_utf8(challenge_message);
  }
  set_status(status);
  set_multiline(g_output, process.output);
  if (g_trace_status && g_trace_store) {
    codeweave::execution::TracePage page;
    const auto loaded = g_trace_store->read_page(owned->trace && !owned->trace->events().empty()
            ? owned->trace->events().front().session_id : execution_request().session_id,
        0, 128, page);
    if (loaded.ok) {
      const auto summary = codeweave::execution::summarize_trace(page.events);
      std::wstring trace_text = L"轨迹：" + std::to_wstring(summary.event_count) + L" 个事件，输出 " +
          std::to_wstring(summary.output_bytes) + L" 字节";
      if (!page.end) trace_text += L"（可继续读取）";
      SetWindowTextW(g_trace_status, trace_text.c_str());
    } else {
      SetWindowTextW(g_trace_status, wide_from_utf8(loaded.message).c_str());
    }
  }
  refresh_progress_status();
  refresh_review_summary();
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_CREATE: {
      const auto workspace = locate_workspace();
      if (workspace.empty()) { MessageBoxW(window, L"找不到有效的 CodeWeave 工作区。", L"CodeWeave", MB_ICONERROR | MB_OK); return -1; }
      const auto data_root = configured_data_root();
      const auto opened = data_root.empty()
          ? g_core.open_workspace(workspace)
          : g_core.open_workspace(workspace, data_root);
      if (!opened.ok) { MessageBoxW(window, wide_from_utf8(opened.message).c_str(), L"CodeWeave", MB_ICONERROR | MB_OK); return -1; }
      g_account_store = std::make_unique<codeweave::account::AccountStore>(g_core.data_root());
      g_account_service = std::make_unique<codeweave::account::AccountService>(*g_account_store);

      CreateWindowW(L"STATIC", L"CodeWeave 原生应用", WS_CHILD | WS_VISIBLE, 24, 10, 500, 24, window, nullptr, nullptr, nullptr);
      CreateWindowW(L"STATIC", L"原生账户", WS_CHILD | WS_VISIBLE, 24, 30, 260, 20, window, nullptr, nullptr, nullptr);
      g_account_name = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER, 24, 52, 120, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountNameId)), nullptr, nullptr);
      g_account_identifier = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER, 152, 52, 180, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountIdentifierId)), nullptr, nullptr);
      g_account_password = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_PASSWORD, 340, 52, 150, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountPasswordId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"注册", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 498, 50, 70, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountRegisterId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"登录", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 574, 50, 70, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountLoginId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"退出", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 650, 50, 70, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountLogoutId)), nullptr, nullptr);
      g_account_new_password = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_PASSWORD, 726, 52, 150, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountNewPasswordId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"修改密码", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 884, 50, 110, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountChangePasswordId)), nullptr, nullptr);
      g_account_status = CreateWindowW(L"STATIC", L"未登录", WS_CHILD | WS_VISIBLE, 24, 82, 970, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kAccountStatusId)), nullptr, nullptr);
      g_exercise_id = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_READONLY, 24, 650, 180, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kExerciseId)), nullptr, nullptr);
      g_progress_status = CreateWindowW(L"STATIC", L"正式进度事实：0 条（仅独立完成挑战计入）", WS_CHILD | WS_VISIBLE, 220, 650, 400, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kProgressStatusId)), nullptr, nullptr);
      g_trace_status = CreateWindowW(L"STATIC", L"轨迹：尚无执行结果", WS_CHILD | WS_VISIBLE, 220, 688, 600, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kTraceStatusId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"刷新复习汇总", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
          24, 510, 140, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kReviewButtonId)), nullptr, nullptr);
      g_review_status = CreateWindowW(L"STATIC", L"复习：尚无数据", WS_CHILD | WS_VISIBLE,
          180, 514, 800, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kReviewStatusId)), nullptr, nullptr);
      g_independent_check = CreateWindowW(L"BUTTON", L"独立完成", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 630, 650, 150, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kIndependentCheckId)), nullptr, nullptr);
      g_content_list = CreateWindowExW(WS_EX_CLIENTEDGE, L"LISTBOX", L"", WS_CHILD | WS_VISIBLE | LBS_NOTIFY | WS_VSCROLL, 868, 104, 300, 180, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kContentListId)), nullptr, nullptr);
      g_content_body = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_MULTILINE | ES_AUTOVSCROLL | WS_VSCROLL | ES_READONLY, 868, 292, 300, 242, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kContentBodyId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"读取课程目录", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 868, 544, 140, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kListContentButtonId)), nullptr, nullptr);
      g_session_edit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"session-native-01", WS_CHILD | WS_VISIBLE | WS_BORDER, 100, 544, 180, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kSessionEditId)), nullptr, nullptr);
      g_language_edit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"cpp", WS_CHILD | WS_VISIBLE | WS_BORDER, 340, 544, 100, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kLanguageEditId)), nullptr, nullptr);
      g_timeout_edit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"10000", WS_CHILD | WS_VISIBLE | WS_BORDER, 524, 544, 80, 24, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kTimeoutEditId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"检查代码参数", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 616, 544, 140, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kValidateExecutionButtonId)), nullptr, nullptr);
      g_run_button = CreateWindowW(L"BUTTON", L"运行代码", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 764, 544, 140, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kRunExecutionButtonId)), nullptr, nullptr);
      g_cancel_button = CreateWindowW(L"BUTTON", L"取消执行", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 912, 544, 100, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kCancelExecutionButtonId)), nullptr, nullptr);
      g_pause_button = CreateWindowW(L"BUTTON", L"暂停", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 1020, 544, 80, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kPauseExecutionButtonId)), nullptr, nullptr);
      g_resume_button = CreateWindowW(L"BUTTON", L"继续", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 1104, 544, 80, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kResumeExecutionButtonId)), nullptr, nullptr);
      g_step_button = CreateWindowW(L"BUTTON", L"步进", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 1020, 578, 80, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kStepExecutionButtonId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"查看提示", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 980, 110, 80, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kHintId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"自由编程", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 1066, 110, 80, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kScratchId)), nullptr, nullptr);
      CreateWindowW(L"BUTTON", L"选择语言工具", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 24, 110, 140, 28, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kToolButtonId)), nullptr, nullptr);
      g_output = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"运行输出将在这里显示", WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_READONLY | WS_VSCROLL | ES_AUTOVSCROLL, 24, 450, 700, 90, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kOutputId)), nullptr, nullptr);
      g_draft_edit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_MULTILINE | ES_AUTOVSCROLL | WS_VSCROLL, 24, 140, 820, 394, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kDraftEditId)), nullptr, nullptr);
      set_edit_cue(g_account_name, L"姓名");
      set_edit_cue(g_account_identifier, L"邮箱或手机号");
      set_edit_cue(g_account_password, L"密码");
      set_edit_cue(g_account_new_password, L"新密码");
      set_edit_cue(g_session_edit, L"执行会话 ID");
      set_edit_cue(g_language_edit, L"cpp");
      set_edit_cue(g_timeout_edit, L"超时毫秒");
      set_edit_cue(g_exercise_id, L"练习 ID（可选）");
      set_edit_limit(g_account_name, kMaximumAccountCharacters);
      set_edit_limit(g_account_identifier, kMaximumAccountCharacters);
      set_edit_limit(g_account_password, kMaximumAccountCharacters);
      set_edit_limit(g_account_new_password, kMaximumAccountCharacters);
      set_edit_limit(g_session_edit, 96);
      set_edit_limit(g_language_edit, 32);
      set_edit_limit(g_timeout_edit, 10);
      set_edit_limit(g_exercise_id, 128);
      set_edit_limit(g_draft_edit, kMaximumDraftCharacters);
      set_edit_limit(g_content_body, 8 * 1024 * 1024);
      set_edit_limit(g_output, 128 * 1024);
      CreateWindowW(L"BUTTON", L"保存草稿", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 24, 588, 120, 32, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kSaveButtonId)), nullptr, nullptr);
      g_status = CreateWindowW(L"STATIC", L"已打开本地工作区", WS_CHILD | WS_VISIBLE, 164, 594, 680, 24, window, nullptr, nullptr, nullptr);

      refresh_progress_status();
      refresh_review_summary();
      list_content();
      RECT client{}; GetClientRect(window, &client);
      layout_controls(window, client.right - client.left, client.bottom - client.top);
      if (g_gui_smoke || g_gui_interaction_smoke) SetTimer(window, 1, 100, nullptr);
      return 0;
    }
    case WM_COMMAND:
      if (LOWORD(wparam) == kExternalEvidenceId) { show_external_evidence(window); return 0; }
      if (LOWORD(wparam) >= kBackupId && LOWORD(wparam) <= kOpenDataId) { manage_data(window, LOWORD(wparam)); return 0; }
      if (LOWORD(wparam) == kHintId && HIWORD(wparam) == BN_CLICKED) {
        codeweave::content::ContentRepository repository(configured_content_root());
        std::string hints;
        const auto result = repository.read_hints(g_selected_content, hints);
        if (result.ok) {
          if (!g_personal_core.is_open()) { set_status(L"请先登录后查看提示"); return 0; }
          const auto marked = g_personal_core.save_draft(draft_id() + "-hint", "assisted");
          if (!marked.ok) { set_status(wide_from_utf8(marked.message)); return 0; }
          g_hint_viewed = true; MessageBoxW(window, wide_from_utf8(hints).c_str(), L"提示（当前课程草稿按辅助练习记录）", MB_OK); }
        else set_status(wide_from_utf8(result.message));
      }
      if (LOWORD(wparam) == kScratchId && HIWORD(wparam) == BN_CLICKED) {
        if (g_draft_dirty && !persist_draft()) return 0;
        g_selected_content.clear(); g_starter.clear(); g_execution_policy = "native"; g_hint_viewed = false;
        SetWindowTextW(g_exercise_id, L"");
        SetWindowTextW(g_content_body, L"自由编程：选择语言并编辑代码。运行结果保存在个人轨迹中，不自动计为课程完成。");
        load_personal_draft();
      }
      if (LOWORD(wparam) == kDraftEditId && HIWORD(wparam) == EN_CHANGE && !g_loading_draft) g_draft_dirty = true;
      if (LOWORD(wparam) == kToolButtonId && HIWORD(wparam) == BN_CLICKED) choose_tool();
      if (LOWORD(wparam) == kSaveButtonId && HIWORD(wparam) == BN_CLICKED) save_draft();
      if (LOWORD(wparam) == kValidateExecutionButtonId && HIWORD(wparam) == BN_CLICKED) validate_execution_request();
      if (LOWORD(wparam) == kRunExecutionButtonId && HIWORD(wparam) == BN_CLICKED) run_execution_request();
      if (LOWORD(wparam) == kCancelExecutionButtonId && HIWORD(wparam) == BN_CLICKED) cancel_execution_request();
      if (LOWORD(wparam) == kPauseExecutionButtonId && HIWORD(wparam) == BN_CLICKED) control_execution_request(codeweave::execution::ControlCommand::Pause);
      if (LOWORD(wparam) == kResumeExecutionButtonId && HIWORD(wparam) == BN_CLICKED) control_execution_request(codeweave::execution::ControlCommand::Resume);
      if (LOWORD(wparam) == kStepExecutionButtonId && HIWORD(wparam) == BN_CLICKED) control_execution_request(codeweave::execution::ControlCommand::Step);
      if (LOWORD(wparam) == kReviewButtonId && HIWORD(wparam) == BN_CLICKED) refresh_review_summary();
      if (LOWORD(wparam) == kListContentButtonId && HIWORD(wparam) == BN_CLICKED) list_content();
      if (LOWORD(wparam) == kContentListId && HIWORD(wparam) == LBN_SELCHANGE) show_selected_content();
      if (LOWORD(wparam) == kAccountRegisterId && HIWORD(wparam) == BN_CLICKED) account_register();
      if (LOWORD(wparam) == kAccountLoginId && HIWORD(wparam) == BN_CLICKED) account_login();
      if (LOWORD(wparam) == kAccountLogoutId && HIWORD(wparam) == BN_CLICKED) account_logout();
      if (LOWORD(wparam) == kAccountChangePasswordId && HIWORD(wparam) == BN_CLICKED) account_change_password();
      return 0;
    case kExecutionResultMessage:
      show_execution_result();
      return 0;
    case WM_TIMER:
      if ((g_gui_smoke || g_gui_interaction_smoke) && wparam == 1) {
        KillTimer(window, 1);
        if (g_gui_interaction_smoke) {
          const auto initial = L"中文草稿\nreturn 42;\n";
          SetWindowTextW(g_draft_edit, initial);
          SetFocus(g_draft_edit);
          const bool focus_ok = GetFocus() == g_draft_edit;
          const auto initial_length = GetWindowTextLengthW(g_draft_edit);
          SendMessageW(g_draft_edit, EM_SETSEL, initial_length, initial_length);
          const auto replacement = L"追加";
          SendMessageW(g_draft_edit, EM_REPLACESEL, TRUE,
              reinterpret_cast<LPARAM>(replacement));
          const bool appended = control_text(g_draft_edit) ==
              "中文草稿\nreturn 42;\n追加";
          const bool undo_requested = SendMessageW(g_draft_edit, EM_UNDO, 0, 0) != 0;
          const bool undo_ok = undo_requested && control_text(g_draft_edit) ==
              "中文草稿\nreturn 42;\n";
          const auto before_limit = GetWindowTextLengthW(g_draft_edit);
          set_edit_limit(g_draft_edit, 8);
          SetWindowTextW(g_draft_edit, L"");
          SendMessageW(g_draft_edit, EM_SETSEL, 0, 0);
          SendMessageW(g_draft_edit, EM_REPLACESEL, TRUE,
              reinterpret_cast<LPARAM>(L"123456789012345"));
          const bool length_limited = GetWindowTextLengthW(g_draft_edit) <= 8;
          set_edit_limit(g_draft_edit, kMaximumDraftCharacters);
          SetWindowTextW(g_draft_edit, initial);
          SetWindowPos(window, nullptr, 0, 0, 960, 620,
              SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
          RECT resized{};
          GetClientRect(window, &resized);
          const bool relayout_ok = resized.right > 0 && resized.bottom > 0 &&
              before_limit > 0;
          g_gui_smoke_ok = focus_ok && appended && undo_ok && length_limited &&
              relayout_ok && IsWindow(g_draft_edit) && IsWindow(g_run_button) &&
              g_core.is_open();
          DestroyWindow(window);
          return 0;
        }
        const bool account_fields_start_empty =
            GetWindowTextLengthW(g_account_name) == 0 &&
            GetWindowTextLengthW(g_account_identifier) == 0;
        SetWindowTextW(g_draft_edit, L"GUI smoke 中文草稿\nreturn 42;\n");
        SetWindowTextW(g_account_name, L"GUI Smoke");
        SetWindowTextW(g_account_identifier, L"gui-smoke@example.test");
        SetWindowTextW(g_account_password, L"Smoke-Password-123!");
        SendMessageW(window, WM_COMMAND, MAKEWPARAM(kAccountRegisterId, BN_CLICKED), 0);
        SetWindowTextW(g_draft_edit, L"GUI smoke 中文草稿\nreturn 42;\n");
        SendMessageW(window, WM_COMMAND, MAKEWPARAM(kSaveButtonId, BN_CLICKED), 0);
        std::string restored;
        const auto draft_saved = g_personal_core.load_draft(draft_id(), restored).ok &&
            restored == "GUI smoke 中文草稿\nreturn 42;\n";
        std::vector<codeweave::account::Record> accounts;
        const auto account_saved = g_account_store &&
            g_account_store->list_accounts(accounts).ok && accounts.size() == 1 &&
            g_account_service && g_account_service->authenticated();
        g_gui_smoke_ok = IsWindow(g_draft_edit) && IsWindow(g_content_list) &&
            IsWindow(g_content_body) && IsWindow(g_run_button) && g_core.is_open() &&
            account_fields_start_empty && draft_saved && account_saved;
        DestroyWindow(window);
      }
      return 0;
    case WM_SIZE:
      layout_controls(window, LOWORD(lparam), HIWORD(lparam));
      return 0;
    case WM_GETMINMAXINFO: {
      auto* limits = reinterpret_cast<MINMAXINFO*>(lparam);
      limits->ptMinTrackSize.x = kMinimumClientWidth;
      limits->ptMinTrackSize.y = kMinimumClientHeight;
      return 0;
    }
    case WM_DPICHANGED: {
      const auto* suggested = reinterpret_cast<const RECT*>(lparam);
      SetWindowPos(window, nullptr, suggested->left, suggested->top,
          suggested->right - suggested->left, suggested->bottom - suggested->top,
          SWP_NOZORDER | SWP_NOACTIVATE);
      return 0;
    }
    case WM_CLOSE:
      if (g_draft_dirty && !persist_draft()) {
        if (MessageBoxW(window, L"草稿尚未保存。是否放弃本次编辑并关闭？", L"CodeWeave", MB_YESNO | MB_ICONQUESTION) != IDYES) return 0;
      }
      DestroyWindow(window);
      return 0;
    case WM_DESTROY:
      g_window_closing.store(true);
      g_execution_cancelled.store(true);
      if (g_execution_thread.joinable()) g_execution_thread.join();
      {
        std::lock_guard lock(g_result_mutex);
        g_result_queue.clear();
      }
      g_personal_core.close_workspace();
      g_core.close_workspace();
      g_account_service.reset();
      g_account_store.reset();
      g_challenge_service.reset();
      g_trace_store.reset();
      g_progress_store.reset();
      g_evidence_store.reset();
      PostQuitMessage(0);
      return 0;
    default: return DefWindowProcW(window, message, wparam, lparam);
  }
}

int run_window(HINSTANCE instance, bool smoke = false, bool interaction_smoke = false) {
  wchar_t executable_path[32768]{};
  const auto executable_length = GetModuleFileNameW(nullptr, executable_path, static_cast<DWORD>(std::size(executable_path)));
  if (!executable_length || executable_length >= std::size(executable_path)) return 1;
  g_executable_directory = std::filesystem::path(executable_path).parent_path();
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  // Prefer per-monitor DPI awareness without requiring a newer SDK at link time.
  if (auto* user32 = GetModuleHandleW(L"user32.dll")) {
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wcast-function-type"
#endif
    using SetProcessDpiAwarenessContextFn = BOOL (WINAPI*)(HANDLE);
    const auto set_context = reinterpret_cast<SetProcessDpiAwarenessContextFn>(
        GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
    if (!set_context || !set_context(reinterpret_cast<HANDLE>(-4))) SetProcessDPIAware();
  }
  g_single_instance = CreateMutexW(nullptr, FALSE, L"Local\\CodeWeave.Native.SingleInstance.v1");
  if (!g_single_instance) return 1;
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    if (const auto existing = FindWindowW(kClassName, nullptr)) { ShowWindow(existing, SW_RESTORE); SetForegroundWindow(existing); }
    CloseHandle(g_single_instance);
    g_single_instance = nullptr;
    return 0;
  }
  g_gui_smoke = smoke;
  g_gui_interaction_smoke = interaction_smoke;
  g_gui_smoke_ok = false;
  WNDCLASSW klass{}; klass.hInstance = instance; klass.lpfnWndProc = window_proc; klass.lpszClassName = kClassName; klass.hCursor = LoadCursorW(nullptr, IDC_ARROW); klass.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  if (!RegisterClassW(&klass)) {
    CloseHandle(g_single_instance);
    g_single_instance = nullptr;
    return 1;
  }
  HWND window = CreateWindowExW(0, kClassName, L"CodeWeave", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1240, 760, nullptr, nullptr, instance, nullptr);
  if (!window) {
    CloseHandle(g_single_instance);
    g_single_instance = nullptr;
    return 1;
  }
  const auto menu = CreateMenu();
  const auto data_menu = CreatePopupMenu();
  AppendMenuW(data_menu, MF_STRING, kBackupId, L"备份本地数据…");
  AppendMenuW(data_menu, MF_STRING, kRestoreId, L"从备份恢复到新目录…");
  AppendMenuW(data_menu, MF_STRING, kImportUsersId, L"导入旧版账户…");
  AppendMenuW(data_menu, MF_STRING, kImportLearningId, L"导入旧版学习导出…");
  AppendMenuW(data_menu, MF_STRING, kOpenDataId, L"打开数据目录");
  AppendMenuW(data_menu, MF_STRING, kExternalEvidenceId, L"记录外部实践证据…");
  AppendMenuW(menu, MF_POPUP, reinterpret_cast<UINT_PTR>(data_menu), L"数据");
  SetMenu(window, menu);
  NONCLIENTMETRICSW metrics{}; metrics.cbSize = sizeof(metrics);
  if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics, 0)) {
    g_ui_font = CreateFontIndirectW(&metrics.lfMessageFont);
    EnumChildWindows(window, [](HWND child, LPARAM value) -> BOOL { SendMessageW(child, WM_SETFONT, static_cast<WPARAM>(value), TRUE); return TRUE; }, reinterpret_cast<LPARAM>(g_ui_font));
  }
  ShowWindow(window, smoke ? SW_SHOWNOACTIVATE : SW_SHOWDEFAULT); UpdateWindow(window);
  MSG message{}; while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
  const auto exit_code = smoke ? (g_gui_smoke_ok ? 0 : 1) : static_cast<int>(message.wParam);
  CloseHandle(g_single_instance);
  g_single_instance = nullptr;
  if (g_ui_font) { DeleteObject(g_ui_font); g_ui_font = nullptr; }
  CoUninitialize();
  return exit_code;
}
#endif

bool run_self_test() {
  const auto root = std::filesystem::temp_directory_path() / ("codeweave-native-startup-test-" + std::to_string(std::random_device{}()));
  std::error_code error; std::filesystem::create_directories(root / "config", error); if (error) return false;
  std::ofstream(root / "config" / "codeweave.config.example.json") << "{}\n";
  codeweave::app::ApplicationCore core; if (!core.open_workspace(root).ok || !core.save_draft("startup", "native\n").ok) return false;
  std::string content;
  const bool passed = core.load_draft("startup", content).ok && content == "native\n";
  if (!core.close_workspace().ok) return false;
  std::filesystem::remove_all(root, error);
  return passed && !error;
}

bool run_gui_smoke(bool interaction_smoke);

bool run_gui_smoke() {
  return run_gui_smoke(false);
}

bool run_gui_smoke(bool interaction_smoke) {
#ifdef _WIN32
  const auto root = std::filesystem::temp_directory_path() / ("codeweave-native-gui-smoke-" + std::to_string(std::random_device{}()));
  std::error_code error;
  std::filesystem::create_directories(root / "config", error);
  if (error) return false;
  std::ofstream(root / "config" / "codeweave.config.example.json") << "{}\n";
  SetEnvironmentVariableW(L"CODEWEAVE_NATIVE_WORKSPACE", root.wstring().c_str());
  const auto data_root = root / L"isolated-data";
  SetEnvironmentVariableW(L"CODEWEAVE_NATIVE_DATA_ROOT", data_root.wstring().c_str());
  const auto result = run_window(GetModuleHandleW(nullptr), true, interaction_smoke);
  SetEnvironmentVariableW(L"CODEWEAVE_NATIVE_WORKSPACE", nullptr);
  SetEnvironmentVariableW(L"CODEWEAVE_NATIVE_DATA_ROOT", nullptr);
  std::filesystem::remove_all(root, error);
  return result == 0 && !error;
#else
  return false;
#endif
}
}  // namespace

int main(int argc, char** argv);

int main(int argc, char** argv) {
  if (argc > 1) {
    if (argc == 2 && std::string_view(argv[1]) == "--self-test") return run_self_test() ? 0 : 1;
    if (argc == 2 && std::string_view(argv[1]) == "--gui-smoke") return run_gui_smoke() ? 0 : 1;
    if (argc == 2 && std::string_view(argv[1]) == "--gui-interaction-smoke") {
      return run_gui_smoke(true) ? 0 : 1;
    }
    return 2;
  }
#ifdef _WIN32
  return run_window(GetModuleHandleW(nullptr));
#else
  return run_self_test() ? 0 : 1;
#endif
}

#if defined(_WIN32) && defined(_MSC_VER)
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  int argc = 0;
  LPWSTR* wide_argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!wide_argv) return 1;
  int result = 0;
  if (argc > 1) {
    const std::wstring_view argument(wide_argv[1]);
    if (argc == 2 && argument == L"--self-test") result = run_self_test() ? 0 : 1;
    else if (argc == 2 && argument == L"--gui-smoke") result = run_gui_smoke() ? 0 : 1;
    else if (argc == 2 && argument == L"--gui-interaction-smoke") {
      result = run_gui_smoke(true) ? 0 : 1;
    } else {
      result = 2;
    }
  } else {
    result = run_window(GetModuleHandleW(nullptr));
  }
  LocalFree(wide_argv);
  return result;
}
#endif
