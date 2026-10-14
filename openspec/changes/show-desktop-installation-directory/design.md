# 设计

主进程在 composition root 根据 `process.execPath` 计算安装目录，并将固定路径注入 `SystemService`。Windows Squirrel 的 exe 位于 `app-版本号` 下时取上一级；其余包取 exe 所在目录。前端不传入任意文件路径。

现有系统偏好响应增加只读 `installationDirectory`。新建无参数 `openInstallationDirectory` 与 `copyInstallationDirectory` IPC，由 service 分别调用 Electron `shell.openPath` 与 `clipboard.writeText`，不接受渲染进程提交的任意路径。设置页在“运行日志”下增加“安装目录”行：显示可选择的路径文本，并提供复制和打开按钮；操作失败时显示提示。

测试覆盖路径计算、IPC 映射、打开目录失败处理，以及沙箱配置恢复。由于本机是 macOS，Windows 的 360 实机效果需在下一次包验证。
