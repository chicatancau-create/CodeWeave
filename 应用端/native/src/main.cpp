#ifdef _WIN32
#include <windows.h>
#endif

#include <iterator>
#include <string_view>

namespace {
constexpr wchar_t kClassName[] = L"CodeWeaveNativeWindow";

#ifdef _WIN32
LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_PAINT: {
      PAINTSTRUCT paint{};
      const HDC dc = BeginPaint(window, &paint);
      const wchar_t text[] = L"CodeWeave Native Windows App";
      TextOutW(dc, 24, 24, text, static_cast<int>(std::size(text) - 1));
      EndPaint(window, &paint);
      return 0;
    }
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(window, message, wparam, lparam);
  }
}

int run_window(HINSTANCE instance) {
  WNDCLASSW klass{};
  klass.hInstance = instance;
  klass.lpfnWndProc = window_proc;
  klass.lpszClassName = kClassName;
  klass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  if (!RegisterClassW(&klass)) return 1;

  HWND window = CreateWindowExW(0, kClassName, L"CodeWeave", WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT, CW_USEDEFAULT, 960, 640, nullptr, nullptr, instance, nullptr);
  if (!window) return 1;
  ShowWindow(window, SW_SHOWDEFAULT);
  UpdateWindow(window);

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return static_cast<int>(message.wParam);
}
#endif
}  // namespace

int main(int argc, char**) {
  if (argc > 1) return 0;
#ifdef _WIN32
  return run_window(GetModuleHandleW(nullptr));
#else
  return 0;
#endif
}
