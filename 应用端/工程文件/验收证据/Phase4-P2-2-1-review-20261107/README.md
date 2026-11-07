# P2 2.1 复习中心非空行验收

日期：2026-11-07。复习中心三组表格、课程打开、通过和延期操作已用隔离账户完成真实窗口验收。

## 结果

- `review-matrix.json`：101 项检查全部通过，`passed: true`，QML 警告为空。
- 临时账户写入三条掌握度事实，按当前日期构造逾期、今日和未来 7 天三组排期；页面分组、到期日、下一节点、掌握等级均从 facade 的 `reviewItems` 验证。
- “通过”按钮真实调用 `uiShell.reviewItem`，刷新后掌握等级、下一节点和到期日更新；“稍后提醒”真实调用 `uiShell.snoozeReview`，刷新后日期更新且掌握等级/节点保持不变；“查看课程”验证选中发布课程 ID 与正文加载。
- `u3-review-nonempty.png`、`u3-review-updated.png` 为非空与操作后截图。矩阵同时复用既有学习、挑战、账户、草稿和分析回归路径。
- 标准 Qt Release 构建、CTest 9/9、目录布局检查和 `git diff --check` 通过。

## 复现

从仓库根目录执行 `cmd /c 工程文件\工具\构建当前Qt.cmd`，更新当前部署目录中的 EXE 后运行：

```powershell
& "$env:TEMP\<deployment>\CodeWeaveQtShell.exe" --u3-matrix-json "<报告绝对路径>\review-matrix.json"
```

矩阵使用 QTemporaryDir 和隔离账户，不读取或写入真实工作区；窗口必须可见以保存截图。

## 边界

未执行真实账户/正式资料库联调、网页端像素差分和 Android 编译。复习计划使用当前 facade 的 fallback 计划，正式资料库可以提供课程自定义排期时需另做兼容验证。
