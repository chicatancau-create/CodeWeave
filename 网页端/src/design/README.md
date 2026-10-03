# M3 设计提取报告 ·「变幻视界」→ CodeWeave 设计令牌

> 阶段：M3 全站视觉竖切的第一步「设计提取」。
> 输入：`staging/style-pack/`（只读，未改动）。依据：`docs/00-CodeWeave三合一总工程方案.md` §5.1 / §5.2 / §5.3 / §5.4。
> 产出：`app/src/design/tokens.css`、`geometry.md`、`provenance.md`、本文件。全部为新增文件。

## 0. 边界与影响声明

- **（2026-09-29 更正，本节下面两条为提取期原状，已过时）** 提取期的「未修改任何既有文件」「本目录尚未被任何入口 import」两条**均已不成立**：`src/main.tsx` 现在 `import './design/tokens.css'` 早于 `./styles.css`（见该文件顶部注释），`tokens.css` 已成为运行时的 `:root` 真源，改动它有全站视觉影响。本节其余条目（命名空间、目录治理、`--accent` 改写要求）仍然有效。
- 未把模板源码复制进 `app/`（§3.1 目录治理禁止「原始风格包混入 app」）。这里只有令牌与说明。
- 令牌命名空间 `--ds-`，与现有 `--accent`（`app/src/styles.css` L31）、`--line`(L27)、`--radius`(L55) 不重名。接入时**必须显式改写**现有 `--accent`，不能让两套并存。

## 1. 读取顺序（按 §5.1 执行，实际读到什么）

| 序 | 文件 | 字节实测 | 说明 |
| --- | --- | --- | --- |
| 1 | `staging/style-pack/README.md` | 4,634 | 包结构 + 风格 DNA + 5 条注意事项 |
| 2 | `staging/style-pack/STYLE-GUIDE.md` | 15,204 | 规格书：令牌/字阶/布局/组件/动效时间轴 |
| 3 | `source/index.html` | 8,726 | 结构、启动屏与降级屏标记、**L9 平台 SDK 引用** |
| 4 | `source/css/site.css` | 15,127 | 权威样式表，全文通读（§5.1 表 9 项主要在此） |
| 5 | `source/js/main.js` | 12,795 | 337 行全读：点缀色插值、滚动编排、帧循环 |
| 6 | `source/js/gpu.js` + `shaders/post.wgsl` | 7,448 / 4,353 | 因需判断降级与资源释放才读（§5.1「需要渲染再看」） |
| 7 | `shaders/scene.wgsl` | 21,553 | 仅读头部与 uniform 结构，未逐行 |
| 8 | `analysis/computed-styles.json`、`analysis/dom-runtime.html` | 26,828 / 15,925 | 只作对照。**未粘贴其内联样式**（§5.1 末段） |

包内 20 个文件齐备，与方案 §2.2「20 个文件逐项 SHA-256 一致」的文件数吻合；六张参考截图实测 **1280×720**，与 §5.4 的比对基准一致（详见 `provenance.md` §4）。

## 2. §5.1 九类基础项逐条核实（不照抄，逐值回源码比对）

| 基础项 | 源码实际值（文件/行） | 风格说明值 | 核实结论 |
| --- | --- | --- | --- |
| 背景 | `#000`（site.css L14；应用点 L34、L45；启动层 L424；降级层 L465） | 同 | **一致** |
| 正文色 | `#f4f1ee`（L15，body 继承 L46） | 同 | **一致** |
| 次级/三级色 | `rgba(244,241,238,.56)`（L16）/ `.34`（L17） | 同 | **数值一致**；但 `.34` 在黑底实测 2.69:1，不能承载信息 → 见 §6 |
| 细线 | `--hair: rgba(244,241,238,.14)`（L18）**另有两档同族**：`.16`（L176 章节轨竖线、L447 进度条底）、`.07`（L94 取景框） | §2 令牌块只列 `.14`；§5.2/§4 又出现 `.16`/`.07` | **说明不完整，以源码为准** → 令牌拆成 `--ds-line-hair/-raised/-frame` 三档 |
| 场景点缀四色 | 橙 `255,122,47`、品红 `255,95,210`、青 `63,240,200`、金 `255,194,92`（main.js L16-L21 原文）；初始 `--accent: rgb(255,122,47)`（site.css L19） | §2.1 表同值 | **一致**（逐通道核对通过）。运行时时序：每帧 lerp 写行内样式（main.js L288），仅在与上一帧不同时写（L285-L289） |
| 字体 | `--f-display` / `--f-mono` 两条不同栈（L24、L25），`@font-face` Geist Mono 变量 `font-weight: 100 900`、`font-display: swap`（L5-L11） | §3 同值，但把两条栈并列陈述 | **值一致**；回退链只有 PingFang SC / Noto Sans SC，**无 Windows 中文回退**（缺口，非冲突）→ §3 C4 |
| 展示标题 | `.display`：`clamp(2.6rem,6vw,6rem)`、`line-height:1`、`-0.03em`、`font-weight:200`（L258-L263）；`.title`：`clamp(1.7rem,3.6vw,3.4rem)`、`1.15`、`-0.02em`、`200`（L270-L274） | §3.1 字阶表同值 | **一致**；但结尾大标题字号说明有误 → §3 C1，行高风险 → C2 |
| 缓动 | `cubic-bezier(0.22, 1, 0.36, 1)`（L28，12 处引用） | §2 同 | **一致**。注意 GSAP 侧另用 `power1/2/3.out`、`power2.in`、`expo.out`、`none`（main.js L173/L179/L187/L195/L203/L211/L246），与 CSS 缓动**不同族，不可互相换算** |
| 形态 | 圆角全站仅两档：`50%`（L118/L128/L431）与 `100px`（L393）；1px 线（L94/L291/L299/L365/L372/L406）；**零卡片底色、零投影**（运行时 `backgroundColor: rgba(0,0,0,0)`、`boxShadow: none`） | §1、§4、§6 同 | **一致**。方案要求移除的「玻璃卡片 / 渐变按钮」实际来自现有 app（`styles.css` L17-L18 `--glass`、L41 `--accent-gradient`，用在 L228/L276），模板本身就没有 → 接入时是「删现有」而不是「改模板」 |

方案 §5.1 表里预填的期望值（`#000`、`#f4f1ee`、`.56`/`.34`、`.14`、四色、`cubic-bezier(0.22,1,0.36,1)`、字重 200/负字距）**全部与源码吻合，无一需要修正**；不吻合的是说明文档的三处描述，见下节。

## 3. 源码与说明冲突裁定（一律以源码为准）

- **C1 结尾大标题字号**。`STYLE-GUIDE.md` §3.1 记「`.display.outro-title` 同 `.display`（clamp(2.6rem,6vw,6rem)）」；源码 site.css **L358** 覆写为 `clamp(1.7rem, 3.6vw, 3.4rem)`，注释自陈「与章节标题同一尺度」。运行时快照未采到 `.outro-title`，无法反证 → **采源码 L358**。令牌只保留两档展示字号：`--ds-size-display`、`--ds-size-title`。
- **C2 展示标题行高（模板自身的内在矛盾）**。声明值 `line-height: 1`（L259）与说明一致，但源码注释 L256 写「0.86 的行高会让上下两行叠在一起」（与声明 1 不符，是陈旧注释），而 L269 注释明确要求「行高必须 > 1，中文多行标题在 0.98 下会上下相碰」；而结尾标题实际是三行 `.ln`（index.html L131-L135）且继续继承 `line-height: 1`。裁定：**数值采声明（1）**，但产品规则定为「多行中文展示标题一律用 `--ds-leading-title: 1.15`，`--ds-leading-display: 1` 仅限单行拉丁/短中文」。
- **C3 细线只有一档**。见 §2 表「细线」行：源码三档、说明令牌块一档 → 采源码三档。
- **C4 中文回退**。风格包 README 注意事项 5 与 site.css L24-L25 都把中文回退写成 PingFang SC / Noto Sans SC（macOS/Android 取向）。本工程跑在 Windows，两者通常不存在，会落到 `monospace` 由系统字形链接兜底。不是源码/说明冲突，而是**模板能力缺口**，按 §5.1「Windows 增加明确可用的中文回退并实测」在 `--ds-font-display/-mono` 里补 `Microsoft YaHei`/`Microsoft JhengHei`/`Consolas`，**并在浏览器实测前视为未验证**。
- **C5 运行时快照的「0.8px 细线」**。`analysis/computed-styles.json` 里 `.backtop`、`.fx-grain` 的 border 序列化为 `0.8px solid`，是采集时视口缩放 0.8 的痕迹，非源码值（源码 L392/L94 均为 `1px`）。裁定：**采源码 1px**；此例正是 §5.1「不得粘贴 dom-runtime/计算样式」的实证理由。附带记录：该 JSON 是**属性白名单**（如 `.stage` 缺 `maxWidth` 键，不等于源码无该值），且实含 35 个选择器 + 1 个 `vars` 映射（说明文档称「36 个关键选择器」，把 `vars` 计入了）。
- **C6 `dom-runtime.html` 含平台徽标**。快照里有 `kimi-brand-*` 类名与 46 处 GSAP 写入的 `style=`，源码 `index.html` 里都没有 → 徽标属运行时注入，不是设计要素（§5.3.5）。

## 4. 模板中**不适用**于学习工作台的要素（接入时排除）

| 模板做法（行号） | 为何不适用 |
| --- | --- |
| 固定全屏画布 z0 + `body.is-booting{overflow:hidden}`（L64-L74、L54） | 启动即锁滚动会阻断业务入口，违反 §5.3.1/§5.3.2 |
| `.nogpu` 全屏覆盖 z22、只有一段劝退文案（L459-L471） | 是死胡同页；产品的无 GPU 态必须是「黑场 + CSS 视觉 + 入口照常可用」 |
| `.boot` 启动屏进度（L420-L455） | 登录/学习页不能被着色器编译进度挡住表单 |
| `.hud` 9.5px 遥测含 `fps`、缓冲分辨率（index.html L38-L43；main.js L300-L304） | §5.3.6 明确 FPS 不得变成用户必看信息；9.5px 也不可作正文 |
| `.rail-item{display:none}`(≤640px)、`.rail-item b{display:none}`(≤900px)、`.hud{display:none}`（L479、L489、L495） | 把导航文字整体隐藏；§5.2 末段要求手机保留可见菜单入口与返回路径 |
| 隐藏滚动条 `scrollbar-width:none` + `::-webkit-scrollbar{display:none}`（L38-L41） | 长表单与长代码行需要可定位的滚动指示 |
| `.display{white-space:nowrap}`（L261） | 长中文标题在窄视口会溢出裁切；§5.4 专门要测「长中文标题」 |
| `mix-blend-mode: difference/screen`（L112、L95） | 与代码高亮、选中、放大镜/读屏渲染不可预测；装饰层可留、文字层不用 |
| 逐帧 `--accent` 变色（main.js L285-L289） | §5.1 要求工作台固定当前场景；状态色更不能跟（见 §5.3.6 与令牌 §4 注释） |
| 240vh/300vh sticky 章节 + 遮罩逐行升起 + `scrub 0.55`（L215-L233、L265-L266、main.js L141-L227） | 属滚动表演（scroll-jacking），编辑器与长文阅读页禁用；只留给入口/路径概览 |
| 指针视差推移构图 shift 0.30 / shiftY 0.40（main.js L318-L326） | 表单与代码区里造成漂移，一律不启用 |
| `::selection{background:var(--accent);color:#000}`（L56） | 代码块大面积选中会变整片霓虹；产品改为低饱和 wash |
| 大面积泛光 `box-shadow … 26px`（L433）+ post.wgsl bright-pass/双层模糊（post.wgsl L3、L105-L106） | 方案要求移除泛光；渲染层 bloom 不进业务 UI |

## 5. §5.3 降级要求 → 模板原实现缺口对照（接入时由产品侧补齐）

| # | 要求（§5.3） | 模板现状（证据） | 缺口与产品做法 |
| --- | --- | --- | --- |
| 1 | 入口/路径概览可用四场景；编辑器与长文默认静态 | 全站单一场景驱动，无「静态模式」开关 | 场景选择由视图决定，不在工作台跑渲染 |
| 2 | WebGPU **按需加载**，不阻断表单 | `main.js` 顶层 `import { Renderer } from './gpu.js'`（L6），`start()` 无条件执行（L336） | 缺口：现在无论有无 GPU 都会拉 gpu.js 与两个 `.wgsl`（`fetch`，gpu.js L31-L34）。产品须 `await import()` + 失败即回退，且表单先行可用 |
| 3 | 无 GPU / **设备丢失** / shader 失败 → 黑场 + CSS 视觉、入口可用 | 仅 `renderer.init()` 的 try/catch → 显示 `.nogpu`（main.js L49-L58）；shader 编译错误取第一条抛出（gpu.js L39-L45）；**全文无 `device.lost` 监听** | 缺口：设备丢失后无恢复路径，画面静止但循环照跑。产品须监听 `device.lost`、置空 render 循环、落回纯 CSS 层，且**不用全屏遮罩** |
| 4 | `prefers-reduced-motion` 须**真正停止持续动画** | CSS 只关掉 `.dot`/`.boot-mark`/`.cue-line::after` 三个 keyframes 与 `scroll-behavior`（L501-L504）；JS 侧 `scrub → true`（L141，动画仍随滚动播放，只是失去平滑）、`intro` 直接 `opacity:1`（L242-L245）、锚点 `behavior:'auto'`（L237），但**帧循环仍满帧跑、时间只是 ×0.35**（L315） | **模板的一处实质不适配**：`REDUCED` 不等于停。产品须：取消 RAF、不注册视差与滚动时间线、GPU 不提交帧（`--ds-anim-play-state` 只解决 CSS 那一半）；同时尊重应用内既有 `settings.reduceMotion`（app.tsx L193、L600 已在根节点挂 `reduce-motion` 类） |
| 5 | React 卸载取消 RAF / 监听器 / ScrollTrigger，释放 GPU 纹理与缓冲；后台暂停；限制像素比 | `requestAnimationFrame(frame)` 自续（L311）；`resize` 监听在 `loop()` 内注册且从不摘（L332）；`pointermove` 监听不摘（L259）；ScrollTrigger 时间线无 `kill()`（L137-L227）；`Renderer` **无 `destroy()`**，纹理仅在 `resize()` 里 `destroy`（gpu.js L108），device 不释放；无 `visibilitychange` | 全部为缺口。已有的一条好性质可沿用：像素比上限 `min(dpr,1.6)`（gpu.js L12）与按 fps 在 `0.72…maxScale` 间自适应降/升（L152-L153）；装饰层已有 `pointer-events:none`（L81/L93/L354）与 `aria-hidden`（index.html L13/L14/L38）→ 这条符合 §5.3.6，保留 |
| 6 | 装饰层不截获输入、不进辅助技术阅读顺序 | 同上，已满足 | 仍需检查固定层 z8 不压过弹层（现有弹层 z 需重排，见 `geometry.md` §5） |

可直接沿用的渲染参数（非 CSS 令牌，写在 JS 侧常量里即可）：`dt` 上限 0.05s（main.js L312）、指针平滑系数 `k = 1 - 0.001^dt`（L318）、HUD 每 16 帧刷新（L300）、章节高亮阈值 `blend > 0.5`（L291）、结尾压暗 `dim 1 → 0.30`（L120）、模糊链降采样 `>>2`（gpu.js L111-L112）、每帧 7 道通道（gpu.js L188-L194）。

## 6. 对比度实测（§5.1「按实际合成背景验证」+ §5.4「正文 ≥4.5:1、大字 ≥3:1」）

按 WCAG 2.x 相对亮度公式计算，前景以 alpha 合成到 `#000`（脚本临时执行，未入库）：

| 色值 | 对 #000 对比度 | 判定 |
| --- | --- | --- |
| `#f4f1ee`（1.0，L15） | 18.66 | 通过（含 AAA） |
| 暖白 `0.85` / `0.82`（L379 / L306） | 13.24 / 12.29 | 通过 |
| 暖白 `0.56` = `--dim`（L16） | 5.86 | 正文通过 AA（弱光背景上浮到 `rgb(14,14,15)` 时仍有 5.39） |
| 暖白 `0.34` = `--dimmer`（L17） | **2.69** | **不通过**：低于大字 3:1。只能用于可丢失的装饰 |
| 细线 `.14` / `.16` / `.07` | 1.32 / 1.40 / 1.11 | 装饰线；不可当焦点或输入框边界（非文本要求 3:1） |
| 橙 / 品红 / 青 / 金（四点缀色） | 8.08 / 7.82 / 14.51 / 13.12 | 作为图形/文字色均达标，但**不携带状态语义** |
| 状态绿 / 黄 / 珊瑚 / 蓝（现有 app 语法色） | 11.07 / 13.29 / 8.74 / 5.66 | 通过 AA |

阈值反解（同一公式）：暖白在纯黑上需 **α≥0.37** 过 3:1、**α≥0.49** 过 4.5:1、**α≥0.62** 过 7:1；在压暗层上抬到 `rgb(14,14,15)` 时对应 0.39 / 0.51 / 0.65。据此令牌层做了两条偏离模板的决定：`--ds-field-border: 0.38`（输入框静止边界，≥3:1）、`--ds-focus-ring: 0.72`（焦点轮廓，远高于 3:1），而 `--ds-text-tertiary` 保留模板原值 0.34 并标注「仅限装饰」。§5.1 表里「三级色」原值可用，但**不得**用于 dt 标签、状态文字、时间戳之外的必读信息；模板自己就把它用在 `.specs dt`、`.foot`、`.hud`（L201、L305、L415）—— 迁移这些位置时要逐条换到 0.56 或更高，这是 M4 的活。

## 7. 下一步（本步不做，交由接入方）

1. `main.tsx` 引入 `./design/tokens.css`（在 `./styles.css` 之前），把 `styles.css` 的 `:root` 逐组改指 `--ds-*`，删除 `--glass`/`--accent-gradient`/`--radius` 系。
2. 先做 §5.4 指定的四个代表页竖切：登录（`components/auth-view.tsx`）、学习路径（`learning-path-view.tsx`）、学习工作台（`learning-workspace-view.tsx`）、证据预览（`evidence-writeback-view.tsx`），形态分配见 `geometry.md` §2。
3. 若要复刻四场景渲染：动效依赖 GSAP 3.13.0 + ScrollTrigger 为 GreenSock 标准许可（**非 MIT**，许可原文与风险见 `provenance.md` §2），且本期禁止新增依赖 → 优先用 CSS + `requestAnimationFrame` 自实现，或就许可与打包方式单独决策。
4. 视觉验收前须实测：Windows 中文回退是否真命中 YaHei、320px 下细线与字号、`reduce-motion` 下 RAF 是否真停。

**遗留不确定项**（如实记录，未凭记忆补写）：Geist Mono 的实际字形覆盖未做位图/文本级验证（只有源码注释 L21-L23 与 71,368 字节的体积佐证）；`post.wgsl`/`scene.wgsl` 未逐行审计（本次只需判断降级与泛光）；六张截图未做像素级判读（仅取尺寸），如需以某张为基准比对，需在接入阶段单独看。
