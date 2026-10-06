#include <windows.h>
#include <wincrypt.h>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace {
std::wstring quote(const std::wstring& value) {
  std::wstring literal = L"'";
  for (const auto character : value) {
    literal += character;
    if (character == L'\'') literal += L'\'';
  }
  return literal + L"'";
}

bool read_payload(std::vector<unsigned char>& payload) {
  wchar_t module[MAX_PATH]{};
  const auto length = GetModuleFileNameW(nullptr, module, MAX_PATH);
  if (length == 0 || length == MAX_PATH) return false;
  std::ifstream file(std::filesystem::path(module), std::ios::binary);
  if (!file) return false;
  file.seekg(0, std::ios::end);
  const auto size = static_cast<std::size_t>(file.tellg());
  file.seekg(0, std::ios::beg);
  std::vector<unsigned char> bytes(size);
  file.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  const std::string marker = "CWQTZIP1";
  for (std::size_t i = 0; i + marker.size() <= bytes.size(); ++i) {
    if (std::equal(marker.begin(), marker.end(), bytes.begin() + static_cast<std::ptrdiff_t>(i))) {
      payload.assign(bytes.begin() + static_cast<std::ptrdiff_t>(i + marker.size()), bytes.end());
      return !payload.empty();
    }
  }
  return false;
}

int run_powershell(const std::wstring& command) {
  const auto* bytes = reinterpret_cast<const BYTE*>(command.data());
  const auto byte_count = static_cast<DWORD>(command.size() * sizeof(wchar_t));
  DWORD encoded_length = 0;
  if (!CryptBinaryToStringW(bytes, byte_count, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF,
      nullptr, &encoded_length)) return -1;
  std::wstring encoded(encoded_length, L'\0');
  if (!CryptBinaryToStringW(bytes, byte_count, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF,
      encoded.data(), &encoded_length)) return -1;
  encoded.resize(encoded_length);
  std::wstring command_line = L"powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand " + encoded;
  std::vector<wchar_t> mutable_command(command_line.begin(), command_line.end());
  mutable_command.push_back(L'\0');
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, FALSE,
      CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) return -1;
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return static_cast<int>(code);
}
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  std::vector<unsigned char> payload;
  if (!read_payload(payload)) {
    return 2;
  }
  // Keep each invocation isolated. A fixed filename made concurrent/manual
  // launches race and left a misleading CodeWeaveQtPackage.zip in %TEMP%.
  const auto temp_root = std::filesystem::temp_directory_path() /
      (L"codeweave-selfextract-" + std::to_wstring(GetCurrentProcessId()) +
       L"-" + std::to_wstring(GetTickCount64()));
  std::error_code cleanup_error;
  if (!std::filesystem::create_directory(temp_root, cleanup_error)) return 3;
  const auto temp = temp_root / L"payload.zip";
  const auto error_file = temp_root / L"error.txt";
  {
    std::ofstream file(temp, std::ios::binary | std::ios::trunc);
    if (!file) {
      std::filesystem::remove_all(temp_root, cleanup_error);
      return 3;
    }
    file.write(reinterpret_cast<const char*>(payload.data()), static_cast<std::streamsize>(payload.size()));
    file.close();
    if (!file) {
      std::filesystem::remove_all(temp_root, cleanup_error);
      return 3;
    }
  }
  const std::wstring temp_text = temp.wstring();
  const std::wstring command =
      L"$ErrorActionPreference='Stop'; try { "
      L"$target=Join-Path $env:LOCALAPPDATA 'Programs\\CodeWeave'; "
      L"New-Item -ItemType Directory -Force -Path $target | Out-Null; "
      L"tar.exe -xf " + quote(temp_text) + L" -C $target; "
      L"if ($LASTEXITCODE -ne 0) { throw 'package extraction failed' }; "
      L"$sm=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\CodeWeave'; "
      L"New-Item -ItemType Directory -Force -Path $sm | Out-Null; "
      L"$w=New-Object -ComObject WScript.Shell; "
      L"$s=$w.CreateShortcut((Join-Path $sm 'CodeWeave.lnk')); "
      L"$s.TargetPath=(Join-Path $target 'CodeWeaveQtShell.exe'); "
      L"$s.WorkingDirectory=$target; $s.Save(); "
      L"} catch { $_ | Out-File -FilePath " + quote(error_file.wstring()) + L" -Encoding utf8; exit 1 }";
  const auto result = run_powershell(command);
  if (result != 0) {
    std::filesystem::remove(temp, cleanup_error);
    const auto message = L"Installation failed. Diagnostic directory:\n" + temp_root.wstring();
    MessageBoxW(nullptr, message.c_str(), L"CodeWeave Setup", MB_OK | MB_ICONERROR);
    return 4;
  }
  std::filesystem::remove_all(temp_root, cleanup_error);
  return 0;
}
