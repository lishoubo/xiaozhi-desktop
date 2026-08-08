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

function input(overrides: Partial<Parameters<SqliteOtaHotelRepository['save']>[0]> = {}) {
  return {
    id: 'ota-hotel-1',
    credentialId: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    otaHotelId: toOtaHotelId('dy-111'),
    otaHotelName: null,
    bindExtra: null,
    ...overrides,
  };
}

function countRows(database: ApplicationDatabase): number {
  return database.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM ota_hotel').get()?.n ?? -1;
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
  it('保存后可按渠道 + 门店查出同一条记录', () => {
    repository.save(input());

    const found = repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-111'));
    expect(found?.credentialId).toBe('credential-1');
  });

  it('查询不存在的渠道+门店组合返回 null', () => {
    expect(
      repository.findByChannelAndHotelId(toChannelId('ctrip'), toOtaHotelId('ctrip-1')),
    ).toBeNull();
  });

  it('同一 (channel, otaHotelId) 二次保存走 upsert，不抛错且记录 id 不变', () => {
    const created = repository.save(input());
    const again = repository.save(input({ id: 'ignored-id' }));

    expect(again.id).toBe(created.id);
    expect(countRows(database)).toBe(1);
  });

  it('同一酒店由不同凭证保存时改指新凭证并刷新酒店信息', () => {
    const created = repository.save(input({ otaHotelName: '旧名', bindExtra: null }));

    const updated = repository.save(
      input({
        id: 'ignored-id',
        credentialId: toOtaCredentialId('credential-2'),
        otaHotelName: '新酒店名',
        bindExtra: { merchantGroupId: 'group-2' },
      }),
    );

    expect(updated.id).toBe(created.id);
    expect(updated.otaHotelId).toBe(created.otaHotelId);
    expect(updated.credentialId).toBe('credential-2');
    expect(updated.otaHotelName).toBe('新酒店名');
    expect(updated.bindExtra).toEqual({ merchantGroupId: 'group-2' });
    expect(countRows(database)).toBe(1);
  });

  it('同一凭证保存两家不同酒店时两条记录并存', () => {
    repository.save(input());
    repository.save(input({ id: 'ota-hotel-2', otaHotelId: toOtaHotelId('dy-222') }));

    expect(countRows(database)).toBe(2);
    expect(
      repository.findByChannelAndHotelId(toChannelId('douyin'), toOtaHotelId('dy-222'))
        ?.credentialId,
    ).toBe('credential-1');
  });

  it('save 正确写入 bindExtra，且记录不含绑定关系字段', () => {
    const created = repository.save(input({ bindExtra: { merchantGroupId: 'group-1' } }));

    expect(created.bindExtra).toEqual({ merchantGroupId: 'group-1' });
    expect(created).not.toHaveProperty('discoveredAt');
    expect(created).not.toHaveProperty('boundAt');
    expect(created).not.toHaveProperty('rmsHotelId');
  });
});
