/**
 * 远端 OTA 账号状态的**唯一判断入口**。
 *
 * ⚠ 这些状态字符串由 RMS 服务端定义（`RmsOtaAccount.status` 是裸 string，没有枚举
 * 约束），desktop 只是照着渲染——本地无法产生也无法验证它们。当前的分类是按已知
 * 语义猜的，**待与服务端对齐**（见
 * `openspec/changes/add-ota-reauth-and-channel-filter/design.md` 决策 6）。
 *
 * 集中在这里而不是散落成 `['LOGIN_FAILED', ...]` 字面量数组：对齐时只改这一个
 * 文件。`HotelManagementPage` 此前就散着一处。
 */

/**
 * 登录态坏了、可以靠重新登录恢复的状态。
 *
 * `PENDING_LOGIN`/`WAITING_CAPTCHA` 也走登录入口，但它们是「还没登完」而不是
 * 「登录坏了」，不计入需要关注的异常数（见 `needsAttention`）。
 */
const NEEDS_REAUTH = new Set(['LOGIN_FAILED', 'LOGIN_EXPIRED', 'PENDING_LOGIN', 'WAITING_CAPTCHA']);

/** 登录类异常——与「还没登完」区分开，只有这两个计入需要关注。 */
const LOGIN_BROKEN = new Set(['LOGIN_FAILED', 'LOGIN_EXPIRED']);

/**
 * 占用「该酒店 + 该渠道」这个绑定位的状态。
 *
 * 判断依据是**远端会不会以「已存在活跃绑定」拒绝再次绑定**，不是「这个账号现在好
 * 不好使」——所以登录失效也算占位：它占着位，只是需要修。只有明确解绑才算释放。
 */
const NOT_ACTIVE = new Set(['UNBOUND']);

/**
 * 需要用户关注、但**不是重新登录能解决**的状态：酒店信息没同步成功、平台酒店名
 * 与当前酒店对不上。刷新 cookie 不会让这些问题消失，因此与 `needsReauth` 分开。
 */
const NEEDS_ATTENTION_OTHER = new Set(['INIT_FAILED', 'HOTEL_NAME_MISMATCH']);

export function needsReauth(status: string): boolean {
  return NEEDS_REAUTH.has(status);
}

/**
 * 概览计数用：需要用户处理的异常。与改动前的判定保持一致（登录失败/失效 + 初始化
 * 失败 + 酒店不匹配），不含「还没登完」的中间态。
 */
export function needsAttention(status: string): boolean {
  return LOGIN_BROKEN.has(status) || NEEDS_ATTENTION_OTHER.has(status);
}

export function isActiveBinding(status: string): boolean {
  return !NOT_ACTIVE.has(status);
}
