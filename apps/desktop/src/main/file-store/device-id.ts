/**
 * 设备标识 —— `<userData>/device-id.json`。
 *
 * 随认证请求发给 rms-server（`X-Device-Id`），用于服务端 `login_log` 的登录指纹记录。
 *
 * ## 为什么明文存
 *
 * 它既不是凭证也不含用户身份信息，只是一个随机 uuid：拿到它换不出任何东西，也认不出
 * 是谁。与 `staff-auth/token-store.ts` 的取舍不同——那里存的是可直接调用 RMS 的
 * access token，必须 safeStorage 加密；这里加密只会换来"safeStorage 不可用时怎么办"
 * 的降级复杂度，收益为零。
 *
 * ## 为什么不进 SQLite
 *
 * 同 token-store 的理由：`main/database/` 存的是业务数据，"清空业务库"这类操作不应
 * 意外牵连设备标识——那会让同一台机器在服务端日志里变成一台新设备。
 *
 * ## 失败一律不抛
 *
 * 这两个请求头**不带也能登录**（服务端存 null），所以读写失败绝不能阻断登录：
 * 一次磁盘故障不该让用户登不进来。失败时返回一个一次性 uuid 并记 warn——本次进程
 * 内仍是稳定值，只是跨重启会变，退化成"指纹不连续"而不是"登录失败"。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppLogger } from '../../shared/logging';

const DEVICE_ID_FILENAME = 'device-id.json';

type StoredDeviceId = Readonly<{ deviceId: string }>;

function filePath(userDataDir: string): string {
  return path.join(userDataDir, DEVICE_ID_FILENAME);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function parseDeviceId(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = (parsed as Partial<StoredDeviceId>).deviceId;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * 读取设备标识；不存在或内容损坏时生成一个并落盘。
 *
 * 返回值在同一台机器上跨重启稳定，且与登录用户无关——换账号登录不改变它。
 */
export async function readOrCreateDeviceId(
  userDataDir: string,
  logger: AppLogger,
): Promise<string> {
  try {
    const raw = await fs.readFile(filePath(userDataDir), 'utf8');
    const existing = parseDeviceId(raw);
    if (existing) return existing;
    // 内容损坏：当作没有，重新生成一个覆盖掉，下次启动即自愈。
    logger.warn('Device id file was malformed and will be regenerated');
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      logger.warn('Device id could not be read; falling back to an ephemeral identifier');
      return randomUUID();
    }
  }

  const deviceId = randomUUID();
  try {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      filePath(userDataDir),
      JSON.stringify({ deviceId } satisfies StoredDeviceId),
      'utf8',
    );
  } catch {
    // 写不进去也照常返回：本次进程仍有稳定值，只是跨重启不连续。
    logger.warn('Device id could not be persisted; it will not survive a restart');
  }
  return deviceId;
}
