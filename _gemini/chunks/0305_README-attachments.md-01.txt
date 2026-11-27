# 附件与图片按白名单访问（DATA-10 §4）— **已实现**

> 本文件既是设计契约，也是实现说明。2026-09-20 DATA-10 收尾轮把「写成契约但未实现」
> 的部分落地为代码：§2/§3/§4 的每一条都对应 `server/content/asset.mjs`、
> `server.mjs` 的一条分支、`src/content/markdown.tsx` + `src/content/wikilink.ts`，
> 以及 §5 列出的两份测试。**语义与本轮之前的契约一致，未另起第二套规则。**

## 0. 当前真实行为（已实现的部分）

- 服务端：`GET /api/content/asset?path=<库根相对路径>` 按白名单受控读取资料库文件；
  判定链是「鉴权 → 路径解析（复用 `vault-paths.mjs`）→ 普通文件 → 已发布目录门禁 →
  扩展名白名单 → 大小上限」，任何一步不过都是一条**固定文案**的错误响应。
- 前端：`src/content/markdown.tsx` 只把「库根相对路径 + 位图白名单 + `rejectReasonFor` 通过」
  的 `![说明](路径)` 渲染成 `<img src="/api/content/asset?path=…">`；
  其余（含 `svg`/`html`/`js`/`css`、绝对路径、`..`、`javascript:`、`![[嵌入]]` 语法、
  原始 HTML 标签）**继续按纯文本显示**，与本轮之前完全一致。
- 全文仍然没有 `dangerouslySetInnerHTML`、没有 `innerHTML` 赋值、不生成任何 `href`；
  唯一的 `src` 出口是同源 `/api/content/asset?path=…`，且只可能是位图白名单内的相对路径。
- 因此不存在「半开的安全面」：读不到就是一句人话 + 明确的失败提示，不会静默消失。

## 1. 目标与范围

让教材里确实引用的图片/附件（如 `复习大纲/**/assets/*.png`）在**已登录且已授权**的前提下可读，
同时保证：越界与 junction 逃逸拒绝、非白名单扩展名拒绝、原始 HTML 永不执行。
本轮不允许改 `styles.css`、`src/components/**`，因此界面侧只允许追加最小内联样式
（`markdown.tsx` 里两条内联 `style`：图片不溢出、失败提示用 `--muted`）。

## 2. 接口契约（新增一条，不改既有路由与鉴权口径）

```
GET /api/content/asset?path=<库根相对路径>     （仅此一个查询参数）
```

- 处理位置：`server.mjs` 的 `handleContentRequest()` 内新增一条分支（位于
  `/api/content/sync` 之前），因此自动沿用既有口径：**未登录 401 `unauthorized` →
  未授权 403 `vault_private` / `owner_record_corrupt` → 内容服务错误码映射**；
  全局 `/api/content/` 前缀判定（`url.pathname.startsWith('/api/content/')`）与既有同步限流保持不变。
- 只接受 `path`（库根相对路径，正斜杠），**绝不接受** root、绝对路径、磁盘位置、URL：
  查询串里出现除 `path` 以外的任何键 → 400 `invalid_relative_path`（实测：`?path=…&root=D:\x` 被拒）。
- 服务端解析：`server/content/vault-paths.mjs` 的 `resolveInsideRoot(root, path)`
  —— 先 `normalizeRelPath`（拒绝 `..`、绝对路径、盘符），realpath 后仍必须在库根内，
  越界与经 symlink/junction 逃逸都抛 `path_escape`（`vault-paths.mjs:85` 的实际行为；
  原文「分别 path_escape / source_not_found」按代码修正为：**词法越界与链接逃逸都是 `path_escape`**，
  `source_not_found` 只表示「文件不存在/不可读」）。
- 附件分支在调用 `resolveInsideRoot` 之前只做两条与前端 `wikilink.ts` **同口径**的形态检查：
  带协议/盘符形目标（`^[a-z][a-z0-9+.-]*:`）、以及查询串解码后仍残留 `%` 的二次编码试探
  （契约 §5.3 要求 `path=%2e%2e%2f…` 必须 400）。两者都是 `invalid_relative_path`。
- 错误口径：`invalid_relative_path`/`path_escape` → **400**；`source_not_found` →
  归一为 **404 `asset_not_found`**；非白名单扩展名 → **403 `asset_type_forbidden`**；
  超过大小上限 → **413 `asset_too_large`**（契约只给了上限没给状态码，此处补 413）；
  资料库未连接 → **503 `vault_unavailable`**（与既有内容接口同码）。
- **所有失败响应用固定文案**，不回显资料库绝对路径、磁盘位置，也不回显调用方传进来的路径。

## 3. 白名单（扩展名 → MIME，双清单缺一不可）

| 扩展名 | 响应 `Content-Type` | 说明 |
| --- | --- | --- |
| `png` `jpg` `jpeg` `gif` `webp` | `image/<对应类型>` | 仅位图 |
| `pdf` | `application/pdf` | `Content-Disposition: inline` 且 `X-Content-Type-Options: nosniff` |
| `txt` `csv` `json` | `text/plain; charset=utf-8` | 强制按纯文本返回，不给 `text/html`、也不给 `application/json` |

- **明确排除**：`svg`、`html`、`htm`、`xhtml`、`js`、`mjs`、`css`、任何可执行/可嵌入类型
  （SVG 与 HTML 都能带脚本，属于“原始 HTML 执行”的旁路）。它们**根本不进** `ASSET_TYPES` 表。
- 大小上限 5 MiB；`Cache-Control: private, max-age=300`；`Vary: Cookie`；
  `ETag` 用文件指纹 = `sha256(库根相对路径 + 大小 + mtimeMs)` 前 32 位（不内嵌磁盘路径）；
  目录一律拒绝（只允许 `statSync().isFile()`，目录与不存在的文件同为 404）。
- **条件请求**（2026-09-23 补）：`If-None-Match` 命中当前 ETag 时回 **304**，只发
  `Cache-Control` / `ETag` / `Vary` 加统一安全头，**不开文件、不发正文**，也不发
  `Content-Type` / `Content-Length` / `Content-Disposition`。三条口径：
  ① 比对排在全部门禁**之后**（路径、普通文件、已发布目录、类型、大小都过了才谈 ETag），
  所以一条 304 蕴含「这个请求本来就该拿到 200」，它不会成为存在性探针；
  ② `Vary: Cookie` 是必需的——一台浏览器里可以登多个账户，同一 URL 对不同账户可见性不同，
  没有它则账户 A 的正文或 304 会被浏览器直接给账户 B 用；
  ③ 匹配按 RFC 9110 §8.8.3：逗号列表逐个比、忽略 `W/` 弱前缀、`*` 在有 ETag 时命中。
- 只有**已发布内容引用过**的路径才允许命中：以内容快照里的 `reading.path` 所在目录为前缀做
  第二道门禁（防止用白名单扩展名去试探库里未发布的私人文件）。取值口径与
  `index.mjs` 的 `lessonSummary().sourcePath` 一致（`reading.path` 优先，退回首条
  `sectionRefs[].path`），库根顶层单个文件不构成目录前缀、以无快照（未同步/快照损坏）时**全部 404**（fail closed）。
- **判定顺序**（实现补明的细节）：门禁在扩展名之前。落在已发布目录之外的文件，
  无论扩展名是否在白名单内，一律 404 `asset_not_found`；这样 403/404 的差异不会变成
  「这个私人文件存在」的探针。已发布目录之内才谈类型（403）。
- 以 `.` 开头的路径段（`.obsidian`、清单里声明的 `.hidden` 等）不对外，与
