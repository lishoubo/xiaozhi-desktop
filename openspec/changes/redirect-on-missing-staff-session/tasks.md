## 1. 会话失效信号

- [x] 1.1 用定向测试覆盖凭证缺失、refresh 过期与临时网络故障的通知边界。
- [x] 1.2 在 token provider 和认证编排中仅对已确认的会话结束发出通知，并保持错误原意。

## 2. 窗口与界面

- [x] 2.1 用定向测试覆盖主进程事件到 preload 的通道及窗口清理动作。
- [x] 2.2 通过窗口能力和 IPC 把无内容的会话结束事件送到 renderer；主界面收到后回到登录页。

## 3. 验证与规范收敛

- [x] 3.1 运行相关认证、preload、界面测试与 TypeScript/ESLint 检查，记录结果到 verification.md。
- [x] 3.2 独立进行 verification pass，并将验证后的行为同步到稳定的 staff-password-auth 规范。
