#pragma once
#include <windows.h>
#include <shobjidl.h>
#include <filesystem>

// Trusted host boundary: QML requests an action; the user chooses paths in the
// Windows shell dialog. No arbitrary path is accepted from QML.
inline std::filesystem::path choose_native_path(HWND owner, const wchar_t* title,
    bool directory, const wchar_t* pattern = L"*.*") {
  const HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  IFileOpenDialog* dialog{};
  std::filesystem::path result;
  if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
      IID_PPV_ARGS(&dialog)))) {
    DWORD options{};
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST |
        (directory ? FOS_PICKFOLDERS : FOS_FILEMUSTEXIST));
    dialog->SetTitle(title);
    COMDLG_FILTERSPEC filter{L"Supported files", pattern};
    if (!directory) dialog->SetFileTypes(1, &filter);
    if (SUCCEEDED(dialog->Show(owner))) {
      IShellItem* item{};
      if (SUCCEEDED(dialog->GetResult(&item))) {
        PWSTR path{};
        if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
          result = path;
          CoTaskMemFree(path);
        }
        item->Release();
      }
    }
    dialog->Release();
  }
  if (SUCCEEDED(initialized)) CoUninitialize();
  return result;
}
