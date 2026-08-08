import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import { HotelManagementService } from '../../../src/main/services/hotel-management-service';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    channelAccountId: 'account-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
    ...overrides,
  };
}

const HOTEL = {
  otaHotelId: 'dy-111',
  otaHotelName: '测试酒店',
  bindExtra: { merchantGroupId: 'group-1' },
} as const;

function setup(
  overrides: { bind?: ReturnType<typeof vi.fn>; save?: ReturnType<typeof vi.fn> } = {},
) {
  let idCounter = 0;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const otaHotelRepository = { save: overrides.save ?? vi.fn((input) => input) };
  const otaAccountGateway = {
    listOtaAccounts: vi.fn(),
    bind: overrides.bind ?? vi.fn().mockResolvedValue({ id: 7 }),
    unbind: vi.fn(),
  };
  const service = new HotelManagementService({
    hotelGateway: { listHotels: vi.fn(), createHotel: vi.fn(), deleteHotel: vi.fn() },
    otaAccountGateway,
    otaHotelRepository,
    otaCredentialRepository: { findById: vi.fn(() => credential()) },
    readCookieSnapshot: vi.fn().mockResolvedValue([{ domain: 'a.com', name: 'k', value: 'v' }]),
    generateRequestId: () => `id-${++idCounter}`,
    logger,
  });
  return { service, otaHotelRepository, otaAccountGateway, logger };
}

describe('HotelManagementService 绑定流程', () => {
  it('startBinding 只发号——标签页由渲染进程自己开', () => {
    const { service } = setup();

    expect(service.startBinding().requestId).toBe('id-1');
    // 每次发起都是新号，两个并发绑定各自认领各自的候选。
    expect(service.startBinding().requestId).toBe('id-2');
  });

  it('confirmBinding 先写远端、成功后才写本地', async () => {
    const { service, otaHotelRepository, otaAccountGateway } = setup();

    await service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL });

    expect(otaAccountGateway.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        hotelId: 42,
        source: 'douyin',
        otaHotelId: 'dy-111',
        otaHotelName: '测试酒店',
        bindExtra: { merchantGroupId: 'group-1' },
        cookies: [{ domain: 'a.com', name: 'k', value: 'v' }],
      }),
    );
    expect(otaHotelRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential-1',
        channel: 'douyin',
        otaHotelId: 'dy-111',
        otaHotelName: '测试酒店',
        bindExtra: { merchantGroupId: 'group-1' },
      }),
    );
  });

  it('远端绑定失败时不写本地', async () => {
    const { service, otaHotelRepository } = setup({
      bind: vi.fn().mockRejectedValue(new Error('远端炸了')),
    });

    await expect(
      service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL }),
    ).rejects.toThrow('远端炸了');

    expect(otaHotelRepository.save).not.toHaveBeenCalled();
  });

  /**
   * 远端已经绑定成功，本地只是缓存。若把本地失败报成绑定失败，用户一重试远端就会以
   * 「已存在活跃绑定」拒绝——人被卡死在一个其实早已成功的操作上。
   */
  it('本地写入失败不算绑定失败：仍返回远端结果，只记警告', async () => {
    const { service, logger } = setup({
      save: vi.fn(() => {
        throw new Error('磁盘炸了');
      }),
    });

    await expect(
      service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL }),
    ).resolves.toEqual({ id: 7 });

    expect(logger.warn).toHaveBeenCalledWith(
      'OTA hotel saved remotely but not locally',
      expect.objectContaining({ channel: 'douyin' }),
    );
  });

  it('凭据不存在时明确失败，不调远端也不写本地', async () => {
    const otaHotelRepository = { save: vi.fn() };
    const otaAccountGateway = { listOtaAccounts: vi.fn(), bind: vi.fn(), unbind: vi.fn() };
    const service = new HotelManagementService({
      hotelGateway: { listHotels: vi.fn(), createHotel: vi.fn(), deleteHotel: vi.fn() },
      otaAccountGateway,
      otaHotelRepository,
      otaCredentialRepository: { findById: vi.fn(() => null) },
      readCookieSnapshot: vi.fn(),
      generateRequestId: () => 'id',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(
      service.confirmBinding({
        credentialId: 'missing',
        rmsHotelId: 42,
        hotel: HOTEL,
      }),
    ).rejects.toThrow('未找到该登录凭据');

    expect(otaAccountGateway.bind).not.toHaveBeenCalled();
    expect(otaHotelRepository.save).not.toHaveBeenCalled();
  });
});
