import type { WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import { ctripHotelProbe } from '../../../src/main/channels/ctrip/hotel-prob';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';
import type { JsonObject } from '../../../src/shared/types/json';

function credentialWith(credentialExtra: JsonObject | null): OtaCredential {
  return {
    id: toOtaCredentialId('cred-1'),
    channel: toChannelId('ctrip'),
    channelAccountId: '12324831',
    channelAccountName: '银际青山店',
    partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    credentialExtra,
    discoveredAt: 1,
    lastRefreshedAt: 1,
  };
}

const NO_PAGE = {} as unknown as WebContents;

describe('ctripHotelProbe', () => {
  it('读新口径的 masterHotelId', async () => {
    const outcome = await ctripHotelProbe.probe(
      credentialWith({
        huid: '12324831',
        userName: '银际青山店',
        masterHotelId: '85068938',
        hotelName: '银际酒店(包头市青山王府井文化路店)',
        identitySource: 'he-app-info',
      }),
      NO_PAGE,
    );

    expect(outcome).toEqual({
      kind: 'found',
      hotels: [
        {
          otaHotelId: '85068938',
          otaHotelName: '银际酒店(包头市青山王府井文化路店)',
          bindExtra: null,
        },
      ],
    });
  });

  /**
   * 老 credential 不迁移（沿用 migration 8 的惯例），它们存的是 `hotelId`。
   * 只认新字段会让老账号的酒店探测当场失效 —— 而那正是绑定流程的入口。
   */
  it('老记录的 hotelId 仍然认', async () => {
    const outcome = await ctripHotelProbe.probe(
      credentialWith({ hotelId: '12345', hotelName: '平江府', identitySource: 'hotel-dom' }),
      NO_PAGE,
    );

    expect(outcome).toEqual({
      kind: 'found',
      hotels: [{ otaHotelId: '12345', otaHotelName: '平江府', bindExtra: null }],
    });
  });

  it('两个字段都在时以新口径的 masterHotelId 为准', async () => {
    const outcome = await ctripHotelProbe.probe(
      credentialWith({ masterHotelId: '85068938', hotelId: '12345', hotelName: '某酒店' }),
      NO_PAGE,
    );

    expect(outcome).toMatchObject({ hotels: [{ otaHotelId: '85068938' }] });
  });

  /** 携程用 -1 表达「无」，不能当成一个真的酒店 ID。 */
  it('masterHotelId 为 -1 时视作没有酒店', async () => {
    const outcome = await ctripHotelProbe.probe(
      credentialWith({ masterHotelId: -1, hotelName: '某酒店' }),
      NO_PAGE,
    );

    expect(outcome).toEqual({ kind: 'none' });
  });

  it('只有账号没有酒店时返回 none，不产出空候选', async () => {
    const outcome = await ctripHotelProbe.probe(
      credentialWith({ huid: '12324831', userName: '银际青山店', masterHotelId: null }),
      NO_PAGE,
    );

    expect(outcome).toEqual({ kind: 'none' });
  });

  it('酒店名缺失不阻断——定位靠 ID，名字只做展示', async () => {
    const outcome = await ctripHotelProbe.probe(
      credentialWith({ masterHotelId: '85068938', hotelName: null }),
      NO_PAGE,
    );

    expect(outcome).toEqual({
      kind: 'found',
      hotels: [{ otaHotelId: '85068938', otaHotelName: null, bindExtra: null }],
    });
  });

  it('credentialExtra 为 null 时返回 none', async () => {
    expect(await ctripHotelProbe.probe(credentialWith(null), NO_PAGE)).toEqual({ kind: 'none' });
  });
});
