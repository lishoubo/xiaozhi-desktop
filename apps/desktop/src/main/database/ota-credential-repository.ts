import { toChannelId, toOtaCredentialId, type ChannelId, type OtaCredentialId } from '../ids';
import {
  createOtaCredential,
  type OtaCredential,
  type OtaCredentialCreateInput,
  type OtaCredentialIdentityUpdate,
  type OtaCredentialPartitionUpdate,
} from '../../shared/types/ota-credential';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

/**
 * 登录凭据的持久化能力。接口与实现同文件：service 只 import 这个类型，
 * eslint 已禁止它们 import 下面的实现类，不需要把接口单独放远处。
 */
export interface OtaCredentialRepository {
  create(input: OtaCredentialCreateInput): OtaCredential;
  listByChannel(channel: ChannelId): readonly OtaCredential[];
  findById(id: OtaCredentialId): OtaCredential | null;
  findByPartitionName(partitionName: string): OtaCredential | null;
  findByChannelAndAccountId(channel: ChannelId, channelAccountId: string): OtaCredential | null;
  updateIdentity(id: OtaCredentialId, update: OtaCredentialIdentityUpdate): OtaCredential;
  updatePartitionAndIdentity(
    id: OtaCredentialId,
    update: OtaCredentialPartitionUpdate,
  ): OtaCredential;
  /**
   * 删除一条 credential，连同它名下的 `ota_hotel` 行。
   *
   * 用在「同一个 partition 里换了账号」：新账号接管了这份登录态，被顶替的旧账号
   * 就**没有任何可用的登录态了**（`partition_name` 有 UNIQUE 约束，一份 partition
   * 只能属于一条 credential）。留着它不是「暂时闲置」——`listByChannel` 会把它继续
   * 摆进账号切换、新增绑定、重新登录三个列表，用户点中就拿着一个不属于自己的
   * partition 去开标签页，开出来是**新账号**的页面。这是持续的错误选项，不是临时状态。
   *
   * 为什么 `ota_hotel` 跟着删：那张表**不记绑定关系**（绑定关系由远端 RMS 持有，
   * 本地不表达，见 `shared/types/ota-hotel.ts`），存的是门店信息 + 渠道上下文，
   * 唯一读取处是 `HotelManagementService` 里「远端这条绑定是哪个 credential 建的」
   * 反查，且该反查优先走远端 `bindExtra`、查不到只是少一个展示标注、不阻断流程。
   * credential 都没了，指向它的门店行也失去意义。何况 `ota_hotel.credential_id`
   * 是 `ON DELETE RESTRICT`，不先删它就根本删不掉 credential。
   */
  deleteById(id: OtaCredentialId): void;
}

type OtaCredentialRow = Readonly<{
  id: string;
  channel: string;
  channelAccountId: string | null;
  channelAccountName: string | null;
  partitionName: string;
  credentialExtra: string | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

const SELECT_COLUMNS = `
  id,
  channel,
  channel_account_id AS channelAccountId,
  channel_account_name AS channelAccountName,
  partition_name AS partitionName,
  credential_extra AS credentialExtra,
  discovered_at AS discoveredAt,
  last_refreshed_at AS lastRefreshedAt
`;

function credentialFromRow(row: OtaCredentialRow): OtaCredential {
  return createOtaCredential({
    id: toOtaCredentialId(row.id),
    channel: toChannelId(row.channel),
    channelAccountId: row.channelAccountId,
    channelAccountName: row.channelAccountName,
    partitionName: row.partitionName,
    credentialExtra: parseJsonObject(row.credentialExtra, 'credentialExtra'),
    discoveredAt: row.discoveredAt,
    lastRefreshedAt: row.lastRefreshedAt,
  });
}

export class SqliteOtaCredentialRepository implements OtaCredentialRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  create(input: OtaCredentialCreateInput): OtaCredential {
    const credential = createOtaCredential(input);
    this.database
      .prepare(
        `INSERT INTO ota_credential
          (id, channel, channel_account_id, channel_account_name, partition_name,
           credential_extra, discovered_at, last_refreshed_at)
         VALUES
          (@id, @channel, @channelAccountId, @channelAccountName, @partitionName,
           @credentialExtra, @discoveredAt, @lastRefreshedAt)`,
      )
      .run({
        ...credential,
        credentialExtra: serializeJsonObject(credential.credentialExtra),
      });
    return credential;
  }

  listByChannel(channel: ChannelId): readonly OtaCredential[] {
    return this.database
      .prepare<[string], OtaCredentialRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM ota_credential
         WHERE channel = ?
         ORDER BY discovered_at DESC`,
      )
      .all(channel)
      .map(credentialFromRow);
  }

  findById(id: OtaCredentialId): OtaCredential | null {
    const row = this.database
      .prepare<[string], OtaCredentialRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_credential WHERE id = ?`,
      )
      .get(id);
    return row ? credentialFromRow(row) : null;
  }

  findByPartitionName(partitionName: string): OtaCredential | null {
    const row = this.database
      .prepare<[string], OtaCredentialRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_credential WHERE partition_name = ?`,
      )
      .get(partitionName);
    return row ? credentialFromRow(row) : null;
  }

  findByChannelAndAccountId(channel: ChannelId, channelAccountId: string): OtaCredential | null {
    const row = this.database
      .prepare<[string, string], OtaCredentialRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM ota_credential
         WHERE channel = ? AND channel_account_id = ?
         ORDER BY discovered_at DESC
         LIMIT 1`,
      )
      .get(channel, channelAccountId);
    return row ? credentialFromRow(row) : null;
  }

  updateIdentity(id: OtaCredentialId, update: OtaCredentialIdentityUpdate): OtaCredential {
    const existing = this.findById(id);
    if (!existing) {
      throw new Error(`更新 OtaCredential 身份失败：credential 不存在 (${id})`);
    }
    const updated = createOtaCredential({ ...existing, ...update });
    const result = this.database
      .prepare(
        `UPDATE ota_credential
         SET channel_account_id = @channelAccountId,
             channel_account_name = @channelAccountName,
             credential_extra = @credentialExtra,
             last_refreshed_at = @lastRefreshedAt,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({
        id,
        channelAccountId: updated.channelAccountId,
        channelAccountName: updated.channelAccountName,
        credentialExtra: serializeJsonObject(updated.credentialExtra),
        lastRefreshedAt: updated.lastRefreshedAt,
      });
    if (result.changes !== 1) {
      throw new Error(`更新 OtaCredential 身份失败：credential 不存在 (${id})`);
    }
    return updated;
  }

  deleteById(id: OtaCredentialId): void {
    // 一个事务：酒店缓存必须先走，否则 ON DELETE RESTRICT 会挡下 credential 的删除，
    // 留下「缓存没了、credential 还在」的半截状态。
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM ota_hotel WHERE credential_id = ?').run(id);
      this.database.prepare('DELETE FROM ota_credential WHERE id = ?').run(id);
    })();
  }

  updatePartitionAndIdentity(
    id: OtaCredentialId,
    update: OtaCredentialPartitionUpdate,
  ): OtaCredential {
    const existing = this.findById(id);
    if (!existing) {
      throw new Error(`更新 OtaCredential 登录态失败：credential 不存在 (${id})`);
    }
    const updated = createOtaCredential({ ...existing, ...update });
    const result = this.database
      .prepare(
        `UPDATE ota_credential
         SET partition_name = @partitionName,
             channel_account_id = @channelAccountId,
             channel_account_name = @channelAccountName,
             credential_extra = @credentialExtra,
             last_refreshed_at = @lastRefreshedAt,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({
        id,
        partitionName: updated.partitionName,
        channelAccountId: updated.channelAccountId,
        channelAccountName: updated.channelAccountName,
        credentialExtra: serializeJsonObject(updated.credentialExtra),
        lastRefreshedAt: updated.lastRefreshedAt,
      });
    if (result.changes !== 1) {
      throw new Error(`更新 OtaCredential 登录态失败：credential 不存在 (${id})`);
    }
    return updated;
  }
}
