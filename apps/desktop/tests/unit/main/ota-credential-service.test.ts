import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId, toOtaHotelId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';
import {
  OtaCredentialService,
  type DiscoverAndCreateDependencies,
} from '../../../src/main/services/ota-credential-service';

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
    channelAccountName: null,
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
    deleteById: vi.fn(),
  };
  return {
    discoverCtrip: vi.fn().mockResolvedValue({ kind: 'none' }),
    discoverDouyin: vi.fn().mockResolvedValue({ kind: 'none' }),
    discoverMeituan: vi.fn().mockResolvedValue({ kind: 'none' }),
    credentialRepository,
    generateCredentialId: vi.fn(() => 'generated-credential-id'),
    markPartitionClaimed: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as DiscoverAndCreateDependencies;
}

describe('OtaCredentialService', () => {
  it('渠道未注册 discovery 时直接跳过', async () => {
    const deps = createDeps();
    const discoverAndCreate = new OtaCredentialService(deps);

    await expect(
      discoverAndCreate.trigger(partitionName, channel, 'https://example.com/landing', {} as never),
    ).resolves.toBeNull();
    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
  });

  it('携程单酒店结果创建带 HEAppInfo 账号身份的 credential', async () => {
    const discoverCtrip = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '12345',
        credentialExtra: {
          huid: '12324831',
          userName: '携程测试账号',
          masterHotelId: '12345',
          hotelName: '携程测试酒店',
          identitySource: 'he-app-info',
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
    const discoverAndCreate = new OtaCredentialService(deps);

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
      // 携程的名字取自 credentialExtra.userName（账号名，不是酒店名）——
      // 渠道差异在写入时抹平，见 channelAccountNameOf。
      channelAccountName: '携程测试账号',
      partitionName: ctripPartitionName,
      credentialExtra: {
        huid: '12324831',
        userName: '携程测试账号',
        masterHotelId: '12345',
        hotelName: '携程测试酒店',
        identitySource: 'he-app-info',
      },
      discoveredAt: expect.any(Number),
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('携程已有 credential 时刷新 HEAppInfo 账号身份', async () => {
    const existingCredential = credential({
      channel: ctripChannel,
      partitionName: ctripPartitionName,
    });
    const discoverCtrip = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: {
        channelAccountId: '12345',
        credentialExtra: {
          huid: '12324831',
          userName: '携程测试账号',
          masterHotelId: '12345',
          hotelName: '携程测试酒店',
          identitySource: 'he-app-info',
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
      channelAccountName: null,
      credentialExtra: {
        huid: '12324831',
        userName: '携程测试账号',
        masterHotelId: '12345',
        hotelName: '携程测试酒店',
        identitySource: 'he-app-info',
      },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new OtaCredentialService(deps);

    await discoverAndCreate.trigger(
      ctripPartitionName,
      ctripChannel,
      'https://ebooking.ctrip.com/hotel/12345',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).toHaveBeenCalledWith(existingCredential.id, {
      channelAccountId: '12345',
      channelAccountName: '携程测试账号',
      credentialExtra: {
        huid: '12324831',
        userName: '携程测试账号',
        masterHotelId: '12345',
        hotelName: '携程测试酒店',
        identitySource: 'he-app-info',
      },
      lastRefreshedAt: expect.any(Number),
    });
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
    const discoverAndCreate = new OtaCredentialService(deps);

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
      // 抖音的名字取自 credentialExtra.name。
      channelAccountName: '走进内蒙古',
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
      channelAccountName: null,
      credentialExtra: { loginId: '104680039472' },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new OtaCredentialService(deps);

    await discoverAndCreate.trigger(
      douyinPartitionName,
      douyinChannel,
      'https://life.douyin.com/p/home?groupid=1813179858562059',
      {} as never,
    );

    expect(deps.credentialRepository.updateIdentity).toHaveBeenCalledWith(existingCredential.id, {
      channelAccountId: '104680039472',
      channelAccountName: '走进内蒙古',
      credentialExtra: expect.objectContaining({ loginId: '104680039472' }),
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('抖音身份发现失败时不创建 credential', async () => {
    const discoverDouyin = vi.fn().mockResolvedValue({ kind: 'none' });
    const deps = createDeps({ discoverDouyin });
    const discoverAndCreate = new OtaCredentialService(deps);

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
    const discoverAndCreate = new OtaCredentialService(deps);

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
      // 美团既没有 hotelName 也没有 name，名字取自 login —— 渠道差异在写入时抹平。
      channelAccountName: 'hotel-login',
      partitionName: meituanPartitionName,
      credentialExtra: expect.objectContaining({ partnerId: '4595635' }),
      discoveredAt: expect.any(Number),
      lastRefreshedAt: expect.any(Number),
    });
    expect(deps.markPartitionClaimed).toHaveBeenCalledTimes(1);
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
      channelAccountName: null,
      credentialExtra: { partnerId: '4595635' },
      lastRefreshedAt: 200,
    });
    const discoverAndCreate = new OtaCredentialService(deps);

    await discoverAndCreate.trigger(
      meituanPartitionName,
      meituanChannel,
      'https://me.meituan.com/ebooking/index.html',
      {} as never,
    );

    expect(deps.credentialRepository.create).not.toHaveBeenCalled();
    expect(deps.credentialRepository.updateIdentity).toHaveBeenCalledWith(existingCredential.id, {
      channelAccountId: '274615733',
      channelAccountName: null,
      credentialExtra: { partnerId: '4595635' },
      lastRefreshedAt: expect.any(Number),
    });
  });

  it('美团新 partition 识别为已有渠道账号时更新原 credential 并退休旧 partition', async () => {
    const previousPartitionName = 'persist:xiaozhi:prod:meituan:old';
    const existingCredential = credential({
      channel: meituanChannel,
      channelAccountId: '274615733',
      channelAccountName: null,
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
    const discoverAndCreate = new OtaCredentialService(deps);

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
        channelAccountName: 'hotel-login',
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
      channelAccountName: null,
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
    const discoverAndCreate = new OtaCredentialService(deps);

    await expect(
      discoverAndCreate.trigger(
        meituanPartitionName,
        meituanChannel,
        'https://me.meituan.com/ebooking/index.html',
        {} as never,
      ),
    ).resolves.not.toBeNull();
    // 认领时带上是哪条 credential 认的 —— 账本据此记录归属。
    expect(deps.markPartitionClaimed).toHaveBeenCalledWith(
      meituanPartitionName,
      expect.any(String),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Replaced credential partition could not be retired',
      {
        channel: meituanChannel,
        error: expect.objectContaining({ name: 'Error', message: 'clear failed' }),
      },
    );
  });

  it('美团身份发现失败时保留已有 credential', async () => {
    const discoverMeituan = vi.fn().mockResolvedValue({ kind: 'none' });
    const deps = createDeps({ discoverMeituan });
    const discoverAndCreate = new OtaCredentialService(deps);

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
    expect(deps.markPartitionClaimed).not.toHaveBeenCalled();
  });
  /**
   * 真机踩过的坑：第二次导航返回 null 会让 `HotelProbeDispatcher` 以为「这次
   * 没登录成功」而跳过酒店探测，于是「对已登录账号发起绑定」永远等不到候选。
   */
  it('同一 partition 再次触发时返回已有 credential，而不是 null', async () => {
    const existing = credential({ channel: douyinChannel, partitionName: douyinPartitionName });
    const discoverDouyin = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: { channelAccountId: '9527', credentialExtra: {} },
      hotels: [],
    });
    const deps = createDeps({ discoverDouyin });
    vi.mocked(deps.credentialRepository.create).mockReturnValue(existing);
    const service = new OtaCredentialService(deps);

    const first = await service.trigger(
      douyinPartitionName,
      douyinChannel,
      'https://example.com/landing',
      {} as never,
    );
    expect(first).not.toBeNull();

    // 第二次：探测不再重跑，但凭证必须照样交出去。
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(existing);
    const second = await service.trigger(
      douyinPartitionName,
      douyinChannel,
      'https://example.com/landing',
      {} as never,
    );

    expect(second).toEqual(existing);
    expect(discoverDouyin).toHaveBeenCalledTimes(1);
  });

  /**
   * 用户在渠道后台**直接切换账号**（携程/美团都支持），partition 不变：
   *
   * ```
   * existing   = 账号 A 的 credential（按 partition 查到）
   * identified = 账号 B 的 credential（按渠道账号 ID 查到，B 以前登过）
   * 两者 id 不同 → 旧代码进第一个分支后撞上 `if (existing) throw`
   *              → 被 trigger 的 catch 吞成一行 warn → 返回 null
   *              → 用户看到「切了账号但没反应」
   * ```
   *
   * 「两条 credential 指向同一 partition」由 `partition_name` 的 UNIQUE 约束
   * （migration 3）兜底，不需要 service 再用 if 硬挡一道。
   */
  it('同一 partition 内切换到另一个已知账号时完成归并，不抛错', async () => {
    const accountA = credential({
      id: toOtaCredentialId('credential-a'),
      channel: meituanChannel,
      partitionName: meituanPartitionName,
      channelAccountId: '111',
    });
    const accountB = credential({
      id: toOtaCredentialId('credential-b'),
      channel: meituanChannel,
      partitionName: 'persist:xiaozhi:prod:meituan:old-b',
      channelAccountId: '222',
    });
    const discoverMeituan = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: { channelAccountId: '222', credentialExtra: { login: 'accountB' } },
    });
    const deps = createDeps({ discoverMeituan });
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(accountA);
    vi.mocked(deps.credentialRepository.findByChannelAndAccountId).mockReturnValue(accountB);
    vi.mocked(deps.credentialRepository.updatePartitionAndIdentity).mockReturnValue({
      ...accountB,
      partitionName: meituanPartitionName,
    });
    const service = new OtaCredentialService(deps);

    const result = await service.trigger(
      meituanPartitionName,
      meituanChannel,
      'https://me.meituan.com/ebooking/index.html',
      {} as never,
    );

    // 账号 B 的 credential 迁到当前 partition，而不是整条链路失败。
    expect(result).not.toBeNull();
    expect(deps.credentialRepository.updatePartitionAndIdentity).toHaveBeenCalledWith(
      toOtaCredentialId('credential-b'),
      expect.objectContaining({
        partitionName: meituanPartitionName,
        channelAccountId: '222',
      }),
    );
  });

  /**
   * 账号 B 让出 partition 后，账号 A 那条 credential 仍指向同一个 partition ——
   * UNIQUE 约束不允许两条并存，且它已经不是这份登录态的主人了。
   */
  it('被顶替的旧账号被清理', async () => {
    const accountA = credential({
      id: toOtaCredentialId('credential-a'),
      channel: meituanChannel,
      partitionName: meituanPartitionName,
      channelAccountId: '111',
    });
    const accountB = credential({
      id: toOtaCredentialId('credential-b'),
      channel: meituanChannel,
      partitionName: 'persist:xiaozhi:prod:meituan:old-b',
      channelAccountId: '222',
    });
    const discoverMeituan = vi.fn().mockResolvedValue({
      kind: 'found',
      credential: { channelAccountId: '222', credentialExtra: { login: 'accountB' } },
    });
    const deps = createDeps({ discoverMeituan });
    vi.mocked(deps.credentialRepository.findByPartitionName).mockReturnValue(accountA);
    vi.mocked(deps.credentialRepository.findByChannelAndAccountId).mockReturnValue(accountB);
    vi.mocked(deps.credentialRepository.updatePartitionAndIdentity).mockReturnValue({
      ...accountB,
      partitionName: meituanPartitionName,
    });
    const service = new OtaCredentialService(deps);

    await service.trigger(
      meituanPartitionName,
      meituanChannel,
      'https://me.meituan.com/ebooking/index.html',
      {} as never,
    );

    // A 被顶替：它已经没有可用登录态（partition 归 B 了），留着会成为账号列表里
    // 一个点了就打开别人页面的错误选项 —— 直接清理，连同它名下的 ota_hotel 行。
    expect(deps.credentialRepository.deleteById).toHaveBeenCalledWith(
      toOtaCredentialId('credential-a'),
    );
  });
});
