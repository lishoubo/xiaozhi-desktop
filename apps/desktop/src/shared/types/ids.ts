/**
 * 标识符的 branded 类型。
 *
 * 只放**类型**：它们会出现在跨进程传输的数据形状里（`OtaCredential.channel`
 * 等），所以必须在 `shared/`。构造与校验在 `main/ids.ts` —— 那些函数会抛异常，
 * 且只在主进程边界把外部字符串收成合法 id，渲染进程拿到的 id 都是主进程给的，
 * 不该也不需要自己构造。
 *
 * 用 `unique symbol` 而非字符串字面量做 brand，别处写不出
 * `{ __brand: 'ChannelId' }` 来伪造。
 */
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type ChannelId = Brand<string, 'ChannelId'>;
export type OtaCredentialId = Brand<string, 'OtaCredentialId'>;
/** 渠道侧的门店 ID（携程/美团/抖音各不相同）。我们侧的统一 HotelId 待 rms 接通后引入。 */
export type OtaHotelId = Brand<string, 'OtaHotelId'>;
