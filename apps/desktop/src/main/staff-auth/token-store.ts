/**
 * 员工登录凭证的本地持久化——`<userData>/staff-auth.json`。
 *
 * 内容用 `safeStorage` 加密后再写盘：access token 有 8 小时有效期，明文落盘
 * 等于把一个可直接调用 RMS 的凭证摆在磁盘上。
 *
 * 为什么不进 SQLite：`main/database/` 存的是业务数据，凭证混进去会让"清空业务库"
 * 这类操作意外牵连登录态。与 `main/file-store/` 同理——介质是纯文件，只是这份
 * 多了一层加密，且只服务 staff-auth 一个模块，所以就近放在这里。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { AppLogger } from '../../shared/logging';

const STAFF_AUTH_FILENAME = 'staff-auth.json';

export type StoredStaffTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  /** epoch ms，由 `accessExpiresInSeconds` 换算，避免每次都重新推算 */
  accessExpiresAt: number;
  refreshExpiresAt: number;
}>;

export interface StaffTokenStore {
  read(): Promise<StoredStaffTokens | null>;
  write(tokens: StoredStaffTokens): Promise<void>;
  clear(): Promise<void>;
}

export type StaffTokenStoreDependencies = Readonly<{
  userDataDir: string;
  logger: AppLogger;
  /** 便于在没有 Electron 运行时的场景替换；默认用真的 safeStorage。 */
  encryption?: Readonly<{
    isEncryptionAvailable: () => boolean;
    encryptString: (plainText: string) => Buffer;
    decryptString: (encrypted: Buffer) => string;
  }>;
}>;

function isStoredStaffTokens(value: unknown): value is StoredStaffTokens {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.accessExpiresAt === 'number' &&
    typeof candidate.refreshExpiresAt === 'number'
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createStaffTokenStore(deps: StaffTokenStoreDependencies): StaffTokenStore {
  const { userDataDir, logger } = deps;
  const encryption = deps.encryption ?? safeStorage;
  const filePath = path.join(userDataDir, STAFF_AUTH_FILENAME);

  const removeFile = async (): Promise<void> => {
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  };

  return {
    read: async () => {
      if (!encryption.isEncryptionAvailable()) return null;

      let encrypted: Buffer;
      try {
        encrypted = await fs.readFile(filePath);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(encryption.decryptString(encrypted));
      } catch {
        // 换了机器、换了 keychain，或文件被改坏——一律当作"没有登录态"，
        // 顺手删掉这份读不出来的文件，避免每次启动都失败一次。
        logger.warn('Stored staff credentials could not be decrypted; discarding them');
        await removeFile();
        return null;
      }

      if (!isStoredStaffTokens(parsed)) {
        logger.warn('Stored staff credentials had an unexpected shape; discarding them');
        await removeFile();
        return null;
      }
      return parsed;
    },

    write: async (tokens) => {
      if (!encryption.isEncryptionAvailable()) {
        // 刻意不降级为明文：后果只是下次启动要重新登录，可以接受；
        // 明文落盘不可以。
        logger.warn('Encrypted storage is unavailable; staff credentials will not persist');
        return;
      }
      await fs.mkdir(userDataDir, { recursive: true });
      await fs.writeFile(filePath, encryption.encryptString(JSON.stringify(tokens)));
    },

    clear: removeFile,
  };
}
