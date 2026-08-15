/**
 * 打开 OTA 标签页时携带的意图 —— 「这次打开是为了做什么」。
 *
 * intent 由 `LoginDetector` 挂在 tab 记录上保管，随 `tab:credential-checked`
 * 广播带给下游订阅者；tab 关闭时随记录一起消失，不需要单独的清理路径。
 *
 * 目前只有绑定酒店一种。带上它，登录判定完成后才会触发酒店探测并把候选通知到
 * UI；不带则只开 tab 并做登录判定，**完全不探测**（探测会操作用户正在看的页面，
 * 见 `channels/hotel-probe-dispatcher.ts`）。
 */
export type BindHotelIntent = Readonly<{
  kind: 'bind-hotel';
  /** 由发起方（`HotelManagementService.startBinding`）生成，用于让 UI 认领结果。 */
  requestId: string;
}>;

/**
 * 重新登录：只为了刷新这条绑定的登录态，不重新选门店。
 *
 * `expectedChannelAccountId` 是**必须**的——「登录判定完成」不等于「登录的还是原来
 * 那个账号」。不核对就把新 cookie 写上去，会把另一个账号的登录态更新到这条绑定上，
 * 远端状态还会变正常，比原来的「过期」更糟且不报错。
 */
export type ReauthOtaIntent = Readonly<{
  kind: 'reauth-ota';
  requestId: string;
  expectedChannelAccountId: string;
}>;

/**
 * 按门店重认 —— 与 `ReauthOtaIntent` 是同一件事的两种打开方式，分界在**手上有什么**。
 *
 * ```
 * 桌面端绑的   bindExtra.channelAccountId 有 → ReauthOtaIntent    锚点=账号，不探测
 * RMS 后台绑的 bindExtra.channelAccountId 无 → ReauthByHotelIntent 锚点=门店，必探测
 * ```
 *
 * 老记录认不出该登录哪个账号，只能反过来问「这个账号管不管得了这家门店」——所以
 * 必须探测门店。**但探测结果不给用户挑**（门店是已知的，`expectedOtaHotelId` 就是
 * 它），只用于比对，这是它与 `BindHotelIntent` 的根本差别：那条路探测是为了让用户
 * 选一家并**改写**门店关系，这条路探测是为了确认门店关系**没变**。
 *
 * 为什么不给 `ReauthOtaIntent` 加个可选字段而要独立一种：两者的订阅方不同
 * （探测与否是两套逻辑），合并会让「探不探」的判断散进同一个 dispatcher。
 *
 * 核对通过后 `otaAccountId` 用于定位要补写 `bindExtra` 的那条远端记录 —— 补上
 * 账号标识与渠道上下文，这条老记录此后就能按账号识别，不必再走这条路。
 */
export type ReauthByHotelIntent = Readonly<{
  kind: 'reauth-by-hotel';
  requestId: string;
  /** 这条绑定当前绑的门店，探测完拿它比对。 */
  expectedOtaHotelId: string;
  /** 核对通过后补写 `bindExtra` 的目标远端记录。 */
  otaAccountId: number;
}>;

export type OtaTabIntent = BindHotelIntent | ReauthOtaIntent | ReauthByHotelIntent;
