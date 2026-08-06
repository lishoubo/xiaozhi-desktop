import {
  toChannelId,
  toOtaCredentialId,
  type ChannelId,
  type OtaCredentialId,
} from '../../domain/identity';
import {
  createOtaCredential,
  type OtaCredential,
  type OtaCredentialCreateInput,
  type OtaCredentialIdentityUpdate,
} from '../../domain/ota-credential';
import type { OtaCredentialRepository } from '../../domain/ports/repositories';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

type OtaCredentialRow = Readonly<{
  id: string;
  channel: string;
  channelAccountId: string | null;
  partitionName: string;
  credentialExtra: string | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

const SELECT_COLUMNS = `
  id,
  channel,
  channel_account_id AS channelAccountId,
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
          (id, channel, channel_account_id, partition_name, credential_extra,
           discovered_at, last_refreshed_at)
         VALUES
          (@id, @channel, @channelAccountId, @partitionName, @credentialExtra,
           @discoveredAt, @lastRefreshedAt)`,
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
             credential_extra = @credentialExtra,
             last_refreshed_at = @lastRefreshedAt,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({
        id,
        channelAccountId: updated.channelAccountId,
        credentialExtra: serializeJsonObject(updated.credentialExtra),
        lastRefreshedAt: updated.lastRefreshedAt,
      });
    if (result.changes !== 1) {
      throw new Error(`更新 OtaCredential 身份失败：credential 不存在 (${id})`);
    }
    return updated;
  }
}
