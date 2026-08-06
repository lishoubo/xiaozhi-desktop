import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../../src/domain/identity';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../../../../src/main/database/application-database';
import { SqliteOtaCredentialRepository } from '../../../../src/main/database/ota-credential-repository';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function input(overrides: Partial<Parameters<SqliteOtaCredentialRepository['create']>[0]> = {}) {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    partitionName: 'persist:xiaozhi:prod:douyin:short-1',
    credentialExtra: null,
    discoveredAt: 1_700_000_000_000,
    lastRefreshedAt: null,
    ...overrides,
  };
}

let database: ApplicationDatabase;
let repository: SqliteOtaCredentialRepository;

beforeEach(() => {
  database = openApplicationDatabase(':memory:', createLogger());
  repository = new SqliteOtaCredentialRepository(database);
});

describe('SqliteOtaCredentialRepository', () => {
  it('创建后可按 ID 和 partitionName 查询并还原 extra', () => {
    const created = repository.create(input({ credentialExtra: { loginId: 'login-1' } }));

    expect(repository.findById(created.id)).toEqual(created);
    expect(repository.findByPartitionName(created.partitionName)).toEqual(created);
  });

  it('查询不存在的 credential 返回 null', () => {
    expect(repository.findById(toOtaCredentialId('missing'))).toBeNull();
    expect(repository.findByPartitionName('persist:xiaozhi:prod:douyin:missing')).toBeNull();
  });

  it('拒绝重复 partitionName', () => {
    repository.create(input());
    expect(() => repository.create(input({ id: toOtaCredentialId('credential-2') }))).toThrow();
  });
});
