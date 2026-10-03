# 【本地应用端】 Desktop App

CodeWeave 的 Windows Electron 过渡桌面端。它是一个**独立产品**：自带本机运行时与经过核验的界面发布产物，
与网页端服务器各自运行，互不依赖、也不共用端口与数据根；最终方向是 C++23 + Win32 原生应用。

## 直接打开

双击 `启动本地应用.cmd`。脚本使用本项目内的 Electron、`artifacts/backend-runtime` 和网页端 `dist/` 启动开发态桌面应用；它不会寻找不存在的工作区外 EXE。应用不把真实账户、学习数据或私人资料库打进安装包。

## 两端怎么分开

| | 网页端（网页项目及其 `server/`） | 本地应用端（桌面） |
| --- | --- | --- |
| 端口 | `4173`，来自 `【后端数据服务】_BACKEND_DATA/config/codeweave.local.json` | `4273`，写死在 `src/runtime/runtime.mjs` 的 `DESKTOP_DEFAULT_PORT`，`--desktop-port=` 可覆盖 |
| 数据根 | 网页服务器显式配置的数据目录 | `workspace/data/runtime/desktop` |
| 代码来源 | 网页项目自己的源码/产物 | 打包进 exe 的本机运行时与 `resources/renderer` 发布产物 |

端口**必须**不同：两端各自跑一台后端，共用一个端口就只能开一个，而且后起的那一端会读到前一端的
账户与进度。桌面端仍然拒绝「端口被占就换一个」——换端口等于换一份浏览器存储，学习记录会分裂。

## 代码边界

- `src/main/main.mjs`：窗口、菜单、生命周期、本机服务编排。
- `src/runtime/`：工作区定位、产物定位（`artifacts.mjs`）、健康探针与身份核对（`runtime.mjs`）。
- `src/api/loopback.mjs`：renderer 只接受显式注入的 loopback origin。
- `scripts/package.mjs`：打包入口，见下。

## 重新打包

```
cd E:\\CodeWeave\\应用端
node scripts/package.mjs --renderer "../网页端/dist" --runtime "artifacts/backend-runtime" --skip-build
```

`--renderer` / `--runtime` 必须是**发布产物**目录，脚本刻意不去猜网页项目或其他兄弟目录的源码路径。
本机前提：PATH 里要能找到 `pnpm` —— electron-builder 在 Windows 上用 PowerShell 调
`pnpm list --json` 收集依赖树，本机只有 `corepack` 时会报 `No JSON content found in output`。
产物落在 `build/CodeWeave.exe`，要交付到工作区外那份需显式 `--deliver E:\CodeWeave`。

## 原生重构入口

```powershell
corepack pnpm run audit:boundary
corepack pnpm run native:configure
corepack pnpm run native:build
corepack pnpm run native:test
```

`native/` 是最终 C++23/Win32 方向的最小切片。正式发布仍需 MSVC + Windows SDK；MinGW 只能验证当前原型。


