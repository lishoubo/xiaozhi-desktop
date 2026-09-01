/**
 * 数据与日志目录里的固定子目录名。
 *
 * ## 为什么是一个常量而不是开关
 *
 * 这里原本是「构建变体」：`staff`（RMS 员工登录）与 `phone`（手机号登录，走
 * hotel-butler server）二选一，打包时由 `XIAOZHI_AUTH_VARIANT` 决定装哪套。
 *
 * phone 那套已删除——它连的 server 地址没有环境默认值，构建时会静默回落到
 * `https://localhost:5173`，打出的包在用户机器上必然连不通（2026-09-01 线上
 * 实测：发验证码与登录都失败）。登录统一走 `StaffLoginPage`，用户在页面上选
 * 「酒店用户」（手机验证码）或「服务商用户」（账号密码），两条都打到 RMS。
 *
 * ## 为什么这层目录还留着
 *
 * 已装用户的登录态与渠道 cookie 都存在 `<userData>/staff/` 下。去掉这层会让
 * 升级后读不到旧数据，等于强制所有人重新登录并重新导入各渠道 cookie——代价
 * 远大于「路径少一层」的收益。
 */
export const AUTH_PROFILE_DIRECTORY = 'staff';
