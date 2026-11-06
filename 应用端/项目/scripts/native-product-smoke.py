"""Drive the real native UI against disposable accounts and data (Windows only).

Requires the existing Python environment's psutil and Pillow. Does not use a
debugging port, Electron, a test-only application switch, or real user data.
"""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time

import psutil
from PIL import ImageGrab

user32 = ctypes.WinDLL('user32', use_last_error=True)
user32.SetProcessDPIAware()
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetDlgItem.restype = wintypes.HWND
user32.SendMessageTimeoutW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                                     wintypes.LPARAM, wintypes.UINT, wintypes.UINT,
                                     ctypes.POINTER(ctypes.c_size_t)]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.GetMenu.argtypes = [wintypes.HWND]
user32.GetMenu.restype = wintypes.HMENU
user32.GetSubMenu.argtypes = [wintypes.HMENU, ctypes.c_int]
user32.GetSubMenu.restype = wintypes.HMENU
user32.GetMenuState.argtypes = [wintypes.HMENU, wintypes.UINT, wintypes.UINT]
user32.GetMenuState.restype = wintypes.UINT
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                              ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.GetSystemMetrics.argtypes = [ctypes.c_int]


def message(hwnd, msg, wparam=0, lparam=0):
    result = ctypes.c_size_t()
    if not user32.SendMessageTimeoutW(hwnd, msg, wparam, lparam, 0x0002, 10000, ctypes.byref(result)):
        raise TimeoutError(f'UI message failed or timed out: {msg}')
    return result.value


def visible_window(pid):
    found = []

    @callback_type
    def visit(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, len(name))
        if owner.value == pid and name.value == 'CodeWeaveNativeWindow' and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(visit, 0)
    return found[0] if found else None


def until(predicate, label, timeout=20):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        value = predicate()
        if value:
            return value
        time.sleep(0.025)
    raise TimeoutError(label)


class Application:
    def __init__(self, exe, env, cwd):
        self.process = subprocess.Popen([str(exe)], env=env, cwd=cwd, creationflags=subprocess.CREATE_NO_WINDOW)
        self.parent = psutil.Process(self.process.pid)
        self.stop = threading.Event()
        self.violations = []
        self.seen_children = set()
        self.monitor = threading.Thread(target=self.observe, daemon=True)
        self.monitor.start()
        self.window = until(lambda: visible_window(self.process.pid), 'native window did not appear')
        width, height = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        assert user32.SetWindowPos(self.window, None, 0, 0, min(1440, width), min(900, height - 40), 0x0004)

    def observe(self):
        while not self.stop.wait(0.02):
            try:
                processes = [self.parent, *self.parent.children(recursive=True)]
                for process in processes:
                    if process.pid != self.parent.pid:
                        self.seen_children.add((process.pid, process.name()))
                    if 'electron' in process.name().lower():
                        self.violations.append('Electron process observed')
                    for connection in process.net_connections(kind='tcp'):
                        self.violations.append(f'TCP activity from process {process.name()}: {connection.status}')
            except psutil.NoSuchProcess:
                pass
            except psutil.AccessDenied:
                self.violations.append('Process inspection denied')

    def control(self, identifier):
        control = user32.GetDlgItem(self.window, identifier)
        if not control:
            raise AssertionError(f'Control not found: {identifier}')
        return control

    def text(self, identifier):
        control = self.control(identifier)
        size = message(control, 0x000E)
        buffer = ctypes.create_unicode_buffer(size + 1)
        message(control, 0x000D, len(buffer), ctypes.addressof(buffer))
        return buffer.value

    def set(self, identifier, value):
        buffer = ctypes.create_unicode_buffer(value)
        assert message(self.control(identifier), 0x000C, 0, ctypes.addressof(buffer))

    def click(self, identifier):
        message(self.window, 0x0111, identifier, self.control(identifier))

    def select(self, index):
        message(self.control(1010), 0x0186, index)
        message(self.window, 0x0111, 1010 | (1 << 16), self.control(1010))

    def find_content(self, content_id):
        listing = self.control(1010)
        for index in range(message(listing, 0x018B)):
            size = message(listing, 0x018A, index)
            buffer = ctypes.create_unicode_buffer(size + 1)
            message(listing, 0x0189, index, ctypes.addressof(buffer))
            if f'[{content_id}]' in buffer.value:
                return index
        raise AssertionError(f'Missing content: {content_id}')

    def register(self, email, name):
        self.set(1012, email)
        self.set(1013, name)
        self.set(1014, 'Native-Smoke-Password-123!')
        self.click(1015)
        assert '注册成功' in self.text(1018), self.text(1018)

    def run_code(self, language, code, expected):
        self.set(1005, language)
        self.set(1001, code)
        self.click(1007)
        until(lambda: self.text(1031).strip().replace('\r\n', '\n') == expected, f'{language} execution output did not match {expected!r}')
        until(lambda: '个事件' in self.text(1027), 'execution trace did not render')
        return self.text(1004)

    def close(self):
        user32.PostMessageW(self.window, 0x0010, 0, 0)
        self.process.wait(timeout=15)
        self.stop.set()
        self.monitor.join(timeout=2)
        assert self.process.returncode == 0, self.process.returncode
        assert not self.violations, self.violations

    def cleanup(self):
        if self.process.poll() is None:
            for child in self.parent.children(recursive=True):
                child.terminate()
            self.process.terminate()
            self.process.wait(timeout=10)
        self.stop.set()
        self.monitor.join(timeout=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--content', type=Path, default=Path(__file__).resolve().parents[1] / 'native/content')
    parser.add_argument('--screenshot', type=Path, default=Path(__file__).resolve().parents[1] / 'evidence/native-product.png')
    args = parser.parse_args()
    exe = args.exe.resolve(strict=True)
    content = args.content.resolve(strict=True)
    report = {'exe_sha256': hashlib.sha256(exe.read_bytes()).hexdigest(), 'checks': []}
    app = None
    with tempfile.TemporaryDirectory(prefix='cw-native-product-') as temporary:
        root = Path(temporary)
        workspace, data = root / 'workspace', root / 'data'
        (workspace / 'config').mkdir(parents=True)
        (workspace / 'config/codeweave.config.example.json').write_text('{}', encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if not k.startswith('CODEWEAVE_')}
        env.update(CODEWEAVE_NATIVE_WORKSPACE=str(workspace), CODEWEAVE_NATIVE_DATA_ROOT=str(data),
                   CODEWEAVE_NATIVE_CONTENT_ROOT=str(content))
        for language, program in [('PYTHON', 'python'), ('JAVASCRIPT', 'node')]:
            tool = shutil.which(program)
            assert tool, f'{program} is required for this test'
            env[f'CODEWEAVE_NATIVE_{language}_TOOL'] = tool
        try:
            app = Application(exe, env, workspace)
            menu = user32.GetSubMenu(user32.GetMenu(app.window), 0)
            assert menu, 'data menu missing'
            for command in range(1040, 1045):
                assert user32.GetMenuState(menu, command, 0) != 0xFFFFFFFF, f'data command missing: {command}'
            report['checks'].append('data menu exposes backup/restore/account import/learning import/data folder')
            assert message(app.control(1010), 0x018B) == 74
            for index in range(74):
                app.select(index)
                assert app.text(1011).strip(), f'Empty body at {index}'
            report['checks'].append('74 published lessons/challenges opened in real UI')
            app.register('native-smoke-a@example.test', '自动验收账户 A')
            app.click(1033)
            first = app.run_code('javascript', 'console.log("native-js-first");', 'native-js-first')
            second = app.run_code('javascript', 'console.log("native-js-second");', 'native-js-second')
            assert first != second
            third = app.run_code('python', 'print("原生 Python 验收")', '原生 Python 验收')
            traces = list(data.glob('accounts/*/execution/trace.v1.log'))
            assert len(traces) == 1
            sessions = {bytes.fromhex(line.split('\t')[2]).decode() for line in traces[0].read_text().splitlines()}
            assert {first, second, third}.issubset(sessions)
            report['checks'].append('real JavaScript/Python output and unique trace sessions')
            app.select(app.find_content('stage-d'))
            message(app.control(1023), 0x00F1, 1)
            app.run_code('javascript', app.text(1001), '待办数量: 2\n写周报\n跑一次构建')
            until(lambda: '：1 条' in app.text(1022), 'independent challenge did not create progress')
            report['checks'].append('independent stage-d challenge saved personal progress')
            app.click(1033)
            saved = '// 中文草稿，重启后必须保留\nconsole.log("draft-persisted");'
            app.set(1001, saved)
            app.click(1002)
            app.select(app.find_content('python-loop-sum'))
            app.click(1017)
            assert '登录后' in app.text(1022)
            app.register('native-smoke-b@example.test', '自动验收账户 B')
            assert '：0 条' in app.text(1022), app.text(1022)
            assert '待办数量' not in app.text(1031), 'previous account output leaked'
            assert '尚无本账户' in app.text(1027), 'previous account trace summary leaked'
            assert '待办数量' not in app.text(1031)
            assert '个事件' not in app.text(1027)
            app.click(1033)
            assert saved != app.text(1001)
            report['checks'].append('second account cannot see first account drafts/progress')
            app.click(1017)
            app.set(1012, 'native-smoke-a@example.test')
            app.set(1014, 'Native-Smoke-Password-123!')
            app.click(1016)
            assert '登录成功' in app.text(1018)
            assert app.text(1001).replace('\r\n', '\n') == saved
            # Corrupted hint metadata must never upgrade an assisted attempt.
            account_root = traces[0].parent.parent
            hint_id = 'lesson-' + hashlib.sha256(b'stage-j').hexdigest() + '-hint.txt'
            (account_root / 'drafts' / hint_id).write_bytes(b'corrupt marker')
            app.select(app.find_content('stage-j'))
            message(app.control(1023), 0x00F1, 1)
            app.run_code('javascript', app.text(1001), 'scriptalert(1)/script\ntrue')
            assert '：1 条' in app.text(1022), 'damaged hint marker was treated as independent'
            report['checks'].append('corrupt hint marker cannot create independent completion')
            app.select(app.find_content('stage-d'))
            user32.SetForegroundWindow(app.window)
            time.sleep(0.3)
            rect = wintypes.RECT()
            assert user32.GetWindowRect(app.window, ctypes.byref(rect))
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).save(args.screenshot)
            report['screenshot'] = str(args.screenshot.resolve())
            app.close()
            assert not list(data.rglob('.native.lock'))
            report['checks'].append('normal close releases native data locks')
            standalone_env = dict(env)
            standalone_env.pop('CODEWEAVE_NATIVE_WORKSPACE')
            standalone_env.pop('CODEWEAVE_NATIVE_CONTENT_ROOT')
            app = Application(exe, standalone_env, workspace)
            assert message(app.control(1010), 0x018B) == 74
            report['checks'].append('packaged config/content discovered without environment overrides')
            app.set(1012, 'native-smoke-a@example.test')
            app.set(1014, 'Native-Smoke-Password-123!')
            app.click(1016)
            assert '登录成功' in app.text(1018), app.text(1018)
            app.click(1033)
            assert app.text(1001).replace('\r\n', '\n') == saved
            assert '：1 条' in app.text(1022)
            report['checks'].append('restart/login restores account draft and progress')
            app.close()
            assert not list(data.rglob('.native.lock'))
            damaged = account_root / 'drafts' / 'scratch.txt'
            damaged.write_bytes(b'x' * (4 * 1024 * 1024 + 1))
            original_digest = hashlib.sha256(damaged.read_bytes()).hexdigest()
            app = Application(exe, env, workspace)
            app.set(1012, 'native-smoke-a@example.test')
            app.set(1014, 'Native-Smoke-Password-123!')
            app.click(1016)
            assert app.text(1001) == '', 'failed draft must not silently load a starter'
            app.click(1002)
            assert hashlib.sha256(damaged.read_bytes()).hexdigest() == original_digest
            app.click(1017)
            assert '登录后' in app.text(1022), 'damaged read-only draft blocked account logout'
            assert app.text(1001) == '', 'logout retained the previous account draft'
            app.close()
            assert not list(data.rglob('.native.lock'))
            report['checks'].append('oversized existing draft remains unchanged when save is requested')
            report['checks'].append('no TCP activity or Electron process observed during 20ms process sampling')
        finally:
            if app:
                app.cleanup()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
