# 阶段 4.1 拆分证据独立核验

核验日期：2026-11-12。核验对象是原始任务 4.1 的七页、六个共享组件和设计令牌抽取，以及已保存的历史受控截图对照。本次核验没有重建或运行历史二进制；实际执行的是 Git 对象读取、补丁在内存重放、源码结构比较、报告一致性检查、SHA-256 校验和已有 PNG 像素复算。除本文件外，本次核验未修改文件。

## 结论

- [通过] 七页与六个共享组件均已抽取并注册，没有发现正式拆分遗漏。隔离快照有意保留拆分前行为，排除了阶段 4.2 的新增行为及后续统计口径修正。
- [通过] 隔离结构补丁的全部上下文与 `e20590b` 精确匹配；重建出的八个文件的 Git blob 哈希全部匹配补丁 `index` 中记录的目标哈希。
- [通过] 已保存的两份最终历史报告均通过，八项检查、七张截图列表及逐页 `states` 完全相同；七张 PNG 的实算像素指标与历史 README 一致。
- [边界] 结论为“受控历史状态下结构抽取未发现明显视觉变化”。不表示原始抽取提交本身已正常运行，也不表示所有数据、交互、窗口尺寸或当前 HEAD 与拆分前完全等价。
- [通过] 重复运行内嵌核验器时，历史目录 `sha256.json` 的 65 项均匹配（README 哈希已由并行终验工作同步）；本次未修改历史目录文件。

## 对照版本与覆盖范围

历史证据目录：`应用端/工程文件/验收证据/Phase41-split-comparison-20261111/`。

| 对象 | 已核实内容 |
| --- | --- |
| 拆分前 | `0761017^` 精确解析为 `32cbc260ec1a73e1f72215d88c7c31b981dbe088` |
| 初轮抽取范围 | `0761017`、`6d8041a`、`c32bbb2`、`6c6baa4`、`723b8c5`、`2b4fa5a`、`a178cba`、`e20590b` |
| 后续正式修复 | `edc74a7e78b35c27958f5ba8f81cb58b55d61b48`，同时含阶段 4.2 的键盘行为，不应整体当成纯拆分补丁 |
| 七个页面 | StudyPage、EditorPage、ChallengePage、DraftsPage、ReviewPage、AnalyticsPage、AccountPage |
| 六个共享组件 | NavItem、IconButton、PrimaryButton、QuietButton、ShellField、SubjectPill |
| 设计令牌 | DesignSystem.qml，使用 `hostWidth` 代替原内联对象的 `root.width`，Main 绑定 `hostWidth: root.width` |
| 资源与装载 | 隔离快照 CMake 注册 Main、DesignSystem、六组件和七页，共 15 项；均有真实文件。Main 以七个 `sourceComponent` Loader 注入宿主和令牌，不再保留任何内联 component |

初轮提交已抽取七页和 PrimaryButton、QuietButton、SubjectPill；隔离补丁再补齐 DesignSystem、NavItem、IconButton 和 ShellField。补丁并非只比较最后三个组件：七页已来自基底 `e20590b`，且全部被统一 harness 访问和截图。

## 源码结构核对

检查拆分前 Main 内联体与提取文件时，仅规范化导入、缩进/空行、`property QtObject ds` / `property var hostRoot`、令牌注入以及 `hostRoot.` 对原 `root.` 的作用域替换；保留用户文案、数值、表达式和信号处理逻辑进行比较。

| 对象 | 结果及结构差异 |
| --- | --- |
| StudyPage、ReviewPage、AnalyticsPage | 规范化后与拆分前内联体逐行相同 |
| PrimaryButton、QuietButton、SubjectPill | 规范化后与拆分前内联体逐行相同 |
| DraftsPage | 一个单行 QuietButton 改为多行，逻辑不变 |
| EditorPage | 新增页面 id；`evidenceDialog.open()` 改为 `hostRoot.openEvidenceDialog()`，由宿主保留 Dialog 所有权 |
| AccountPage | 新增页面 id；`passwordDialog.open()` 改为 `hostRoot.openPasswordDialog()`，由宿主保留 Dialog 所有权 |
| ChallengePage | 原根作用域的两态 `chStatus()` 移入页面，返回值不变 |
| DesignSystem、NavItem、IconButton、ShellField | 隔离补丁抽取后，在移除注入属性并将 `hostWidth` 还原为 `root.width` 后，与拆分前内联体逐行相同 |

与正式修复 `edc74a7` 再比较：隔离补丁产生的 DesignSystem、NavItem、ShellField、EditorPage 与正式对象字节相同；AccountPage 仅 id/ds 属性行顺序不同。IconButton 和 QuietButton 保留正式键盘增强之前的行为，StudyPage 保留拆分前的统计显示，避免把这些后续行为变化混入纯结构视觉对照。

`EditorPage` 的导入、两个错位 ds 赋值和 `id: codeEditor` 修补均与正式修复一致。拆分前也应用 `before-common-id.patch` 补上同一 TextArea id，因此不能把共同修补后的通过结果当作原始拆分前提交的原样运行结果。

## 实际命令与结果

以下 Git 命令在 `G:\CodeWeave` 执行，均为只读：

```powershell
git rev-parse 0761017^
git log --oneline --reverse 0761017^..e20590b
git -c core.quotepath=false diff --name-status 0761017^ e20590b -- 应用端/项目/native/ui-qt
git show --format= edc74a7 -- 应用端/项目/native/ui-qt/qml/pages/EditorPage.qml 应用端/项目/native/ui-qt/qml/pages/AccountPage.qml 应用端/项目/native/ui-qt/qml/pages/StudyPage.qml 应用端/项目/native/ui-qt/qml/components/QuietButton.qml
git apply --numstat 应用端/工程文件/验收证据/Phase41-split-comparison-20261111/isolated-split-and-common-id.patch
```

结果：正式抽取范围包含 CMake、Main、七页、三个先行共享组件；补充隔离补丁修改八个文件；`git apply --numstat` 只解析并统计补丁，不应用到工作树。

以下复核命令仅使用 Python 标准库、已安装的 Pillow 和只读 Git 命令；重放产物仅存在于内存，不创建 worktree、不写索引、不修改历史证据。它覆盖补丁上下文/目标 blob、资源存在性、报告、SHA 和像素的可重复验证点：

```powershell
@'
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
from PIL import Image, ImageChops

sys.stdout.reconfigure(encoding="utf-8")
root = Path(r"G:\CodeWeave")
evidence = root / "应用端/工程文件/验收证据/Phase41-split-comparison-20261111"
patch_path = evidence / "isolated-split-and-common-id.patch"

def show(revision, path):
    result = subprocess.run(["git", "show", revision + ":" + path],
                            cwd=root, capture_output=True)
    return result.stdout.decode("utf-8") if result.returncode == 0 else ""

sections = re.split(r"(?=^diff --git )", patch_path.read_text(encoding="utf-8"),
                    flags=re.M)[1:]
numstat = subprocess.check_output(["git", "apply", "--numstat", "-z", str(patch_path)],
                                 cwd=root).decode("utf-8")
paths = [entry.split("\t", 2)[2] for entry in numstat.split("\0") if entry]
assert len(paths) == len(sections) == 8
patched = {}
for path, section in zip(paths, sections):
    old = show("e20590b", path).splitlines()
    output = []
    cursor = 0
    for hunk in re.split(r"(?=^@@ )", section, flags=re.M)[1:]:
        lines = hunk.splitlines()
        match = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[0])
        start = max(0, int(match[1]) - 1)
        assert start >= cursor
        output.extend(old[cursor:start])
        cursor = start
        for line in lines[1:]:
            if not line or line[0] == "\\":
                continue
            if line[0] in " -":
                assert old[cursor] == line[1:], (path, cursor + 1)
                cursor += 1
            if line[0] in " +":
                output.append(line[1:])
    output.extend(old[cursor:])
    text = "\n".join(output) + "\n"
    patched[path] = text
    target = re.search(r"^index (\w+)\.\.(\w+)", section, flags=re.M)[2]
    actual = subprocess.check_output(["git", "hash-object", "--stdin"], cwd=root,
                                     input=text.encode("utf-8")).decode().strip()
    assert actual.startswith(target), path
print("patch: 8/8 exact contexts and target blobs")

prefix = "应用端/项目/native/ui-qt/"
cmake = patched[prefix + "CMakeLists.txt"]
registered = re.findall(r"^\s+(qml/[^\s]+)", cmake, flags=re.M)
assert len(registered) == 15
assert all(patched.get(prefix + path, show("e20590b", prefix + path))
           for path in registered)
assert not re.findall(r"component (\w+):", patched[prefix + "qml/Main.qml"])
print("resources: 15/15 present; no inline component remains")

before = json.loads((evidence / "before-fixed-results/report.json").read_text(encoding="utf-8"))
after = json.loads((evidence / "isolated-fixed-results/report.json").read_text(encoding="utf-8"))
assert before["passed"] and after["passed"]
assert before["qmlWarnings"] == after["qmlWarnings"] == []
assert len(before["checks"]) == len(after["checks"]) == 8
assert before["states"] == after["states"]
assert before["checks"] == after["checks"]
assert before["screenshots"] == after["screenshots"]
print("reports: passed; 8 checks, 7 screenshots, states identical")

entries = json.loads((evidence / "sha256.json").read_text(encoding="utf-8"))
mismatches = [entry["path"] for entry in entries
              if hashlib.sha256((evidence / entry["path"]).read_bytes()).hexdigest()
              != entry["sha256"]]
print("sha256:", len(entries), "entries; mismatches", mismatches)

for page in ["learning", "review", "challenge", "editor", "drafts", "analytics", "account"]:
    first = Image.open(evidence / "before-fixed-results" / (page + ".png")).convert("RGB")
    second = Image.open(evidence / "isolated-fixed-results" / (page + ".png")).convert("RGB")
    assert first.size == second.size == (1440, 900)
    difference = ImageChops.difference(first, second)
    pixels = sum(1 for pixel in difference.getdata() if pixel != (0, 0, 0))
    maximum = max(extreme[1] for extreme in difference.getextrema())
    print(page, "different pixels", pixels, "max channel difference", maximum)
'@ | python -
```

本次实测输出的像素结果：

| 页面 | 不同 RGB 像素数 / 1,296,000 | 每通道最大绝对差 |
| --- | ---: | ---: |
| learning | 2649 | 1/255 |
| review | 1820 | 1/255 |
| challenge | 3658 | 1/255 |
| editor | 1155 | 1/255 |
| drafts | 1446 | 1/255 |
| analytics | 3265 | 1/255 |
| account | 1127 | 1/255 |

## 验收边界与下一行动

历史 harness 固定 Windows 真窗口 1440×900、DPR 1，隔离临时数据、无活动账户，选择 `python-loop-sum` 且未执行。报告的页面断言检查页面名、尺寸、账户和忙碌状态；逐页 `states` 另记录课程、源码/正文哈希、统计和复习数据。它不覆盖所有按钮或其他数据状态。

历史 `qmlWarnings=[]` 采集自 `QQmlEngine::warnings` 的创建/加载期信号，不是全局 Qt 动态消息采集，不替代窄窗几何及动态绑定验证。原始 before/after 失败报告均保留；共同 id 修补后的通过报告没有改写原失败。

差异像素约为 0.09%–0.28%，每通道最多 1/255。历史目录还保存同一拆分前修补版重复采集，其波动处于同一量级；本次不据此断言所有差异的原因，也不声明逐像素完全一致。此处不用于 Qt/Web 跨端视觉验收。

历史 SHA 清单已同步且 65 项均匹配，可将阶段 4.1 记录为受控历史拆分验收通过。下一行动是完成当前版本的构建、CTest 和真实窗口回归，并在本轮终验另行提供实际结果，不沿用本文件替代。
