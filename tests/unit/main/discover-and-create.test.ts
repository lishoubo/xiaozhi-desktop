import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaAccountId, toOtaHotelId } from '../../../src/domain/identity';
import {
  DiscoverAndCreate,
  type DiscoverAndCreateDependencies,
} from '../../../src/main/account-discovery/discover-and-create';

function createDeps(
  overrides: Partial<DiscoverAndCreateDependencies> = {},
): DiscoverAndCreateDependencies {
  return {
    probes: new Map(),
    repository: {
      create: vi.fn(),
      findByChannelAndHotelId: vi.fn(() => null),
      updatePartitionName: vi.fn(),
    },
    generateAccountId: vi.fn(() => 'generated-id'),
    deleteSessionData: vi.fn().mockResolvedValue(undefined),
    removePendingPartition: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as unknown as DiscoverAndCreateDependencies;
}

describe('DiscoverAndCreate', () => {
  const channel = toChannelId('ctrip');
  const partitionName = 'persist:xiaozhi:prod:ctrip:aaa';

  it('探测到单店且未查重命中时创建新账号，并摘除 pending partition', async () => {
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId('12345'), otaHotelName: '测试酒店', channelContext: null },
      }),
    };
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);

    expect(deps.repository.create).toHaveBeenCalledWith({
      id: toOtaAccountId('generated-id'),
      channel,
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '测试酒店',
      partitionName,
      channelContext: null,
      discoveredAt: expect.any(Number),
    });
    expect(deps.repository.updatePartitionName).not.toHaveBeenCalled();
    expect(deps.removePendingPartition).toHaveBeenCalledWith(partitionName);
  });

  it('建号成功后调用 onAccountBound，renderer 侧账号导航靠它重新拉取列表', async () => {
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId('12345'), otaHotelName: '测试酒店', channelContext: null },
      }),
    };
    const onAccountBound = vi.fn();
    const deps = createDeps({ probes: new Map([[channel, probe]]), onAccountBound });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);

    expect(onAccountBound).toHaveBeenCalledWith(channel);
  });

  it('探测结果为 none 时不调用 onAccountBound', async () => {
    const probe = { channel, discover: vi.fn().mockResolvedValue({ kind: 'none' }) };
    const onAccountBound = vi.fn();
    const deps = createDeps({ probes: new Map([[channel, probe]]), onAccountBound });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);

    expect(onAccountBound).not.toHaveBeenCalled();
  });

  it('抖音场景 channelContext 透传 groupid', async () => {
    const douyinChannel = toChannelId('douyin');
    const probe = {
      channel: douyinChannel,
      discover: vi.fn().mockResolvedValue({
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId('dy-1'), otaHotelName: '抖音门店', channelContext: 'group-1' },
      }),
    };
    const deps = createDeps({ probes: new Map([[douyinChannel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, douyinChannel, 'https://example.com/landing', {} as never);

    expect(deps.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ channelContext: 'group-1' }),
    );
  });

  it('查重命中已有账号时更新 partitionName 并删除旧 partition 的 session', async () => {
    const existing = {
      id: toOtaAccountId('existing-id'),
      channel,
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '旧酒店名',
      partitionName: 'persist:xiaozhi:prod:ctrip:old',
      channelContext: null,
      discoveredAt: 1_700_000_000_000,
    };
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId('12345'), otaHotelName: '测试酒店' },
      }),
    };
    const deps = createDeps({
      probes: new Map([[channel, probe]]),
      repository: {
        create: vi.fn(),
        findByChannelAndHotelId: vi.fn(() => existing),
        updatePartitionName: vi.fn(),
        listByChannel: vi.fn(() => []),
        findById: vi.fn(() => null),
      },
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);

    expect(deps.repository.create).not.toHaveBeenCalled();
    expect(deps.repository.updatePartitionName).toHaveBeenCalledWith(existing.id, partitionName);
    expect(deps.deleteSessionData).toHaveBeenCalledWith('persist:xiaozhi:prod:ctrip:old');
  });

  it('删除旧 partition 失败不阻断账号更新（仍会摘除 pending partition）', async () => {
    const existing = {
      id: toOtaAccountId('existing-id'),
      channel,
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '旧酒店名',
      partitionName: 'persist:xiaozhi:prod:ctrip:old',
      channelContext: null,
      discoveredAt: 1_700_000_000_000,
    };
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId('12345'), otaHotelName: '测试酒店' },
      }),
    };
    const deps = createDeps({
      probes: new Map([[channel, probe]]),
      repository: {
        create: vi.fn(),
        findByChannelAndHotelId: vi.fn(() => existing),
        updatePartitionName: vi.fn(),
        listByChannel: vi.fn(() => []),
        findById: vi.fn(() => null),
      },
      deleteSessionData: vi.fn().mockRejectedValue(new Error('目录被占用')),
    });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never)).resolves.toBeUndefined();
    expect(deps.repository.updatePartitionName).toHaveBeenCalled();
    expect(deps.removePendingPartition).toHaveBeenCalledWith(partitionName);
  });

  it('同一 partition 探测进行中再次触发会被跳过（防重入）', async () => {
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

    const first = discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);
    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);

    expect(probe.discover).toHaveBeenCalledTimes(1);
    resolveDiscover({ kind: 'none' });
    await first;
  });

  it('探测成功建号后，同一 partition 再次触发不重复探测', async () => {
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId('12345'), otaHotelName: '测试酒店' },
      }),
    };
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);
    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);

    expect(probe.discover).toHaveBeenCalledTimes(1);
  });

  it('渠道未注册 probe 时直接跳过，不报错', async () => {
    const deps = createDeps();
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await expect(discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never)).resolves.toBeUndefined();
    expect(deps.repository.create).not.toHaveBeenCalled();
  });

  it('探测到多个门店时不落库、不标记为已绑定，等待用户选择', async () => {
    const probe = {
      channel,
      discover: vi.fn().mockResolvedValue({
        kind: 'multiple',
        hotels: [
          { otaHotelId: toOtaHotelId('1'), otaHotelName: '门店A' },
          { otaHotelId: toOtaHotelId('2'), otaHotelName: '门店B' },
        ],
      }),
    };
    const deps = createDeps({ probes: new Map([[channel, probe]]) });
    const discoverAndCreate = new DiscoverAndCreate(deps);

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);
    expect(deps.repository.create).not.toHaveBeenCalled();

    await discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never);
    expect(probe.discover).toHaveBeenCalledTimes(2);
  });
});
