# Phase 4.1 历史拆分对照

本目录保存 2026-11-11 对 Qt 页面拆分的受控截图对照。截图在 Windows 真窗口、1440 × 900、DPR 1 下采集，使用隔离临时数据、无活动账户，加载 `python-loop-sum`，依次访问学习、复习、挑战、编辑器、草稿、分析和账户。报告中的页面检查仅核对页面名、尺寸和账户状态，页面实际加载还需结合 QML 警告判断。

## 版本与记录

- `before-results`：拆分前 `32cbc260ec1a73e1f72215d88c7c31b981dbe088` 加统一截图 harness。七张截图，但 `codeEditor is not defined` 警告导致报告失败，进程退出码 3。
- `after-results`：初轮页面抽取 `e20590b8d395c0a9f0c73fd3ccbac512da3704ec` 加同一 harness。七张截图，但挑战页令牌为空、编辑器和账户页类型加载失败，共四条 QML 警告，退出码 3；不能作为正常拆分后对照。
- `isolated-results`：基于上述初轮抽取，补齐共享组件和设计系统的结构性拆分，未引入 4.2 行为或文案变化。保留拆分前的 `codeEditor` 警告，退出码 3。
- `before-fixed-results` 和 `isolated-fixed-results`：分别在前述拆分前及隔离拆分快照的 TextArea 上加入同一 `id: codeEditor` 后，用新构建目录构建并采集。两组均退出 0、七页检查通过、QML 警告为零，两个报告的 `states` 一致。

`comparison-harness.patch` 是统一采集代码；`before-common-id.patch` 是拆分前快照的共同修补；`isolated-split-and-common-id.patch` 包含隔离结构拆分和共同修补。`prepare.py` 与 `build.cmd` 保留当时的实验脚本作为记录；构建脚本包含本机临时路径和 `CMAKE_SUPPRESS_REGENERATION=ON`，并非可直接跨机器运行的复现脚本。原始失败与修补后结果分别保存，不能把修补后的结果当作原始提交的运行结果。

## 像素对照

以下为 `before-fixed-results` 与 `isolated-fixed-results` 同名 PNG 的 RGB 比较。每张图共 1,296,000 像素；每个颜色通道的最大绝对差均为 1/255。

| 页面 | 不同像素数 |
| --- | ---: |
| learning | 2649 |
| review | 1820 |
| challenge | 3658 |
| editor | 1155 |
| drafts | 1446 |
| analytics | 3265 |
| account | 1127 |

差异约占各图像素的 0.09%–0.28%；原因尚未证实。该结果表明此受控状态下截图高度接近，但并非逐像素一致，不能推及其他状态、当前 HEAD 与网页端之间的等价性，也不能证明初轮抽取提交本身正常运行。

为估计运行间波动，再次运行同一个拆分前修补版二进制，结果保存在 `before-repeat-results`。报告通过、QML 警告为零，记录的 `states` 与首次运行一致。首次与重复截图按上述页面顺序分别有 2333、1810、3528、1055、1393、3127、1014 个 RGB 像素不同，每通道最大差均为 1/255。同一程序重复运行的差异与拆分对照处于同一量级，但不能据此确定每处差异的成因。

`sha256.json` 记录本目录除自身以外的文件 SHA-256，用于检查证据完整性。目录内 Git 属性保留原始字节；补丁标记为二进制差异，避免将补丁上下文行误报为新增文件的尾随空格。
