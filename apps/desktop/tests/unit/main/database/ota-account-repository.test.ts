import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  toChannelId,
  toOtaAccountId,
  toOtaCredentialId,
  toOtaHotelId,
} from '../../../../src/domain/identity';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../../../../src/main/database/application-database';
import { SqliteOtaAccountRepository } from '../../../../src/main/database/ota-account-repository';
import { SqliteOtaCredentialRepository } from '../../../../src/main/database/ota-credential-repository';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function input(overrides: Partial<Parameters<SqliteOtaAccountRepository['create']>[0]> = {}) {
  return {
    id: toOtaAccountId('account-1'),
    credentialId: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    otaHotelId: toOtaHotelId('dy-111'),
    otaHotelName: null,
    bindExtra: null,
    discoveredAt: 1_700_000_000_000,
    ...overrides,
  };
}

let database: ApplicationDatabase;
let repository: SqliteOtaAccountRepository;
let credentialRepository: SqliteOtaCredentialRepository;

beforeEach(() => {
  database = openApplicationDatabase(':memory:', createLogger());
  credentialRepository = new SqliteOtaCredentialRepository(database);
  credentialRepository.create({
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    channelAccountId: null,
    partitionName: 'persist:xiaozhi:prod:douyin:short-1',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
  });
  credentialRepository.create({
    id: toOtaCredentialId('credential-2'),
    channel: toChannelId('douyin'),
    channelAccountId: null,
    partitionName: 'persist:xiaozhi:prod:douyin:short-2',
    credentialExtra: null,
    discoveredAt: 2,
    lastRefreshedAt: null,
  });
  repository = new SqliteOtaAccountRepository(database);
});

describe('SqliteOtaAccountRepository', () => {
  it('创建后可按渠道 + 门店查出同一条记录', () => {
    repository.create(input());

    const found = repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'));
    expect(found?.credentialId).toBe('credential-1');
    expect(found).not.toHaveProperty('partitionName');
  });

  it('查询不存在的渠道+门店组合返回 null', () => {
    expect(
      repository.findByChannelAndHotelId(toChannelId('ctrip'), toOtaHotelId('ctrip-1')),
    ).toBeNull();
  });

  it('多个账号并存，互不影响——同渠道不同门店、同门店不同渠道', () => {
    repository.create(
      input({ id: toOtaAccountId('account-1'), otaHotelId: toOtaHotelId('dy-111') }),
    );
    repository.create(
      input({ id: toOtaAccountId('account-2'), otaHotelId: toOtaHotelId('dy-222') }),
    );
    repository.create(
      input({
        id: toOtaAccountId('account-3'),
        credentialId: toOtaCredentialId('credential-1'),
        channel: toChannelId('ctrip'),
        otaHotelId: toOtaHotelId('dy-111'),
      }),
    );

    expect(
      repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'))?.id,
    ).toBe('account-1');
    expect(
      repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-222'))?.id,
    ).toBe('account-2');
    expect(
      repository.findByChannelAndHotelId(toChannelId('ctrip'), toOtaHotelId('dy-111'))?.id,
    ).toBe('account-3');
  });

  it('同一 (channel, otaHotelId) 二次创建违反唯一索引', () => {
    repository.create(input());
    expect(() => repository.create(input({ id: toOtaAccountId('account-2') }))).toThrow();
  });

  it('查重命中：updateDiscovery 更新登录态引用和酒店发现事实，账号 id 不变', () => {
    const created = repository.create(input());

    const updated = repository.updateDiscovery(created.id, {
      credentialId: toOtaCredentialId('credential-2'),
      otaHotelName: '新酒店名',
      bindExtra: { merchantGroupId: 'group-2' },
      discoveredAt: 2_000,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.otaHotelId).toBe(created.otaHotelId);
    expect(updated.credentialId).toBe('credential-2');
    expect(updated.otaHotelName).toBe('新酒店名');
    expect(updated.bindExtra).toEqual({ merchantGroupId: 'group-2' });
    expect(updated.discoveredAt).toBe(2_000);
    expect(
      repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'))
        ?.credentialId,
    ).toBe('credential-2');
  });

  it('updateDiscovery 对不存在的账号 id 抛错', () => {
    expect(() =>
      repository.updateDiscovery(toOtaAccountId('missing'), {
        credentialId: toOtaCredentialId('credential-2'),
        otaHotelName: null,
        bindExtra: null,
        discoveredAt: 2,
      }),
    ).toThrow('未找到 OtaAccount');
  });

  it('create 正确写入 bindExtra 与 discoveredAt', () => {
    const created = repository.create(
      input({ bindExtra: { merchantGroupId: 'group-1' }, discoveredAt: 1_234 }),
    );

    expect(created.bindExtra).toEqual({ merchantGroupId: 'group-1' });
    expect(created.discoveredAt).toBe(1_234);
  });

  it('listByChannel 按 discoveredAt 降序返回，且跨渠道过滤', () => {
    repository.create(
      input({
        id: toOtaAccountId('account-1'),
        otaHotelId: toOtaHotelId('dy-111'),
        discoveredAt: 100,
      }),
    );
    repository.create(
      input({
        id: toOtaAccountId('account-2'),
        otaHotelId: toOtaHotelId('dy-222'),
        discoveredAt: 300,
      }),
    );
    repository.create(
      input({
        id: toOtaAccountId('account-3'),
        channel: toChannelId('ctrip'),
        otaHotelId: toOtaHotelId('ctrip-1'),
        discoveredAt: 200,
      }),
    );

    const douyinAccounts = repository.listByChannel(toChannelId('douyin'));

    expect(douyinAccounts.map((account) => account.id)).toEqual(['account-2', 'account-1']);
  });

  it('findById 按 id 查出账号，不存在返回 null', () => {
    const created = repository.create(input());

    expect(repository.findById(created.id)?.id).toBe(created.id);
    expect(repository.findById(toOtaAccountId('missing'))).toBeNull();
  });
});
