import { z } from 'zod';

/**
 * 有新版本，但本平台不能自动更新，需要用户手动下载。
 *
 * 只发给非 Windows 平台。Windows 走 Squirrel 静默更新，下载完只推一条无 payload
 * 的"已就绪"通知（见 `IPC_CHANNELS.updater.updateReady`）。
 */
export const manualUpdateSchema = z.strictObject({
  latestVersion: z.string().min(1),
  /** `null` 表示名单里没配下载地址，界面只提示版本号、不给跳转入口。 */
  downloadUrl: z.string().nullable(),
});

export type ManualUpdate = Readonly<z.infer<typeof manualUpdateSchema>>;
