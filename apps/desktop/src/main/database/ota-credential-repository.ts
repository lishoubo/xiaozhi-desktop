import { toChannelId, toOtaCredentialId, type OtaCredentialId } from '../../domain/identity';
import {
  createOtaCredential,
  type OtaCredential,
  type OtaCredentialCreateInput,
} from '../../domain/ota-credential';
import type { OtaCredentialRepository } from '../../domain/ports/repositories';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

type OtaCredentialRow = Readonly<{
  id: string;
  channel: string;
  partitionName: string;
  credentialExtra: string | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

const SELECT_COLUMNS = `
  id,
  channel,
  partition_name AS partitionName,
  credential_extra AS credentialExtra,
  discovered_at AS discoveredAt,
  last_refreshed_at AS lastRefreshedAt
`;

function credentialFromRow(row: OtaCredentialRow): OtaCredential {
  return createOtaCredential({
    id: toOtaCredentialId(row.id),
    channel: toChannelId(row.channel),
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
          (id, channel, partition_name, credential_extra, discovered_at, last_refreshed_at)
         VALUES
          (@id, @channel, @partitionName, @credentialExtra, @discoveredAt, @lastRefreshedAt)`,
      )
      .run({
        ...credential,
        credentialExtra: serializeJsonObject(credential.credentialExtra),
      });
    return credential;
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
}
