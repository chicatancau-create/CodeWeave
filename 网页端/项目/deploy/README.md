# Web-only 部署

服务器制品只允许来自本目录的 `dist/` 与网页服务发布清单。Windows 应用目录、Electron、Node 桌面运行时、EXE、应用本地数据和恢复目录不得进入部署上下文。

构建网页静态制品：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
```

部署前必须检查制品白名单。网页验收视口固定为 375、768、1280、1440：

```powershell
Get-ChildItem dist -Recurse -File | Where-Object { $_.Extension -in '.exe','.msi' -or $_.FullName -match '[\\/]electron[\\/]|[\\/]desktop[\\/]|[\\/]node_modules[\\/]|[\\/]data[\\/]' }
```

该命令应无输出。网页 API 服务按服务器环境单独部署，不能把 Windows 应用包上传到服务器。
