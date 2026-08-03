/**
 * 领域标识 —— branded type + 带校验的转换函数。
 *
 * 用 `unique symbol` 而非字符串字面量做 brand，别处写不出
 * `{ __brand: 'ChannelId' }` 来伪造。
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type ChannelId = Brand<string, 'ChannelId'>;
export type OtaAccountId = Brand<string, 'OtaAccountId'>;
/** 渠道侧的门店 ID（携程/美团/抖音各不相同）。我们侧的统一 HotelId 待 rms 接通后引入。 */
export type OtaHotelId = Brand<string, 'OtaHotelId'>;
/** 一份渠道登录态 = 一个 partition。多个 OtaAccount 可共享同一份凭证。 */
export type CredentialId = Brand<string, 'CredentialId'>;
export type AppUserId = Brand<string, 'AppUserId'>;
export type TabId = Brand<string, 'TabId'>;

export class InvalidIdentifierError extends Error {
  constructor(kind: string, raw: string, reason: string) {
    super(`无效的 ${kind}：${reason}`);
    this.name = 'InvalidIdentifierError';
    this.kind = kind;
    this.raw = raw;
  }

  readonly kind: string;
  readonly raw: string;
}

/**
 * 标识符会被拼进 partition 字符串和磁盘路径，而 **partition 一旦生成就永远不删**
 * （登录态最贵，磁盘最便宜）。所以一个没校验的空串会在用户磁盘上留下永久的坏目录。
 *
 * 一律小写：大小写混用会在 macOS（文件系统大小写不敏感）通过、在 Linux 失败。
 */
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_IDENTIFIER_LENGTH = 64;

function assertValidIdentifier(kind: string, raw: string): void {
  if (raw.length === 0) throw new InvalidIdentifierError(kind, raw, '不能为空');
  if (raw.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidIdentifierError(kind, raw, `长度不能超过 ${MAX_IDENTIFIER_LENGTH}`);
  }
  if (!IDENTIFIER_PATTERN.test(raw)) {
    throw new InvalidIdentifierError(
      kind,
      raw,
      '只允许小写字母、数字与连字符，且需以字母或数字开头',
    );
  }
}

export function toChannelId(raw: string): ChannelId {
  assertValidIdentifier('ChannelId', raw);
  return raw as ChannelId;
}

export function toOtaAccountId(raw: string): OtaAccountId {
  assertValidIdentifier('OtaAccountId', raw);
  return raw as OtaAccountId;
}

export function toOtaHotelId(raw: string): OtaHotelId {
  assertValidIdentifier('OtaHotelId', raw);
  return raw as OtaHotelId;
}

export function toCredentialId(raw: string): CredentialId {
  assertValidIdentifier('CredentialId', raw);
  return raw as CredentialId;
}

export function toAppUserId(raw: string): AppUserId {
  assertValidIdentifier('AppUserId', raw);
  return raw as AppUserId;
}

export function toTabId(raw: string): TabId {
  assertValidIdentifier('TabId', raw);
  return raw as TabId;
}

/** 用于不可信输入（manifest JSON、IPC 入参）：失败返回 null 而非抛错。 */
export function parseChannelId(raw: unknown): ChannelId | null {
  if (typeof raw !== 'string') return null;
  try {
    return toChannelId(raw);
  } catch {
    return null;
  }
}

/**
 * 一个浏览器上下文的定位键 —— 业务层一律用它，不用 partition 字符串。
 *
 * 按 **业务身份** 切：一个渠道账号一份独立存储。`OtaCredential`（登录态的来源
 * 与有效性）是另一个维度，不参与这里 —— cookie 怎么拿到的不该影响业务如何隔离。
 */
export type BrowserContextKey = Readonly<{
  environment: 'prod' | 'dev';
  channel: ChannelId;
  otaAccountId: OtaAccountId;
}>;
