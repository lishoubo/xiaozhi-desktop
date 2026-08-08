import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId, toOtaHotelId } from '../../../../src/main/ids';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../../../../src/main/database/application-database';
import { SqliteOtaCredentialRepository } from '../../../../src/main/database/ota-credential-repository';
import { SqliteOtaHotelRepository } from '../../../../src/main/database/ota-hotel-repository';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function input(overrides: Partial<Parameters<SqliteOtaHotelRepository['create']>[0]> = {}) {
  return {
    id: 'hotel-prob-1',
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
let repository: SqliteOtaHotelRepository;
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
  repository = new SqliteOtaHotelRepository(database);
});

describe('SqliteOtaHotelRepository', () => {
  it('创建后可按渠道 + 门店查出同一条记录', () => {
    repository.create(input());

    const found = repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'));
    expect(found?.credentialId).toBe('credential-1');
  });

  it('查询不存在的渠道+门店组合返回 null', () => {
    expect(
      repository.findByChannelAndHotelId(toChannelId('ctrip'), toOtaHotelId('ctrip-1')),
    ).toBeNull();
  });

  it('同一 (channel, otaHotelId) 二次创建违反唯一索引', () => {
    repository.create(input());
    expect(() => repository.create(input({ id: 'hotel-prob-2' }))).toThrow();
  });

  it('findByCredentialId 按凭证查出探测记录，不存在返回 null', () => {
    const created = repository.create(input());

    expect(repository.findByCredentialId(toOtaCredentialId('credential-1'))?.id).toBe(created.id);
    expect(repository.findByCredentialId(toOtaCredentialId('credential-2'))).toBeNull();
  });

  it('updateDiscovery 更新凭证引用和酒店发现事实，记录 id 不变', () => {
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
  });

  it('updateDiscovery 对不存在的记录 id 抛错', () => {
    expect(() =>
      repository.updateDiscovery('missing', {
        credentialId: toOtaCredentialId('credential-2'),
        otaHotelName: null,
        bindExtra: null,
        discoveredAt: 2,
      }),
    ).toThrow('未找到 OtaHotel');
  });

  it('create 正确写入 bindExtra 与 discoveredAt', () => {
    const created = repository.create(
      input({ bindExtra: { merchantGroupId: 'group-1' }, discoveredAt: 1_234 }),
    );

    expect(created.bindExtra).toEqual({ merchantGroupId: 'group-1' });
    expect(created.discoveredAt).toBe(1_234);
  });
});
