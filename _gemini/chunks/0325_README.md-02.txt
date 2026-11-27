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

