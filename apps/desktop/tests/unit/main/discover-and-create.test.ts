import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId, toOtaHotelId } from '../../../src/domain/identity';
import type { OtaCredential } from '../../../src/domain/ota-credential';
import {
  DiscoverAndCreate,
  type DiscoverAndCreateDependencies,
} from '../../../src/main/features/ota-credential/discover-and-create';

const channel = toChannelId('fliggy');
const partitionName = 'persist:xiaozhi:prod:fliggy:aaa';
const ctripChannel = toChannelId('ctrip');
const ctripPartitionName = 'persist:xiaozhi:prod:ctrip:ccc';
const douyinChannel = toChannelId('douyin');
const douyinPartitionName = 'persist:xiaozhi:prod:douyin:ddd';
const meituanChannel = toChannelId('meituan');
const meituanPartitionName = 'persist:xiaozhi:prod:meituan:bbb';

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel,
    channelAccountId: null,
    partitionName,
    credentialExtra: null,
    discoveredAt: 100,
    lastRefreshedAt: null,
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<DiscoverAndCreateDependencies> = {},
): DiscoverAndCreateDependencies {
  const credentialRepository = {
    create: vi.fn((input) => input),
    findById: vi.fn(() => null),
    findByPartitionName: vi.fn(() => null),
    findByChannelAndAccountId: vi.fn(() => null),
    updateIdentity: vi.fn(),
    updatePartitionAndIdentity: vi.fn(),
  };
  return {
    discoverCtrip: vi.fn().mockResolvedValue({ kind: 'none' }),
    discoverDouyin: vi.fn().mockResolvedValue({ kind: 'none' }),
    discoverMeituan: vi.fn().mockResolvedValue({ kind: 'none' }),
    credentialRepository,
    generateCredentialId: vi.fn(() => 'generated-credential-id'),
    removePendingPartition: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as DiscoverAndCreateDependencies;
}

describe('DiscoverAndCreate', () => {
  it('渠道未注册 discovery 时直接跳过', async () => {
    const deps = createDeps();
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never),
    ).resolves.toBeNull();
    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
  });

  it('携程单酒店结果创建带 hotel-dom 临时身份的 credential', async () => {
    const discoverCtrip = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '12345',
        credentialExtra: {
          hotelId: '12345',
          hotelName: '携程测试酒店',
          identitySource: 'hotel-dom',
        },
      },
      hotels: [
        {
          otaHotelId: toOtaHotelId('12345'),
          otaHotelName: '携程测试酒店',
          bindExtra: null,
        },
      ],
    });
    const deps = createDeps({ discoverCtrip });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        ctripPartitionName,
        ctripChannel,
        'https://ebooking.ctrip.com/hotel/12345',
        {} as never,
      ),
    ).resolves.not.toBeNull();

    expect(discoverCtrip).toHaveBeenCalledOnce();
    expect(deps.credentialRepository.create).toHaveBeenCalledWith({
      id: toOtaCredentialId('generated-credential-id'),
      channel: ctripChannel,
      channelAccountId: '12345',
      partitionName: ctripPartitionName,
      credentialExtra: {
        hotelId: '12345',
        hotelName: '携程测试酒店',
        identitySource: 'hotel-dom',
      },
      discoveredAt: expect.any(Number),
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('携程已有 credential 时刷新 hotel-dom 临时身份', async () => {
    const existingCredential = credential({
      channel: ctripChannel,
      partitionName: ctripPartitionName,
    });
    const discoverCtrip = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '12345',
        credentialExtra: {
          hotelId: '12345',
          hotelName: '携程测试酒店',
          identitySource: 'hotel-dom',
        },
      },
      hotels: [
        {
          otaHotelId: toOtaHotelId('12345'),
          otaHotelName: '携程测试酒店',
          bindExtra: null,
        },
      ],
    });
    const deps = createDeps({ discoverCtrip });
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(existingCredential);
    vi.mocked(deps.credentialRepository.updateIdentity).mockReturnValue({
      ...existingCredential,
      channelAccountId: '12345',
      credentialExtra: {
        hotelId: '12345',
        hotelName: '携程测试酒店',
        identitySource: 'hotel-dom',
      },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      ctripPartitionName,
      ctripChannel,
      'https://ebooking.ctrip.com/hotel/12345',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).toHaveBeenCalledWith(existingCredential.id, {
      channelAccountId: '12345',
      credentialExtra: {
        hotelId: '12345',
        hotelName: '携程测试酒店',
        identitySource: 'hotel-dom',
      },
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('携程多酒店结果不创建 credential', async () => {
    const discoverCtrip = vi.fn().mockResolvedValue({
      kind: 'multiple',
      hotels: [
        { otaHotelId: toOtaHotelId('1'), otaHotelName: '门店A', bindExtra: null },
        { otaHotelId: toOtaHotelId('2'), otaHotelName: '门店B', bindExtra: null },
      ],
    });
    const deps = createDeps({ discoverCtrip });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        ctripPartitionName,
        ctripChannel,
        'https://ebooking.ctrip.com/home/mainland',
        {} as never,
      ),
    ).resolves.toBeNull();

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).not.toHaveBeenCalled();
  });

  it('抖音发现结果创建带登录用户身份的 credential', async () => {
    const discoverDouyin = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '104680039472',
        credentialExtra: {
          loginId: '104680039472',
          name: '走进内蒙古',
          roleName: '商家子账号',
          roleType: 1,
        },
      },
    });
    const deps = createDeps({ discoverDouyin });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        douyinPartitionName,
        douyinChannel,
        'https://life.douyin.com/p/home?groupid=1813179858562059',
        {} as never,
      ),
    ).resolves.not.toBeNull();

    expect(deps.credentialRepository.create).toHaveBeenCalledWith({
      id: toOtaCredentialId('generated-credential-id'),
      channel: douyinChannel,
      channelAccountId: '104680039472',
      partitionName: douyinPartitionName,
      credentialExtra: expect.objectContaining({ loginId: '104680039472' }),
      discoveredAt: expect.any(Number),
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('抖音已有 credential 时刷新登录用户身份', async () => {
    const existingCredential = credential({
      channel: douyinChannel,
      partitionName: douyinPartitionName,
    });
    const discoverDouyin = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '104680039472',
        credentialExtra: {
          loginId: '104680039472',
          name: '走进内蒙古',
          roleName: '商家子账号',
          roleType: 1,
        },
      },
    });
    const deps = createDeps({ discoverDouyin });
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(existingCredential);
    vi.mocked(deps.credentialRepository.updateIdentity).mockReturnValue({
      ...existingCredential,
      channelAccountId: '104680039472',
      credentialExtra: { loginId: '104680039472' },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      douyinPartitionName,
      douyinChannel,
      'https://life.douyin.com/p/home?groupid=1813179858562059',
      {} as never,
    );

    expect(deps.credentialRepository.updateIdentity).toHaveBeenCalledWith(existingCredential.id, {
      channelAccountId: '104680039472',
      credentialExtra: expect.objectContaining({ loginId: '104680039472' }),
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('抖音身份发现失败时不创建 credential', async () => {
    const discoverDouyin = vi.fn().mockResolvedValue({ kind: 'none' });
    const deps = createDeps({ discoverDouyin });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        douyinPartitionName,
        douyinChannel,
        'https://life.douyin.com/p/home?groupid=1813179858562059',
        {} as never,
      ),
    ).resolves.toBeNull();

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).not.toHaveBeenCalled();
  });

  it('美团显式发现创建带渠道身份的 credential', async () => {
    const discoverMeituan = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '274615733',
        credentialExtra: {
          partnerId: '4595635',
          login: 'hotel-login',
          accountType: 1,
          accountStatus: 1,
          maskedPhone: '138****1234',
        },
      },
    });
    const onAccountBound = vi.fn();
    const deps = createDeps({
      discoverMeituan,
      onAccountBound,
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        meituanPartitionName,
        meituanChannel,
        'https://me.meituan.com/ebooking/index.html',
        {} as never,
      ),
    ).resolves.not.toBeNull();

    expect(discoverMeituan).toHaveBeenCalledTimes(1);
    expect(deps.credentialRepository.create).toHaveBeenCalledWith({
      id: toOtaCredentialId('generated-credential-id'),
      channel: meituanChannel,
      channelAccountId: '274615733',
      partitionName: meituanPartitionName,
      credentialExtra: expect.objectContaining({ partnerId: '4595635' }),
      discoveredAt: expect.any(Number),
      lastRefreshedAt: expect.any(Number),
    });
    expect(deps.removePendingPartition).toHaveBeenCalledTimes(1);
    expect(onAccountBound).toHaveBeenCalledTimes(1);
    expect(onAccountBound).toHaveBeenCalledWith(meituanChannel);
  });

  it('美团已有 credential 时刷新身份，不改变 partition', async () => {
    const existingCredential = credential({
      channel: meituanChannel,
      partitionName: meituanPartitionName,
    });
    const discoverMeituan = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '274615733',
        credentialExtra: { partnerId: '4595635' },
      },
    });
    const deps = createDeps({ discoverMeituan });
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(existingCredential);
    vi.mocked(deps.credentialRepository.updateIdentity).mockReturnValue({
      ...existingCredential,
      channelAccountId: '274615733',
      credentialExtra: { partnerId: '4595635' },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      meituanPartitionName,
      meituanChannel,
      'https://me.meituan.com/ebooking/index.html',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).toHaveBeenCalledWith(existingCredential.id, {
      channelAccountId: '274615733',
      credentialExtra: { partnerId: '4595635' },
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('美团新 partition 识别为已有渠道账号时更新原 credential 并退休旧 partition', async () => {
    const previousPartitionName = 'persist:xiaozhi:prod:meituan:old';
    const existingCredential = credential({
      channel: meituanChannel,
      channelAccountId: '274615733',
      partitionName: previousPartitionName,
    });
    const discoverMeituan = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '274615733',
        credentialExtra: { partnerId: '4595635', login: 'hotel-login' },
      },
    });
    const onCredentialPartitionReplaced = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ discoverMeituan, onCredentialPartitionReplaced });
    vi.mocked(deps.credentialRepository.findByChannelAndAccountId).mockReturnValue(
      existingCredential,
    );
    vi.mocked(deps.credentialRepository.updatePartitionAndIdentity).mockReturnValue({
      ...existingCredential,
      partitionName: meituanPartitionName,
      credentialExtra: { partnerId: '4595635', login: 'hotel-login' },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        meituanPartitionName,
        meituanChannel,
        'https://me.meituan.com/ebooking/index.html',
        {} as never,
      ),
    ).resolves.not.toBeNull();

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updatePartitionAndIdentity).toHaveBeenCalledWith(
      existingCredential.id,
      {
        partitionName: meituanPartitionName,
        channelAccountId: '274615733',
        credentialExtra: { partnerId: '4595635', login: 'hotel-login' },
        lastRefreshedAt: expect.any(Number),
      },
    );
    expect(onCredentialPartitionReplaced).toHaveBeenCalledWith(
      previousPartitionName,
      meituanPartitionName,
    );
  });

  it('旧 partition 清理失败时仍保留已完成的 credential 绑定', async () => {
    const existingCredential = credential({
      channel: meituanChannel,
      channelAccountId: '274615733',
      partitionName: 'persist:xiaozhi:prod:meituan:old',
    });
    const discoverMeituan = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: { channelAccountId: '274615733', credentialExtra: null },
    });
    const deps = createDeps({
      discoverMeituan,
      onCredentialPartitionReplaced: vi.fn().mockRejectedValue(new Error('clear failed')),
    });
    vi.mocked(deps.credentialRepository.findByChannelAndAccountId).mockReturnValue(
      existingCredential,
    );
    vi.mocked(deps.credentialRepository.updatePartitionAndIdentity).mockReturnValue({
      ...existingCredential,
      partitionName: meituanPartitionName,
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        meituanPartitionName,
        meituanChannel,
        'https://me.meituan.com/ebooking/index.html',
        {} as never,
      ),
    ).resolves.not.toBeNull();
    expect(deps.removePendingPartition).toHaveBeenCalledWith(meituanPartitionName);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Replaced credential partition could not be retired',
      { channel: meituanChannel, errorName: 'Error' },
    );
  });

  it('美团身份发现失败时保留已有 credential', async () => {
    const discoverMeituan = vi.fn().mockResolvedValue({ kind: 'none' });
    const deps = createDeps({ discoverMeituan });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(
        meituanPartitionName,
        meituanChannel,
        'https://me.meituan.com/ebooking/index.html',
        {} as never,
      ),
    ).resolves.toBeNull();

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).not.toHaveBeenCalled();
    expect(deps.removePendingPartition).not.toHaveBeenCalled();
  });
});
