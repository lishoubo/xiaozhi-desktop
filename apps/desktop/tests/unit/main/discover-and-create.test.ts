import { describe, expect, it, vi } from 'vitest';
import {
  toChannelId,
  toOtaAccountId,
  toOtaCredentialId,
  toOtaHotelId,
} from '../../../src/domain/identity';
import type { OtaCredential } from '../../../src/domain/ota-credential';
import {
  DiscoverAndCreate,
  type DiscoverAndCreateDependencies,
} from '../../../src/main/account-discovery/discover-and-create';

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

function singleProbe(probeChannel = channel) {
  return {
    channel: probeChannel,
    discover: vi.fn().mockResolvedValue({
      kind: 'single',
      hotel: {
        otaHotelId: toOtaHotelId('12345'),
        otaHotelName: '测试酒店',
        bindExtra: null,
      },
    }),
  };
}

function createDeps(
  overrides: Partial<DiscoverAndCreateDependencies> = {},
): DiscoverAndCreateDependencies {
  const accountRepository = {
    create: vi.fn((input) => input),
    findByChannelAndHotelId: vi.fn(() => null),
    updateDiscovery: vi.fn(),
    listByChannel: vi.fn(() => []),
    findById: vi.fn(() => null),
  };
  const credentialRepository = {
    create: vi.fn((input) => input),
    findById: vi.fn(() => null),
    findByPartitionName: vi.fn(() => null),
    findByChannelAndAccountId: vi.fn(() => null),
    updateIdentity: vi.fn(),
  };
  return {
    probes: new Map(),
    discoverCtrip: vi.fn().mockResolvedValue({ kind: 'none' }),
    discoverDouyin: vi.fn().mockResolvedValue({ kind: 'none' }),
    discoverMeituan: vi.fn().mockResolvedValue({ kind: 'none' }),
    accountRepository,
    credentialRepository,
    generateAccountId: vi.fn(() => 'generated-account-id'),
    generateCredentialId: vi.fn(() => 'generated-credential-id'),
    removePendingPartition: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as DiscoverAndCreateDependencies;
}

describe('DiscoverAndCreate', () => {
  it('single 结果先创建 credential，再创建引用它的账号', async () => {
    const probe = singleProbe();
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(deps.credentialRepository.create).toHaveBeenCalledWith({
      id: toOtaCredentialId('generated-credential-id'),
      channel,
      channelAccountId: null,
      partitionName,
      credentialExtra: null,
      discoveredAt: expect.any(Number),
      lastRefreshedAt: null,
    });
    expect(deps.accountRepository.create).toHaveBeenCalledWith({
      id: toOtaAccountId('generated-account-id'),
      credentialId: toOtaCredentialId('generated-credential-id'),
      channel,
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '测试酒店',
      bindExtra: null,
      discoveredAt: expect.any(Number),
    });
    expect(deps.removePendingPartition).toHaveBeenCalledWith(partitionName);
  });

  it('partition 已有关联 credential 时直接复用', async () => {
    const existingCredential = credential();
    const deps = createDeps({ probes: new Map([[channel, singleProbe()]]) });
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(existingCredential);
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: existingCredential.id }),
    );
  });

  it('结构化 bindExtra 原样写入账号', async () => {
    const probe = singleProbe(channel);
    probe.discover.mockResolvedValue({
      kind: 'single',
      hotel: {
        otaHotelId: toOtaHotelId('dy-1'),
        otaHotelName: '抖音门店',
        bindExtra: { merchantGroupId: 'group-1' },
      },
    });
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(deps.accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ bindExtra: { merchantGroupId: 'group-1' } }),
    );
  });

  it('同一酒店已存在时改为引用新 credential，不删除旧 credential 或 partition', async () => {
    const existing = {
      id: toOtaAccountId('existing-id'),
      credentialId: toOtaCredentialId('old-credential'),
      channel,
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '旧酒店名',
      bindExtra: null,
      discoveredAt: 1,
    };
    const deps = createDeps({ probes: new Map([[channel, singleProbe()]]) });
    vi.mocked(deps.accountRepository.findByChannelAndHotelId).mockReturnValue(existing);
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(deps.accountRepository.create).not.toHaveBeenCalled();
    expect(deps.accountRepository.updateDiscovery).toHaveBeenCalledWith(existing.id, {
      credentialId: toOtaCredentialId('generated-credential-id'),
      otaHotelName: '测试酒店',
      bindExtra: null,
      discoveredAt: expect.any(Number),
    });
    expect(deps.credentialRepository).not.toHaveProperty('delete');
  });

  it('credential 落库失败时不更新账号并返回 false', async () => {
    const deps = createDeps({ probes: new Map([[channel, singleProbe()]]) });
    vi.mocked(deps.credentialRepository.create).mockImplementation(() => {
      throw new Error('database failed');
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never),
    ).resolves.toBe(false);
    expect(deps.accountRepository.create).not.toHaveBeenCalled();
    expect(deps.accountRepository.updateDiscovery).not.toHaveBeenCalled();
    expect(deps.removePendingPartition).not.toHaveBeenCalled();
  });

  it('建号成功后通知 renderer 刷新账号并永久防重复探测', async () => {
    const probe = singleProbe();
    const onAccountBound = vi.fn();
    const deps = createDeps({ probes: new Map([[channel, probe]]), onAccountBound });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );
    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(onAccountBound).toHaveBeenCalledWith(channel);
    expect(probe.discover).toHaveBeenCalledTimes(1);
  });

  it('探测结果为 none 时不落库、不通知', async () => {
    const probe = { channel, discover: vi.fn().mockResolvedValue({ kind: 'none' }) };
    const onAccountBound = vi.fn();
    const deps = createDeps({ probes: new Map([[channel, probe]]), onAccountBound });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.accountRepository.create).not.toHaveBeenCalled();
    expect(onAccountBound).not.toHaveBeenCalled();
  });

  it('探测进行中再次触发会被 inflight 跳过', async () => {
    let resolveDiscover: (outcome: { kind: 'none' }) => void = () => {};
    const probe = {
      channel,
      discover: vi.fn(
        () =>
          new Promise<{ kind: 'none' }>((resolve) => {
            resolveDiscover = resolve;
          }),
      ),
    };
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    const first = discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );
    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );
    expect(probe.discover).toHaveBeenCalledTimes(1);
    resolveDiscover({ kind: 'none' });
    await first;
  });

  it('渠道未注册 probe 时直接跳过', async () => {
    const deps = createDeps();
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(
      discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never),
    ).resolves.toBe(false);
    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
  });

  it('multiple 结果仍不落库、不标记 bound', async () => {
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'multiple',
        hotels: [
          { otaHotelId: toOtaHotelId('1'), otaHotelName: '门店A', bindExtra: null },
          { otaHotelId: toOtaHotelId('2'), otaHotelName: '门店B', bindExtra: null },
        ],
      }),
    };
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );
    await discoverAndCreate.trigger(
      partitionName,
      channel,
      'https://example.com/landing',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(probe.discover).toHaveBeenCalledTimes(2);
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
    ).resolves.toBe(true);

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
    expect(deps.accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: toOtaCredentialId('generated-credential-id'),
        channel: ctripChannel,
        otaHotelId: toOtaHotelId('12345'),
      }),
    );
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

  it('携程多酒店结果不创建 credential 或 account', async () => {
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
    ).resolves.toBe(false);

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).not.toHaveBeenCalled();
    expect(deps.accountRepository.create).not.toHaveBeenCalled();
  });

  it('抖音发现结果创建带登录用户身份的 credential 并关联酒店', async () => {
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
      hotels: [
        {
          otaHotelId: toOtaHotelId('7220335839249696827'),
          otaHotelName: '抖音测试酒店',
          bindExtra: { merchantGroupId: '1813179858562059' },
        },
      ],
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
    ).resolves.toBe(true);

    expect(deps.credentialRepository.create).toHaveBeenCalledWith({
      id: toOtaCredentialId('generated-credential-id'),
      channel: douyinChannel,
      channelAccountId: '104680039472',
      partitionName: douyinPartitionName,
      credentialExtra: expect.objectContaining({ loginId: '104680039472' }),
      discoveredAt: expect.any(Number),
      lastRefreshedAt: expect.any(Number),
    });
    expect(deps.accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: douyinChannel,
        otaHotelId: toOtaHotelId('7220335839249696827'),
        bindExtra: { merchantGroupId: '1813179858562059' },
      }),
    );
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
      hotels: [
        {
          otaHotelId: toOtaHotelId('7220335839249696827'),
          otaHotelName: '抖音测试酒店',
          bindExtra: { merchantGroupId: '1813179858562059' },
        },
      ],
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

  it('抖音身份发现失败时不创建 credential 或 account', async () => {
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
    ).resolves.toBe(false);

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).not.toHaveBeenCalled();
    expect(deps.accountRepository.create).not.toHaveBeenCalled();
  });

  it('美团显式发现创建带渠道身份的 credential，并一次保存全部酒店', async () => {
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
      hotels: [
        {
          otaHotelId: toOtaHotelId('hotel-1'),
          otaHotelName: '美团酒店一',
          bindExtra: { otaPartnerId: 'partner-1', otaPartnerName: '合作方一' },
        },
        {
          otaHotelId: toOtaHotelId('hotel-2'),
          otaHotelName: '美团酒店二',
          bindExtra: null,
        },
      ],
    });
    const onAccountBound = vi.fn();
    const deps = createDeps({
      discoverMeituan,
      generateAccountId: vi
        .fn()
        .mockReturnValueOnce('generated-account-1')
        .mockReturnValueOnce('generated-account-2'),
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
    ).resolves.toBe(true);

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
    expect(deps.accountRepository.create).toHaveBeenCalledTimes(2);
    expect(deps.accountRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: toOtaAccountId('generated-account-1'),
        credentialId: toOtaCredentialId('generated-credential-id'),
        otaHotelId: toOtaHotelId('hotel-1'),
      }),
    );
    expect(deps.accountRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: toOtaAccountId('generated-account-2'),
        credentialId: toOtaCredentialId('generated-credential-id'),
        otaHotelId: toOtaHotelId('hotel-2'),
      }),
    );
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
      hotels: [
        {
          otaHotelId: toOtaHotelId('hotel-1'),
          otaHotelName: '美团酒店一',
          bindExtra: null,
        },
      ],
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
    expect(deps.accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: existingCredential.id }),
    );
  });

  it('美团身份发现失败时保留已有 credential 和账号', async () => {
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
    ).resolves.toBe(false);

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).not.toHaveBeenCalled();
    expect(deps.accountRepository.create).not.toHaveBeenCalled();
    expect(deps.accountRepository.updateDiscovery).not.toHaveBeenCalled();
    expect(deps.removePendingPartition).not.toHaveBeenCalled();
  });
});
