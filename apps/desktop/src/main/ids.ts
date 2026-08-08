/**
 * 标识符的构造与校验。类型定义在 `shared/types/ids.ts`（跨进程数据形状要用到），
 * 这里只放会抛异常的构造函数 —— 它们是主进程边界的守卫，渲染进程不该调用。
 */
import type { ChannelId, OtaCredentialId, OtaHotelId } from '../shared/types/ids';

export type { ChannelId, OtaCredentialId, OtaHotelId };

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

export function toOtaCredentialId(raw: string): OtaCredentialId {
  assertValidIdentifier('OtaCredentialId', raw);
  return raw as OtaCredentialId;
}

/**
 * OtaHotelId 是**外部系统的 ID**（携程/抖音/美团各自的门店编号），只被存储与比较，
 * **不参与 partition 名与磁盘路径的拼接**（`toPartitionName` 只吃 environment /
 * channel / shortId）。因此这里不套用上面那条为路径安全而设的小写字符集规则——
 * 那条规则会拒绝合法的外部 ID（如携程的 `SHYQ-310042`），而拒绝的时机在
 * `confirmBinding` 里是**远端已绑定成功之后**，会把用户卡死在「绑定失败→重试→
 * 远端说已存在活跃绑定」的死循环里。
 *
 * 仍然校验非空与长度上限：空串会静默污染 `(channel, ota_hotel_id)` 唯一键，
 * 超长值则是明显的解析出错而非真实 ID。
 */
const MAX_OTA_HOTEL_ID_LENGTH = 128;

export function toOtaHotelId(raw: string): OtaHotelId {
  if (raw.length === 0) throw new InvalidIdentifierError('OtaHotelId', raw, '不能为空');
  if (raw.length > MAX_OTA_HOTEL_ID_LENGTH) {
    throw new InvalidIdentifierError('OtaHotelId', raw, `长度不能超过 ${MAX_OTA_HOTEL_ID_LENGTH}`);
  }
  return raw as OtaHotelId;
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
