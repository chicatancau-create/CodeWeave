# 【网页端】_WEB_CLIENT

CodeWeave 的浏览器端产品工程。按 `【前后端完全分离工程方案】/工程方案.md` §3.1 与 §7.1 建立：
这一端负责浏览器界面、交互状态、API 客户端，以及本项目 `server/` 内的网页服务发布源。浏览器代码不读服务实现、运行数据，也不在客户端启动服务。

## 边界（可核对的那几条）

| 允许 | 禁止 |
| --- | --- |
| 通过 HTTP 调用本项目网页服务的 `/api/*`（同源相对路径） | `import` 服务实现、桌面端源码 |
| 只读消费 `contracts/` 生成并同步进来的类型与码表 | 读 `data/users.json`、学习事实、资料库正文、快照与备份 |
| 保存 UI 偏好与**用户明确选择的离线草稿** | 自行计算或写入正式掌握度、伪造「已完成/已写回」 |

生产代码里没有任何指向 `../backend`、`../data`、`../【本地应用端】_DESKTOP_APP` 的导入；
这条由 §10.1 的结构门禁扫描钉住，不是靠约定。

## 直接打开

双击 `启动网页端.cmd`。它直接启动本项目 `server/service/server.mjs`，并把本项目的 `dist/` 作为静态发布目录；服务使用配置解析器决定端口和数据根。

## 命令

| 目的 | 命令 |
| --- | --- |
| 安装 | `corepack pnpm install` |
| 类型检查 | `corepack pnpm typecheck` |
| Lint（只扫本包） | `corepack pnpm lint` |
| 测试 / 覆盖率 | `corepack pnpm test` / `corepack pnpm test:coverage` |
| 构建静态产物 | `corepack pnpm build` |
| 全部门禁一次跑完 | `corepack pnpm run verify` |
| 开发模式（需外部给定 API origin） | `corepack pnpm dev`，由启动器注入 `CODEWEAVE_DEV_API_ORIGIN` |

`verify` 包含网页服务语法检查；发布前还要对 `/api/health` 和首页执行 HTTP smoke，确认实例身份与安全响应头。

本包**脱离后端源码目录**即可安装、类型检查、Lint、测试与构建——这是分离方案 §10.2 的第一条门禁。

## 目录

```
src/
├─ pages/ components/        # 页面与组件
├─ state/                    # 仅 UI、表单、加载、错误、筛选状态
├─ api/                      # API origin 解析、请求与会话客户端、错误映射
├─ content/                  # 内容渲染（正文、双链、附件、写回面板）
├─ data/ engine/ hooks/ utils/ types/ design/
tests/                       # 本端源码的纪律守卫（焦点样式、令牌、复习节奏等）
```

## 数据与暂存

`localStorage` 里只允许两类东西：UI 偏好，以及带 `schemaVersion` 与拥有者范围、
且被明确标记为「离线草稿」的未提交内容。正式学习事实只从后端读（§6.3）。

分离之前遗留的浏览器存储数据已完成只读取证与备份，位置与口径见
`../data/recovery/20261002-分离前基线/localstorage-export/` 与 `../data/recovery/20261002-前后端分离盘点/盘点报告-20261002.md` 第 5 节。
迁移入口在后端包的 `migrations/`，导入需显式确认，冲突逐条列出——不会静默覆盖，也不会伪造已迁移。

