> 2026-11-06 目录规则：本端外层只留一个启动链接；源码在 `项目/`，工程说明在 `工程文件/`。当前入口和命令以仓库根 `AGENTS.md`、`工程文件/项目结构索引.md` 为准。下文旧根 EXE、旧构建树、旧备份目录及其历史测试记录不再作为当前操作指令，不得据此重建旧布局。

# 应用端 Qt/QML 开工指令（ADR-UI-01 实施交接）

> 交给**接手的 AI 执行体**。前置事实全部经本机实测，不是推断。
> 工具链环境在仓库之外：`G:\CodeWeave\.local\prep`（Qt 6.8.3 + PresentMon + 自检 + 冒烟工程），
> Qt 的树外构建目录是 `G:\CodeWeave\.local\qt`。两者都不随 git 走，换机需重建（见 §2 与 README）。
>
> 工程约束引自 `应用端/工程文件/总工程/应用端总工程.md`（§101/§113/§125/§127）、
> `应用端后端工程.md`（§14、§11 变更登记模板）、`应用端麦当劳模型工程.md`（§1–§7）。

---

## 0. 回滚基线与当前实况

快照提交 **`bdd24ac`**「工作快照：原生重构完成、Qt/QML 实施前的回滚基线」是本轮起点：
233 文件 / +24,625 −3,262，含 `native/src` 全部 61 个 C++ 文件、三端 `工程文件/`、
`evidence/` 实测数据、`native/content/` 课程包、`LICENSE`、`第一版基线.md`。
`.claude/` 已加进 `.gitignore`。**本文件所在的提交是交接点。**

**接手第一件事**：跑 `git log --oneline -8` 与 `git status`，确认你看到的就是最新状态，
不要凭本文推断进度。

2026-10-05 交接时点实测的阶段状态：

| 阶段 | 状态 | 证据 |
|---|---|---|
| U0a 阻塞计时 | ✅ 完成 | `evidence/backend-timing-u0a-20261005.json` |
| U0b 任务执行器 | ✅ 骨架完成，未接调用 | `native/src/backend_task_service.{hpp,cpp}` |
| U0c 单点迁移 | 🟡 只接了只读课程清单 | `ui-qt/facade/ui_shell.cpp` |
| U1 Qt 壳 | ✅ **已能独立启动并渲染** | `evidence/qt-u2-window.{json,png}` |
| U2 facade | 🟡 进行中（草稿能力已加） | `ui-qt/facade/ui_shell_draft.cpp`、`ui-qt/tests/` |
| U3 逐页复刻 | 🟡 起步（1 页深色骨架） | `ui-qt/qml/Main.qml` |
| U4 干净机验收 | 🟡 待外部环境 | 便携候选与 manifest 已通过；干净 Windows、DPI/IME/UIA 和性能对照待执行 |
| B0–B3 安装器 | ✅ 内部预览完成 | 自解压安装器、隔离安装/卸载/数据保留、内部签名 |
| §101 性能对照 | ⬜ **未测**（Qt 与 Win32 同负载） | — |

**你的工作方式：**

- 每完成一个可验证的小步，就单独提交一次，**不要把 U0a 到 U1 攒成一个大提交**。
- 改坏时用：`git checkout bdd24ac -- 应用端/项目/native`（只回退原生代码，保留你的其他改动）。
- **不要 `git add -A`**，不要 `git push`，不要 `reset --hard`，除非用户明确要求。
- 提交前跑 `git status --porcelain` 数一遍，确认没有把 `备份区/`、`native/build*`、
  `app-native-ascii`（**它是 junction，不是目录**）、`.claude/` 卷进去。
- 一旦发现 `.pfx`、`.key`、`.env` 或真实账户文件出现在待提交列表里，**立即停手上报**。

## 0.5 证据规则（最高优先级，凌驾于本文其他所有表述）

**任何「可启动 / 已通过 / 已交付 / 已验证 / 性能提升」的表述，必须同时满足三条，否则一律写成「未验证」：**

1. 指向一个**具体证据文件**（`应用端/项目/evidence/` 下的截图、JSON、日志），或给出可复现命令；
2. 该证据是**本轮你自己跑出来的**，不是引用旧轮次、旧文档或推断；
3. 证据与结论**口径一致**（测的是同一个产物、同一负载、同一台机器）。

**写不了的结论就写「未测」，不要换成含糊说法绕过。** 「生成了部署目录」不等于「可独立启动」；
「编译链接通过」不等于「功能可用」；「CTest 通过」不等于「Qt 版已验收」。

### 本条规则的第一个案例（已修正，留作样板）

`应用端后端工程.md` 曾写「U1 已建立独立 Qt 基础壳，并通过 `codeweave-qt-deploy`
生成**可独立启动**的 Qt 部署目录」。2026-10-05 20:45 实测：**不成立** ——
exe 编译链接成功、部署目录完整，但启动即退出码 1、无窗口。

根因：`ui-qt/qml/Main.qml:2` 有 `import QtQuick.Controls`，而
`find_package(... COMPONENTS Quick Qml)` 与 `target_link_libraries` 都没有 `QuickControls2`，
部署目录 `qml/` 下也确实没有 `QtQuick/Controls` → `ui_main.cpp:18` 的
`view.status() == QQuickView::Error` 命中并 `return 1`。

**已按此修复**（`ui-qt/CMakeLists.txt:3` 与 `:53` 补 `QuickControls2`），
并补了符合本规则的取证：`evidence/qt-u2-window.json`（`exitCode 0`、
`developerPathRemoved: true` 即脱离 Qt PATH 运行、checks 含窗口暴露/取帧/课程清单/正文/starter）
与 `evidence/qt-u2-window.png`（深色侧栏 + 课程列表 + 正文 + Python 草稿区，已人工查看）。
该 JSON 还主动列了 `limitations`：非干净 Windows、无性能测量、无 IME 与无障碍验收。
**这就是本规则要求的写法样板。**

### 仍需警惕的同类历史违规

`应用端后端工程.md` 内尚存多处自相矛盾且未回改：`:477`「缺 cl.exe/msbuild/signtool/Windows SDK」
对 `:488-490`「MSVC 14.44.35207 已装、CTest 6/6」（**本机实测：已装**）；
`:225`「首启自动创建 `%LOCALAPPDATA%` 工作区」对 `:389`「不再自动创建」；
`A0现状与功能基线.md:38`「暂停/继续/单步未接通」对 `:10`「已完成…暂停/继续/单步」。
上述矛盾已在后续实施记录中逐项解决；本段保留为审计历史，不能作为当前状态判断。

## 1. 已确定的方向（不要再讨论，不要重新选型）

- **Qt 6 + Qt Quick/QML + C++**（ADR-UI-01）。
- **性能最高优先**；UI 允许**对照复刻**，不要求复用那 51,586 行 TS/CSS。
- `codeweave-core` 静态库（28 个模块）是业务唯一事实源，**UI 是可替换的壳**。
- Electron 壳已撤除并归档在 `备份区/native-integration-20261005/`，**不要恢复它**。
- 现有 Win32 界面（`native/src/main.cpp`）是**可回滚基线**，Qt 验收通过前不得切换根 EXE。

## 2. 环境（已备好并实测跑通，直接用）

| 项 | 值 |
|---|---|
| Qt | **6.8.3 LTS**，路径 `G:\CodeWeave\.local\prep\qt\6.8.3\msvc2022_64` |
| CMake 前缀 | `-DCMAKE_PREFIX_PATH=G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64` |
| 已装模块 | `qtimageformats` `qt5compat` `qtquicktimeline` `qtshadertools`（SVG 已在 qtbase 内） |
| 编译器 | MSVC **14.44.35207**、Windows SDK **10.0.26100.0**、CMake **4.3.1**、Ninja **1.13.2** |
| 环境自检 | 跑 `G:\CodeWeave\.local\prep\check.cmd`，当前全绿（1 项 WARN，见坑 4） |
| 呈现数据采集 | `G:\CodeWeave\.local\prep\presentmon\PresentMon-2.6.0-x64.exe`（免安装） |
| 可运行参考工程 | `G:\CodeWeave\.local\prep\smoke-qtquick\`（含 `build.cmd`，黑底+青色发光环已验证渲染） |

**为什么是 6.8.3 而不是 6.12.0**：`aqtinstall 3.3.0`（PyPI 最新）不支持 Qt 6.11+ 的新仓库布局
（`qt.qt6.6120.win64_msvc2022_64/`），实测 `qt6_683/` HTTP 200、`qt6_6113/` 与 `qt6_6120/` 全 404。
要升 6.12.0 需走官方在线安装器（要注册 Qt 账号）。**先按 6.8.3 干，别为此卡住。**

## 3. 四个已实测的坑（会浪费你几小时，照做即可避开）

1. **中文路径废掉 QML 构建链。** `qmlimportscanner` 拿到乱码路径直接失败。
   → **Qt 目标必须在 ASCII 路径下构建**，不要放进 `G:\CodeWeave\应用端`。
   建议工作树：`G:\CodeWeave\.local\qt\`（源码副本或 junction 指向 `应用端\项目\native`，但构建目录必须在 ASCII 路径）。
2. **`qt_policy(SET QTP0001 NEW)` 必须设**，且要写在 `find_package(Qt6 ...)` **之后**
   （`qt_policy` 由该包提供）。不设的后果：QML 不嵌资源 → `loadFromModule` **静默失败、退出码 -1、零报错**。
3. **`windeployqt` 必须带 `--qmldir <含 qml 源文件的目录>`**。不带会生成**空的 `qml/` 目录**
   → `import QtQuick` 失败 → 同样静默 -1 退出。（总工程 §127 已提到该参数，照做。）
4. **aqt 装的 Qt 没有 `LICENSES/` 目录**（只有 `doc/`、`sbom/`）。LGPL 随包义务要自己补，见 §7。

## 4. 构建与链接约束

- `native/CMakeLists.txt` 现用 **`/MT`**；Qt 官方 MSVC 二进制是 **`/MD`**。
  → Qt 目标用**独立构建树、统一 `/MD`**，**禁止混链接现有 `/MT` 对象**（总工程 §125）。
- Qt 目标必须是**可选**的：`-DQEWEAVE_BUILD_UI_QT=OFF`（默认 OFF）时，现有核心与 Win32 仍可构建通过。
- **Qt 类型不得进入 `codeweave-core`**；核心保持标准 C++，QObject facade 负责信号转发（后端工程 §14.2）。
- 目标结构按代码结构.md 的规划：`native/ui-qt/{CMakeLists.txt, qml/, facade/, platform/, benchmark/}`。

## 5. 执行顺序（严格按此，不要并行铺开）

**已有基线，别重测也别当没看见。** `应用端/项目/evidence/window-performance.json` 与
`window-performance-mt.json`（2026-10-05 03:36 / 03:46 UTC，status=passed）已给出同机对照：

| 指标 | Electron 95.7 MiB | 原生 Win32 |
|---|---|---|
| 可见窗口 window_ms | 5352.4 / 5358.8 | **72.5 / 119.0 / 138.8 / 145.3** |
| 工作集 MiB | 455.3 / 456.1 | **27.2 / 27.4** |
| 启动 CPU ms | 6765.6 / 6953.1 | **109.4 / 125.0 / 218.8** |
| 关闭 ms | 314.9 / 323.7 | **34.0 / 40.4 / 43.7 / 47.3** |
| 进程数 | 6 | **1** |

→ **原生重构在启动与内存上已经是量出来的大胜（约 40–70× / 约 17×）**，
这不是假设，是既有证据。所以 U1 的问题不是"Qt 会不会比 Electron 快"（一定会），
而是 **「Qt 相对现有 Win32 会吐回多少」** —— 基线就是上表的 27 MiB / 72–145 ms。

该文件自己的 `method` 与 `unmeasured` 字段也已声明：`fresh-profile ≠ OS 冷启动`、
`non-equivalent feature sets`，且**未测** OS cold startup、course loading、editor latency、cancel latency。
这四项目前**仍然缺**，U0/U1 要补的就是它们。

**U0a 先测阻塞时长，别先设计。** §14.2 明确写了「尚未测实际阻塞时长，
不沿用『667 处 IO/秒级假死』的未核实统计」。

1. **U0a**：测这三条已核验的调用链实际耗时，原始样本写进 `evidence/`，不写结论：
   - `main.cpp:1086 → manage_data() → :685-686 → backup_service.cpp:111,153-190`
     （`WM_COMMAND` 内同步递归整树拷贝）
   - `main.cpp:668,682`（旧数据导入，同一条路）
   - `main.cpp:422,432 → account_store.cpp:193,257 → password_crypto.cpp:18-20,72`
     （scrypt N=16384/r=8/p=1，16 MiB 数组，每轮 blockMix 再分配 vector，跑在 UI 线程）

   测出来是 50 ms 还是 3 s，决定 U0b 要做多重。**先测再设计。**

2. **U0b**：`BackendTaskService`（一对 `.hpp/.cpp`）—— 串行队列、有上限、忙时返回 busy；
   每任务带 taskId / accountId / accountGeneration / 取消状态 / 错误结果 / 线程回收 / 关闭窗口等待规则。
   复用 `main.cpp:897-934` 已有的 `std::thread + PostMessageW + generation` 范式，**不引入事件总线**。
   参考 §14.5 的操作矩阵与 §14.5 末段的回归清单（含「100 次重复开关任务无线程/句柄增长」）。
3. **U0c**：**一次只迁一个**已批准的 service 调用（后端工程 §14.6 第 3 条），账户与备份不得同时迁。
4. **U1**：ASCII 路径下建 Qt 原型，四场景**分开计时**：空窗口 / 74 项滚动列表 / 代码编辑区 / 发光动画。
   先跑单负载，再评 Qt 特有动画增量；**不要把功能不同的两个 EXE 当同口径胜负**。
5. **U2 → U3 → U4** 按总工程阶段表推进，门禁未过不得跳阶。

## 6. 测量口径（本机特殊，不处理则数据不可比）

- 本机 **2560×1600 @ 300 Hz、DPI 120**；方案 §101 预算只写 60/120 Hz → **补 300 Hz 档或明确按 60 Hz 目标帧时间判定**。
- GPU 三块：**MuMu Virtual Display Adapter / AMD Radeon 610M / RTX 5070 Laptop**。
  → 基线前**锁定用哪块卡并排除虚拟显示器**，否则 PresentMon 呈现数据会被污染、Qt 可能落在集显。
- 优先用 PresentMon/ETW 取**呈现**数据（渲染结束 ≠ 屏幕呈现）；Qt Profiler 只作定位辅助；工具不可用要标注。
- 冷启动 ≥5 次、热启动 ≥10 次、**交替顺序、保留原始样本**；样本量必须披露（5 个尾部样本作 P95 不成立）。
- 未重启/未控缓存的结果只能叫 fresh-profile。

## 7. 开工前必须定的两个决策（不定就会中途返工）

1. **包体积阈值**：实测交付 **59.4 MB**（带 `--qmldir`）；在 vcvars 环境里 windeployqt 会自动带上
   `vc_redist.x64.exe` 24.4 MB → **约 84 MB**。总工程 §101 写的是「超过 **50 MiB** 必须解释并由用户接受取舍」
   → **必超 1.2–2 倍**。要么现在调阈值，要么准备好取舍说明，别等 U1 测完发现门禁必红。
2. **LGPL 合规交付**：动态链接、随包许可证与通知、提供对应 Qt 源码与替换/重链接能力、
   不得混入 GPL-only 模块（`Qt Canvas Painter` 在 6.11 许可页列 GPLv3，**不用**；
   `QScintilla` 是 GPLv3/商业双许可且是 QWidget，**不进默认依赖**）。
   aqt 版 Qt 缺 `LICENSES/`，交付清单要自己补。**这条需要法律审查，不是你单方面判定。**

## 8. 门禁（每轮收尾必须全绿，未过不得自称完成）

- `corepack pnpm test`（当前 2 文件 / 4 用例）与 MSVC **CTest 7/7** 必须继续通过。
- 后端工程 §14.4 的 U2 六条：账户切换、坏草稿、坏提示、外部证据 Pending、备份恢复、四语言执行回归；
  后台任务期间窗口仍可响应取消与关闭；旧代次结果不覆盖新账户状态；
  facade 不含文件路径写入/账本解析/密码摘要/HWND 操作；核心可在无 Qt 依赖目标中构建。
- 编辑器验收按界面工程 §4 的夹具：常规课程代码、1 MiB 长文件、草稿上限、CRLF/LF、
  emoji/组合字符、**中文 IME 组合输入**、撤销重做、只读坏草稿；保存恢复校验内容 hash。
- Qt 阶段必须补 **Qt Quick Test + 可访问性/UIA 驱动的真实窗口流程**；
  旧 Win32 smoke 通过**不代表** Qt 已测（总工程 §129）。

## 9. 禁止事项

- 不改网页端、移动端、其他端优先级与代码。
- 不碰真实用户数据；真实数据迁移前须只读盘点 + 备份验证 + **用户确认**。
- 不删除旧工程、备份或现有 EXE 来"证明去耦合"。
- 不降低 scrypt 成本、不跳过 hash、不放宽锁来"提高成绩"（§14.5 末段）。
- 不用空窗口替代可用产品；不把原型标为产品完成；不宣称"绝对最快"（无实测不得写"性能提升"）。
- 不恢复 Electron 壳、不嵌入 WebView/WebEngine/Monaco。
- 未经用户指令不提交、不推送、不发布、不上传。

## 10. 顺手要修的文档问题（这些会误导后续判断）

1. `应用端后端工程.md` 里 **MSVC 说法自相矛盾**：`:477` 说「本机缺少 cl.exe/msbuild/signtool/Windows SDK」，
   `:488-490` 与 `native/README:36` 说「MSVC 14.44.35207 已装并 CTest 6/6」。**本机实测：已装**（14.44.35207 + SDK 10.0.26100.0）。
   → 把过期那条改掉。
2. `A0现状与功能基线.md:38`「暂停/继续/单步未接通」与 `:10`「已完成…暂停/继续/单步」矛盾；
   而当前 Win32 界面上**有**这三个按钮。→ 查清实际状态并统一表述。
3. `:225`「首启自动创建 `%LOCALAPPDATA%\CodeWeave\workspace`[通过]」与 `:389`「不再自动创建，改为明确失败」矛盾。
4. `:163`「本轮仅阅读配置，未执行」与 `:206-493` 大量已执行记录矛盾。
5. 多处 `[通过]` 行内路径被 `\n` 转义吃掉字母（`native/`→`/ative/`、`npm`→`pm`），
   集中在 `工程审查待办:62,64` 与 `后端工程:372-411` → **这些行的证据目前不可复核**，需重写。
6. `:20`「`main.cpp` 只绘制标题」已过期（实测 1,378 行，是控件版界面）。

## 11. 还没解决的外部依赖（不要卡在它们上面，先推进 U0）

- **第二台干净 Windows**（无 Qt、无开发 PATH）→ U4 硬要求，目前不具备。
- **Windows Performance Toolkit 未安装**（PresentMon 已可用，够用；要 ETW 全量再装）。
- **中文 IME 真机验收**：本机 zh-CN 键盘 + 2 个文本服务项在位，但**未在真实 Qt 窗口里验过候选窗**。
- **公共代码签名证书**：已决定**不买**。分发走网盘。
  ⚠️ 但要注意：**Store MSIX（免费重签、不弹 SmartScreen）与当前数据根 `%LOCALAPPDATA%/CodeWeave` 冲突** ——
  MSIX 会把 AppData 写入重定向到 per-package 私有位置，**卸载时一并删除**。上 Store 前必须先改数据根落点。
  网盘传输也不保证无弹窗：浏览器下载会带 Mark-of-the-Web，且企业 AppLocker/WDAC 会直接拦未签名 EXE。

## 12. 每轮收尾格式

**先过 §0.5 证据规则**，再按 `应用端后端工程.md` §11 的变更登记模板填写（目标/类型/允许修改/禁止修改/数据所有者/
输入输出/失败与回滚/测试夹具/临时路径/删除核验/实际命令与结果/结果状态），
结果状态只用 `[通过]/[部分完成]/[失败]/[未执行]`。**未测的写"未测"，不要写成通过。**
