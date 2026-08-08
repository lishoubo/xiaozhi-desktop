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

export type OtaTabIntent = BindHotelIntent;
