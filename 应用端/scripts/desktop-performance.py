"""Windows visible-window comparison; requires Python and psutil.
Fresh profile is NOT a cold OS cache. No debugging port or real user data.
"""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import time

import psutil

user32 = ctypes.WinDLL('user32', use_last_error=True)
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]

def visible_window(pids, kind):
    found = []
    @callback_type
    def visit(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, len(name))
        expected = 'CodeWeaveNativeWindow' if kind == 'native' else 'Chrome_WidgetWin_1'
        if pid.value in pids and name.value == expected and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True
    user32.EnumWindows(visit, 0)
    return found[0] if found else None

def tree(parent):
    try:
        return [parent, *parent.children(recursive=True)]
    except psutil.NoSuchProcess:
        return []

def sample(exe, kind, workspace, profile):
    env = {k: v for k, v in os.environ.items() if not k.startswith('CODEWEAVE_')}
    env.pop('ELECTRON_RUN_AS_NODE', None)
    env.update(CODEWEAVE_DESKTOP_WORKSPACE=str(workspace),
               CODEWEAVE_DESKTOP_PROFILE=str(profile),
               CODEWEAVE_NATIVE_WORKSPACE=str(workspace),
               CODEWEAVE_NATIVE_DATA_ROOT=str(workspace / 'native-data'))
    started = time.perf_counter()
    child = subprocess.Popen([str(exe)], env=env, cwd=workspace,
                             creationflags=subprocess.CREATE_NO_WINDOW,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    parent = psutil.Process(child.pid)
    owned = [parent]
    try:
        window = None
        while time.perf_counter() - started < 45:
            owned = tree(parent)
            window = visible_window({p.pid for p in owned}, kind)
            if window:
                break
            if child.poll() is not None:
                raise RuntimeError(f'{kind} exited before window: {child.returncode}')
            time.sleep(0.01)
        if not window:
            raise TimeoutError(f'{kind}: visible window timeout')
        window_ms = (time.perf_counter() - started) * 1000
        time.sleep(2)
        owned = tree(parent)
        rss = sum(p.memory_info().rss for p in owned)
        cpu = sum(p.cpu_times().user + p.cpu_times().system for p in owned)
        stopped = time.perf_counter()
        if not user32.PostMessageW(window, 0x0010, 0, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        child.wait(timeout=15)
        _, alive = psutil.wait_procs(owned, timeout=10)
        if alive:
            raise RuntimeError('child processes survived normal close')
        if child.returncode != 0:
            raise RuntimeError(f'{kind} exit: {child.returncode}')
        return dict(window_ms=round(window_ms, 3),
                    working_set_mib=round(rss / 1024**2, 3),
                    startup_cpu_ms=round(cpu * 1000, 3),
                    close_ms=round((time.perf_counter()-stopped)*1000, 3),
                    process_count=len(owned))
    finally:
        # Only processes created by this sample; never kill by image name.
        for process in reversed(owned):
            try:
                if process.is_running():
                    process.kill()
            except psutil.NoSuchProcess:
                pass
        child.wait(timeout=10)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--electron', type=Path, required=True)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='cw-visible-benchmark-'))
    result = dict(os=platform.platform(), logical_cpus=psutil.cpu_count(),
                  memory_gib=round(psutil.virtual_memory().total / 1024**3, 2),
                  utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  method='10ms window polling; 2s idle; total RSS includes shared pages; fresh profile is not OS cold cache; non-equivalent feature sets',
                  unmeasured=['OS cold startup', 'course loading', 'editor latency', 'cancel latency'],
                  executables={}, samples=[])
    try:
        for kind in ['electron', 'native']:
            exe = getattr(args, kind).resolve()
            result['executables'][kind] = dict(path=str(exe), sha256=hashlib.sha256(exe.read_bytes()).hexdigest())
        for phase, count in [('fresh-profile', 5), ('warm-profile', 10)]:
            for index in range(count):
                # Alternate order to reduce persistent first-run bias.
                for kind in (['electron', 'native'] if index % 2 == 0 else ['native', 'electron']):
                    fixture = root / (f'{kind}-{phase}-{index}' if phase == 'fresh-profile' else f'{kind}-warm')
                    workspace = fixture / 'workspace'
                    (workspace / 'config').mkdir(parents=True, exist_ok=True)
                    (workspace / 'data/knowledge/vault').mkdir(parents=True, exist_ok=True)
                    (workspace / 'config/codeweave.config.example.json').write_text('{}', encoding='utf-8')
                    row = dict(kind=kind, phase=phase, index=index, **sample(getattr(args,kind).resolve(),kind,workspace,fixture/'profile'))
                    result['samples'].append(row)
                    print(json.dumps(row), flush=True)
        result['status'] = 'passed'
    except Exception as error:
        result['status'] = 'failed'
        result['error'] = str(error)
        raise
    finally:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        # The unique fixture is created entirely by this script.
        shutil.rmtree(root)

if __name__ == '__main__':
    main()
