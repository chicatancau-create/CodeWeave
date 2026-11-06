# -*- coding: utf-8 -*-
"""CodeWeave 应用端 Qt/QML 开工前环境自检。只读检查，不修改系统。"""
import os, sys, glob, subprocess

PREP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '.local', 'prep'))
FAIL, WARN = [], []


def ok(m):  print('  [OK]   %s' % m)
def bad(m): print('  [FAIL] %s' % m); FAIL.append(m)
def warn(m): print('  [WARN] %s' % m); WARN.append(m)


print('\n===== 1. Qt SDK =====')
qtroot = None
for c in sorted(glob.glob(os.path.join(PREP, 'qt', '*', '*'))):
    if os.path.exists(os.path.join(c, 'bin', 'qmake.exe')):
        qtroot = c
        break
if not qtroot:
    bad('找不到带 qmake.exe 的 Qt 目录')
else:
    ok('Qt 根目录: %s' % os.path.relpath(qtroot, PREP))
    b = os.path.join(qtroot, 'bin')
    for f in ('qmake.exe', 'windeployqt.exe', 'moc.exe'):
        (ok if os.path.exists(os.path.join(b, f)) else bad)(f)
    for d in ('Qt6Core.dll', 'Qt6Gui.dll', 'Qt6Quick.dll', 'Qt6Qml.dll', 'Qt6Svg.dll'):
        (ok if os.path.exists(os.path.join(b, d)) else bad)(d)
    (ok if os.path.isdir(os.path.join(qtroot, 'qml')) else bad)('qml 模块目录')
    (ok if os.path.isdir(os.path.join(qtroot, 'LICENSES')) else warn)(
        'LICENSES 目录: ' + ('在位' if os.path.isdir(os.path.join(qtroot, 'LICENSES')) else '缺失（aqt 版没有，交付时要自己补许可证）'))
    (ok if os.path.isdir(os.path.join(qtroot, 'sbom')) else warn)(
        'sbom 目录: ' + ('在位（可作许可信息来源）' if os.path.isdir(os.path.join(qtroot, 'sbom')) else '缺失'))
    print('\n  CMake 前缀路径（开工时贴这行）：')
    print('    -DCMAKE_PREFIX_PATH=' + qtroot.replace('\\', '/'))

print('\n===== 2. 编译器与 SDK =====')
ms = glob.glob(r'C:\Program Files (x86)\Microsoft Visual Studio\*\*\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe') + \
     glob.glob(r'C:\Program Files\Microsoft Visual Studio\*\*\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe')
if ms:
    ver = ms[0].split(os.sep + 'MSVC' + os.sep)[1].split(os.sep)[0]
    ok('MSVC cl.exe %s' % ver)
    if ver.startswith('14.4'):
        ok('MSVC 与 Qt 6.8 msvc2022 二进制同代（14.4x），CRT 可对齐')
else:
    bad('找不到 cl.exe')
sdk = [d for d in glob.glob(r'C:\Program Files (x86)\Windows Kits\10\Include\*') if os.path.basename(d)[0].isdigit()]
(ok if sdk else bad)('Windows SDK: ' + (', '.join(os.path.basename(s) for s in sdk) or '未找到'))

print('\n===== 3. 构建工具 =====')
for t in ('cmake', 'ninja'):
    try:
        v = subprocess.run([t, '--version'], capture_output=True, timeout=20).stdout.decode('utf-8', 'replace')
        ok('%s: %s' % (t, v.splitlines()[0]))
    except Exception as e:
        bad('%s 不可用 (%s)' % (t, type(e).__name__))

print('\n===== 4. 测量与验收工具 =====')
pm = glob.glob(os.path.join(PREP, 'presentmon', 'PresentMon*.exe'))
(ok if pm else warn)('PresentMon: ' + (os.path.basename(pm[0]) if pm else '缺失'))
(ok if os.path.exists(r'C:\Windows\System32\narrator.exe') else warn)('Narrator 读屏')

print('\n===== 5. 已实测到的三条硬约束（不是提醒，是结论） =====')
print('  [!] 中文路径会让 Qt 的 qmlimportscanner 失败（实测乱码），')
print('      项目根在 G:\\CodeWeave\\应用端 —— U1 必须在 ASCII 路径下构建。')
print('  [!] qt_add_qml_module 必须设 qt_policy(QTP0001 NEW)，否则 QML 不嵌资源、')
print('      loadFromModule 静默失败（实测退出码 -1）。')
print('  [!] windeployqt 实测交付 59.4 MB（带 --qmldir）；若在 vcvars 环境里跑会再带')
print('      vc_redist.x64.exe 24.4 MB ≈ 84 MB。总工程 §101 的 50 MiB 阈值必超 1.2-2 倍。')
print('  [!] CRT：native/CMakeLists.txt 用 /MT，Qt 二进制是 /MD，Qt 目标要独立构建树。')

print('\n===== 结果 =====')
if FAIL:
    print('  %d 项未通过' % len(FAIL)); sys.exit(1)
print('  全部通过，环境就绪。%s' % ('（%d 项警告）' % len(WARN) if WARN else ''))
