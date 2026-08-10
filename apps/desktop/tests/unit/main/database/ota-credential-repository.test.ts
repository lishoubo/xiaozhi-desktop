import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../../src/main/ids';
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
    channelAccountId: null,
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
    const created = repository.create(
      input({ channelAccountId: 'account-1', credentialExtra: { loginId: 'login-1' } }),
    );

    expect(repository.findById(created.id)).toEqual(created);
    expect(repository.findByPartitionName(created.partitionName)).toEqual(created);
    expect(repository.findByChannelAndAccountId(created.channel, 'account-1')).toEqual(created);
  });

  it('查询不存在的 credential 返回 null', () => {
    expect(repository.findById(toOtaCredentialId('missing'))).toBeNull();
    expect(repository.findByPartitionName('persist:xiaozhi:prod:douyin:missing')).toBeNull();
    expect(repository.findByChannelAndAccountId(toChannelId('douyin'), 'missing')).toBeNull();
  });

  it('按渠道列出全部 credential，不要求存在关联账号', () => {
    const older = repository.create(input());
    const newer = repository.create(
      input({
        id: toOtaCredentialId('credential-2'),
        partitionName: 'persist:xiaozhi:prod:douyin:short-2',
        discoveredAt: older.discoveredAt + 1,
      }),
    );
    repository.create(
      input({
        id: toOtaCredentialId('credential-3'),
        channel: toChannelId('ctrip'),
        partitionName: 'persist:xiaozhi:prod:ctrip:short-3',
      }),
    );

    expect(repository.listByChannel(toChannelId('douyin'))).toEqual([newer, older]);
  });

  it('拒绝重复 partitionName', () => {
    repository.create(input());
    expect(() => repository.create(input({ id: toOtaCredentialId('credential-2') }))).toThrow();
  });

  it('只更新渠道账号身份，不改变渠道和 partition', () => {
    const created = repository.create(input());

    const updated = repository.updateIdentity(created.id, {
      channelAccountId: 'account-2',
      credentialExtra: { partnerId: 'partner-1' },
      lastRefreshedAt: 1_700_000_000_100,
    });

    expect(updated).toEqual({
      ...created,
      channelAccountId: 'account-2',
      credentialExtra: { partnerId: 'partner-1' },
      lastRefreshedAt: 1_700_000_000_100,
    });
    expect(repository.findById(created.id)).toEqual(updated);
  });

  it('重复渠道身份刷新时保留 credential ID 并替换 partition', () => {
    const created = repository.create(
      input({ channelAccountId: 'account-2', credentialExtra: { login: 'old-login' } }),
    );

    const updated = repository.updatePartitionAndIdentity(created.id, {
      partitionName: 'persist:xiaozhi:prod:douyin:short-2',
      channelAccountId: 'account-2',
      credentialExtra: { login: 'new-login' },
      lastRefreshedAt: 1_700_000_000_100,
    });

    expect(updated).toEqual({
      ...created,
      partitionName: 'persist:xiaozhi:prod:douyin:short-2',
      credentialExtra: { login: 'new-login' },
      lastRefreshedAt: 1_700_000_000_100,
    });
    expect(repository.findById(created.id)).toEqual(updated);
    expect(repository.findByPartitionName(created.partitionName)).toBeNull();
  });

  it('拒绝写入空白渠道账号 ID，并保留原记录', () => {
    const created = repository.create(input());

    expect(() =>
      repository.updateIdentity(created.id, {
        channelAccountId: ' ',
        credentialExtra: { partnerId: 'partner-1' },
        lastRefreshedAt: 1_700_000_000_100,
      }),
    ).toThrow();
    expect(repository.findById(created.id)).toEqual(created);
  });
});
