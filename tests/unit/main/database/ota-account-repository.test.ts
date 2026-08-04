import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaAccountId, toOtaHotelId } from '../../../../src/domain/identity';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../../../../src/main/database/application-database';
import { SqliteOtaAccountRepository } from '../../../../src/main/database/ota-account-repository';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function input(overrides: Partial<Parameters<SqliteOtaAccountRepository['create']>[0]> = {}) {
  return {
    id: toOtaAccountId('account-1'),
    channel: toChannelId('douyin'),
    otaHotelId: toOtaHotelId('dy-111'),
    otaHotelName: null,
    partitionName: 'persist:xiaozhi:prod:douyin:short-1',
    channelContext: null,
    discoveredAt: 1_700_000_000_000,
    ...overrides,
  };
}

let database: ApplicationDatabase;
let repository: SqliteOtaAccountRepository;

beforeEach(() => {
  database = openApplicationDatabase(':memory:', createLogger());
  repository = new SqliteOtaAccountRepository(database);
});

describe('SqliteOtaAccountRepository', () => {
  it('创建后可按渠道 + 门店查出同一条记录', () => {
    repository.create(input());

    const found = repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'));
    expect(found?.partitionName).toBe('persist:xiaozhi:prod:douyin:short-1');
  });

  it('查询不存在的渠道+门店组合返回 null', () => {
    expect(
      repository.findByChannelAndHotelId(toChannelId('ctrip'), toOtaHotelId('ctrip-1')),
    ).toBeNull();
  });

  it('多个账号并存，互不影响——同渠道不同门店、同门店不同渠道', () => {
    repository.create(input({ id: toOtaAccountId('account-1'), otaHotelId: toOtaHotelId('dy-111') }));
    repository.create(input({ id: toOtaAccountId('account-2'), otaHotelId: toOtaHotelId('dy-222') }));
    repository.create(
      input({
        id: toOtaAccountId('account-3'),
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

  it('查重命中：updatePartitionName 更新登录态指针，账号 id 与门店不变', () => {
    const created = repository.create(input());

    const updated = repository.updatePartitionName(created.id, 'persist:xiaozhi:prod:douyin:short-2');

    expect(updated.id).toBe(created.id);
    expect(updated.otaHotelId).toBe(created.otaHotelId);
    expect(updated.partitionName).toBe('persist:xiaozhi:prod:douyin:short-2');
    expect(
      repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'))
        ?.partitionName,
    ).toBe('persist:xiaozhi:prod:douyin:short-2');
  });

  it('updatePartitionName 对不存在的账号 id 抛错', () => {
    expect(() =>
      repository.updatePartitionName(toOtaAccountId('missing'), 'persist:xiaozhi:prod:douyin:x'),
    ).toThrow('未找到 OtaAccount');
  });

  it('create 正确写入 channelContext 与 discoveredAt', () => {
    const created = repository.create(input({ channelContext: 'group-1', discoveredAt: 1_234 }));

    expect(created.channelContext).toBe('group-1');
    expect(created.discoveredAt).toBe(1_234);
  });

  it('listByChannel 按 discoveredAt 降序返回，且跨渠道过滤', () => {
    repository.create(
      input({ id: toOtaAccountId('account-1'), otaHotelId: toOtaHotelId('dy-111'), discoveredAt: 100 }),
    );
    repository.create(
      input({ id: toOtaAccountId('account-2'), otaHotelId: toOtaHotelId('dy-222'), discoveredAt: 300 }),
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
