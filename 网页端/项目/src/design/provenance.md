# 来源、版本与许可记录 ·「变幻视界 / EVENT HORIZON」风格包

> M3 设计提取的第三份产出，与 `tokens.css`、`geometry.md`、`README.md` 同批。
> 本文只登记**可核事实**（文件、字节、hash、许可头原文、读取与未读取范围），不做风格判断。
> 所有 hash 与文件数由脚本实测，不引用他人转述。

## 1. 输入与归档位置

| 项 | 实测值 |
| --- | --- |
| 来源站点 | `https://ydib2klyjbndm.ok.kimi.link/`，2026-09-19 提取 |
| 项目内暂存 | `workspace/staging/style-pack/`（20 文件 / 7,791,332 字节，`find` 计数与 `du -sb` 实测） |
| 版本控制状态 | **未入库**：`workspace/.gitignore` L46 `staging/` 整目录忽略（00 号方案 §2 职责边界：staging/style-pack 不进入生产运行时依赖） |
| 输入归档 | `style-pack.zip`，SHA-256 `0e9501b7fd39635044cab6bb5a8c6ab431fc0a45d1d0847f9176b246ab41203e`（M0 §1 记录，本次复核未变） |
| 归档真实格式 | 名 `.zip` 实为 GNU TAR（`ustar` 头）。Python `zipfile` 拒绝、`unzip -l` 退出 9、Windows `tar.exe` 可读。修正记录见母体 `docs/format-note.md`；M0 挂账的 TPL-01 事项本轮关闭 |
| 项目外母体 | `E:\CodeWeave-recovery\style-mother\event-horizon\1.0.0\`（2026-09-28 外层归并后的现路径；归并前叫 `E:\CodeWeave-Style-Mother\event-horizon\1.0.0\`，那次归并后移动后 40 条 hash 清单 `sha256sum -c` 仍全 OK）：`original-input/`（不改写的输入）、`upstream/`（20 文件，与本暂存 `diff -rq` 无差异）、`starter/`（净化副本）、`docs/`（规格·来源·差异·用法·13 件证据）、`checksums.sha256`（40 条，`sha256sum -c` 全 OK）、`Event-Horizon-Style-Mother-v1.0.0.zip`（真 ZIP，40 条目，解出后逐文件 hash 与清单一致） |

**因 `staging/` 不入库，母体归档是这份模板的唯一持久副本。** 产品代码不依赖母体目录路径（§9.5 判据），删除或移动母体目录不影响构建与运行。

## 2. 第三方运行时与许可（对外再分发前必须处理）

| 组件 | 版本 | 许可头原文 | 缺什么 |
| --- | --- | --- | --- |
| `source/vendor/gsap.min.js` | 3.13.0 | `@license Copyright 2025, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license.` | **非 MIT**。许可**正文缺失**，只有两行指向 URL 的头注 |
| `source/vendor/ScrollTrigger.min.js` | 3.13.0 | 同上（同一份 GreenSock standard license 头） | 同上。全文件检索 `MIT` 无独立许可声明（命中项是压缩代码里的普通单词，不构成许可） |
| `source/fonts/GeistMono-Variable.woff2` | 无版本号 | 字体文件内**无**许可与署名信息；包内 README / STYLE-GUIDE 也未附字体许可 | 许可文本与可再分发范围**缺**。且该字体不含中文字形，不得声称覆盖中文排版（§5.1 字体行） |
| 站点设计与代码（`index.html` / `site.css` / `main.js` / `gpu.js` / `shaders/*.wgsl`） | — | 包内**零署名、零许可声明** | 来源与授权状态**未明**，对外再分发前必须补齐核验 |

处置（本轮已执行）：M3/M4 的产品页面**不引入** GSAP、ScrollTrigger 与该字体文件作为运行时依赖——工程方案本期禁止新增外部依赖，且 standard license 的再分发条件未核清。设计令牌取的是**数值**（颜色、缓动、字号、层级关系），数值本身不触发这些许可；许可风险只在打包/再分发第三方代码时才成立。若后续决定引入动效库，属 §10「新外部依赖/重大取舍」，需用户明确批准。

## 3. 净化差异（唯一一处）

| 文件 | 行 | 原内容 | starter 处置 |
| --- | --- | --- | --- |
| `source/index.html` | L9 | `<script src="https://www.kimi.com/sdk-seed.js" defer data-kimi-disable-watermark="false" data-kimi-analytics="false"></script>` | 删除该行，保留 `</head>`（§5.3 第 5 条：产品副本及净化 starter 必须移除平台 SDK 引用，原始 upstream 保留原字节） |

实测：`upstream` 与 `starter` 逐文件校验只有 `changed ["source/index.html"]`，其余 19 文件 hash 一致；无路径断裂，因此未改任何引用。截图中的 Kimi 平台徽标不属于产品设计要求，未作为参照。

## 4. 参考图与比对基准

`screens/` 六张（`00-hero`、`01-chapter0-brief`、`02-chapter1`、`03-chapter2`、`04-chapter3`、`05-outro`）实测均为 **1280×720**，与 §5.4「模板参照在 1280×720 下比对」的基准一致。母体证据里记录了 PNG 只含 IHDR/IDAT/IEND 三段，即无嵌入元数据可依赖——**图的尺寸是证据，图里的平台水印与 FPS 读数不是设计要求**。

## 5. 本轮设计提取实际读了什么

| 用途 | 文件 |
| --- | --- |
| 令牌取值 | `source/css/site.css`（504 行，逐值引行号）、`source/js/main.js`（`ACCENTS` 常量与逐帧写 `--accent` 的实现） |
| 降级取证 | `source/js/gpu.js`、`site.css` 的 `.boot`(L419–L456) 与 `.nogpu`(L459–L465) 段 |
| 形态与层级 | `site.css` 的 `z-index` 7 档与 4 处 `border-radius`（见 `geometry.md` §1） |
| 风格说明 | `README.md`、`STYLE-GUIDE.md`——**仅**在源码没有对应数值时才作参照，冲突一律以源码为准（§5.1） |
| 未采用 | `analysis/dom-runtime.html`、`analysis/computed-styles.json`：§5.1 明令只作运行时参考，本次未粘贴其任何内联样式 |

## 6. 未验证与挂账

- 没有对原站做任何写操作，也没有再次抓取；「2026-09-19 提取」的完整性以输入归档 hash 为准，不以 URL 当前内容为准。
- 三项许可（GSAP standard license 正文、Geist Mono、站点设计授权）的**补齐核验**是对外再分发的前置条件，属 M7 交付收口，不是本地开发的阻塞项。
- `upstream → starter → CodeWeave design` 的完整差异记录（§9.6）要等 M3 四页与 M4 全站落地后才能写，本轮只在 `tokens.css` 与 `geometry.md` 里登记了取值来源。
- 字体是否真被产品页面使用：未使用（见 §2 处置）。因此 Windows 中文回退链的效果需在 M3 验收时用真实浏览器实测。
