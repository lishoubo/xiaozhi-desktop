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

const channel = toChannelId('ctrip');
const partitionName = 'persist:xiaozhi:prod:ctrip:aaa';

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel,
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
  };
  return {
    probes: new Map(),
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
    const douyinChannel = toChannelId('douyin');
    const probe = singleProbe(douyinChannel);
    probe.discover.mockResolvedValue({
      kind: 'single',
      hotel: {
        otaHotelId: toOtaHotelId('dy-1'),
        otaHotelName: '抖音门店',
        bindExtra: { merchantGroupId: 'group-1' },
      },
    });
    const deps = createDeps({ probes: new Map([[douyinChannel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(
      partitionName,
      douyinChannel,
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
});
