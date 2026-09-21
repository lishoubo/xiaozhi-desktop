import { describe, expect, it, vi } from 'vitest';
import { createScanTargetsOf } from '../../../src/main/composition/scan-targets';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';
import type { JsonObject } from '../../../src/shared/types/json';

const CTRIP = toChannelId('ctrip');
const MEITUAN = toChannelId('meituan');

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: CTRIP,
    channelAccountId: null,
    channelAccountName: null,
    partitionName: 'persist:xiaozhi:dev:ctrip:abc',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
    ...overrides,
  };
}

/** `credentialExtra.pois` 里的一条 —— 形状由 `meituan/poi-infos.ts` 的 `toPoiEntries` 产出。 */
function poi(poiId: string, otaPartnerId: string | number | null): JsonObject {
  return { poiId, otaPartnerId, poiName: `门店${poiId}` };
}

function create() {
  const logger = createLogger();
  const scanTargetsOf = createScanTargetsOf({ meituanChannel: MEITUAN, logger });
  return { scanTargetsOf, logger };
}

/** 带门店清单的美团凭证。 */
function meituanWith(pois: JsonObject[], extra: JsonObject = {}): OtaCredential {
  return credential({
    channel: MEITUAN,
    partitionName: 'persist:xiaozhi:dev:meituan:abc',
    credentialExtra: { partnerId: '4824962', ...extra, pois },
  });
}

describe('携程：凭证 → 1 个目标', () => {
  // 门店上下文完全由 cookie 决定，一个凭证天然对应它当前所在那家店。
  it('从 credentialExtra 取 masterHotelId', () => {
    const { scanTargetsOf } = create();

    const targets = scanTargetsOf(
      CTRIP,
      credential({ credentialExtra: { masterHotelId: 122244992 } }),
    );

    expect(targets).toEqual([
      {
        channel: CTRIP,
        partitionName: 'persist:xiaozhi:dev:ctrip:abc',
        otaHotelId: '122244992',
        channelExtra: {},
      },
    ]);
  });

  // ⚠️ 存错的 otaHotelId 会永久留在库里，下次归一正确时同一格变成「另一家酒店」，
  // 唯一键撞不上 → 两份基线 → 扫描把整批判成新增。宁可少扫一轮。
  it('取不到 masterHotelId 时不产出目标', () => {
    const { scanTargetsOf } = create();

    expect(scanTargetsOf(CTRIP, credential({ credentialExtra: null }))).toEqual([]);
    expect(scanTargetsOf(CTRIP, credential({ credentialExtra: {} }))).toEqual([]);
    expect(scanTargetsOf(CTRIP, credential({ credentialExtra: { masterHotelId: '' } }))).toEqual([]);
  });

  // 携程即使 extra 里混了 pois 也走 masterHotelId —— 枚举口径按渠道定，不按字段有无。
  it('不受 pois 字段影响', () => {
    const { scanTargetsOf } = create();

    const targets = scanTargetsOf(
      CTRIP,
      credential({ credentialExtra: { masterHotelId: 1, pois: [poi('999', '888')] } }),
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.otaHotelId).toBe('1');
  });
});

describe('美团：凭证 → N 个目标', () => {
  // ⭐ 门店清单来自 credentialExtra.pois（登录时探测写入），不查 ota_hotel。
  // 其余三条链路（改价上报、回读、自然读）都从报文里取 poiId，只有扫描没有报文。
  it('清单里每家门店各产出一个目标', () => {
    const { scanTargetsOf } = create();

    const targets = scanTargetsOf(
      MEITUAN,
      meituanWith([poi('1834077877', '4595635'), poi('1834077878', '4595636')]),
    );

    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.otaHotelId)).toEqual(['1834077877', '1834077878']);
    expect(targets.every((t) => t.partitionName === 'persist:xiaozhi:dev:meituan:abc')).toBe(true);
  });

  // ⚠️ poiId 同时出现在两处不是冗余：otaHotelId 是通用维度（基线门店键、上报归一 ID），
  // channelExtra.otaHotelId 是渠道取数入参。渠道实现只认后者。
  it('channelExtra 带上门店级取数入参', () => {
    const { scanTargetsOf } = create();

    expect(scanTargetsOf(MEITUAN, meituanWith([poi('1834077877', '4595635')]))[0]?.channelExtra)
      .toEqual({ otaHotelId: '1834077877', otaPartnerId: '4595635' });
  });

  // ⚠️ 门店级 otaPartnerId 与 credentialExtra 外层那个 partnerId 是**两个值**。
  // 拿账号级的去凑会打到错误的地方。
  it('取门店级 otaPartnerId，不是账号级 partnerId', () => {
    const { scanTargetsOf } = create();

    const targets = scanTargetsOf(
      MEITUAN,
      meituanWith([poi('1834077877', '4595635')], { partnerId: '4824962' }),
    );

    expect(targets[0]?.channelExtra).toMatchObject({ otaPartnerId: '4595635' });
  });

  it('条目缺 poiId 或 otaPartnerId 时跳过并告警', () => {
    const { scanTargetsOf, logger } = create();

    const targets = scanTargetsOf(
      MEITUAN,
      meituanWith([poi('1834077877', '4595635'), poi('1834077878', null), poi('', '4595637')]),
    );

    expect(targets.map((target) => target.otaHotelId)).toEqual(['1834077877']);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('数字形式的 ID 也能取到', () => {
    const { scanTargetsOf } = create();

    expect(scanTargetsOf(MEITUAN, meituanWith([poi('1834077877', 4595635)]))[0]?.channelExtra)
      .toMatchObject({ otaPartnerId: '4595635' });
  });

  // ⚠️ 这是正常状态（凭证建于本功能之前，或登录时 poiInfos 没取到），
  // 但日志上与「调度器挂了」长得一样。2026-09-21 真机就撞上了。
  it('没有门店清单时记一条 info，不是静默跳过', () => {
    const { scanTargetsOf, logger } = create();

    expect(scanTargetsOf(MEITUAN, meituanWith([]))).toEqual([]);
    expect(scanTargetsOf(MEITUAN, credential({ channel: MEITUAN, credentialExtra: null }))).toEqual(
      [],
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no poi list'),
      expect.objectContaining({ partitionName: expect.any(String) }),
    );
    // 不是异常，不该是 warn
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ⚠️ 美团根本不写 masterHotelId。若误用携程那条路，全部美团凭证会被静默跳过。
  it('不依赖 masterHotelId', () => {
    const { scanTargetsOf } = create();

    expect(scanTargetsOf(MEITUAN, meituanWith([poi('1834077877', '4595635')]))).toHaveLength(1);
  });
});
