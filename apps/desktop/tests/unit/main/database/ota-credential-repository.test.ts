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
    channelAccountName: null,
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

  /**
   * `channel_account_name` 是 migration 8 加的顶层列。历史记录不回填，所以读取方
   * 必须容忍 null——上面的 `input()` 默认就是 null，这里只补「有值时能存能取」。
   */
  it('渠道账号名能往返存取，更新时可以从 null 补上', () => {
    const created = repository.create(
      input({ channelAccountId: 'account-1', channelAccountName: '银际酒店(包头市青山店)' }),
    );

    expect(created.channelAccountName).toBe('银际酒店(包头市青山店)');
    expect(repository.findById(created.id)?.channelAccountName).toBe('银际酒店(包头市青山店)');

    // 老记录（name 为 null）在下次探测时被补上——不回填历史数据的前提下，这是名字
    // 唯一的补齐途径。
    const legacy = repository.create(
      input({
        id: toOtaCredentialId('credential-legacy'),
        partitionName: 'persist:xiaozhi:prod:douyin:legacy',
        channelAccountId: 'account-legacy',
      }),
    );
    expect(legacy.channelAccountName).toBeNull();

    const refreshed = repository.updateIdentity(legacy.id, {
      channelAccountId: 'account-legacy',
      channelAccountName: 'Btphhldxm',
      credentialExtra: { login: 'Btphhldxm' },
      lastRefreshedAt: 1_700_000_000_100,
    });
    expect(refreshed.channelAccountName).toBe('Btphhldxm');
    expect(repository.findById(legacy.id)?.channelAccountName).toBe('Btphhldxm');
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
      channelAccountName: null,
      credentialExtra: { partnerId: 'partner-1' },
      lastRefreshedAt: 1_700_000_000_100,
    });


    expect(updated).toEqual({
      ...created,
      channelAccountId: 'account-2',
      channelAccountName: null,
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
      channelAccountName: null,
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

  it('删除 credential 时一并清掉它名下的 ota_hotel 行', () => {
    const created = repository.create(input());
    database
      .prepare(
        `INSERT INTO ota_hotel (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('hotel-1', created.id, 'douyin', '99887766', '测试酒店', null);

    repository.deleteById(created.id);

    expect(repository.findById(created.id)).toBeNull();
    expect(
      database
        .prepare<[string], { count: number }>(
          'SELECT COUNT(*) AS count FROM ota_hotel WHERE credential_id = ?',
        )
        .get(created.id)?.count,
    ).toBe(0);
  });

  /**
   * `ota_hotel.credential_id` 是 `ON DELETE RESTRICT`：不先清门店行就根本删不掉
   * credential。这条锁住「顺序不能反」——反了会抛外键错，留下半截状态。
   */
  it('顺序正确：先门店后 credential，不被 RESTRICT 外键挡下', () => {
    const created = repository.create(input());
    database
      .prepare(
        `INSERT INTO ota_hotel (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('hotel-1', created.id, 'douyin', '99887766', '测试酒店', null);

    expect(() => repository.deleteById(created.id)).not.toThrow();
  });

  it('删除后该 partition 可以被另一条 credential 重新占用', () => {
    const first = repository.create(input());
    repository.deleteById(first.id);

    // UNIQUE 约束下这一步在删除前会失败；删干净了才腾得出位置。
    const second = repository.create(
      input({ id: toOtaCredentialId('credential-2'), channelAccountId: 'account-2' }),
    );

    expect(second.partitionName).toBe(first.partitionName);
    expect(repository.findByPartitionName(first.partitionName)?.id).toBe(second.id);
  });

  it('拒绝写入空白渠道账号 ID，并保留原记录', () => {
    const created = repository.create(input());

    expect(() =>
      repository.updateIdentity(created.id, {
        channelAccountId: ' ',
        channelAccountName: null,
        credentialExtra: { partnerId: 'partner-1' },
        lastRefreshedAt: 1_700_000_000_100,
      }),
    ).toThrow();
    expect(repository.findById(created.id)).toEqual(created);
  });
});
