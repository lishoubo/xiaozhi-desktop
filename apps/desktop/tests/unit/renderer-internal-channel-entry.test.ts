import { describe, expect, it } from 'vitest';
import {
  BINDABLE_CHANNEL_IDS,
  OTA_CHANNELS,
  WORKSPACE_CHANNEL_IDS,
  isOtaChannelWithUrl,
} from '../../src/renderer/data/ota-channels';

const INTERNAL_ID = 'xiaozhi';

/**
 * 内部页面条目与 OTA 渠道的隔离。
 *
 * `OTA_CHANNELS` 同时承担两个角色：工作区入口的数据源，以及「渠道 id → 中文名」的
 * 字典（酒店卡片、重认弹窗、cookie 列表都用 `.find()` 反查它）。内部页面必须留在
 * 字典里（否则工作区右上角显示"未选择渠道"），又必须不出现在那些**只该列 OTA 账号**
 * 的地方 —— 这组用例守的就是这条边界。
 */
describe('内部页面渠道条目', () => {
  const internal = OTA_CHANNELS.find((channel) => channel.id === INTERNAL_ID);

  it('存在于 OTA_CHANNELS 字典中', () => {
    // 缺了它，`activeChannel` 为 undefined，工作区右上角会显示"未选择渠道"。
    expect(internal).toBeDefined();
    expect(internal?.kind).toBe('internal');
  });

  it('展示在工作区入口且位于首位', () => {
    expect(WORKSPACE_CHANNEL_IDS[0]).toBe(INTERNAL_ID);
  });

  it('不出现在可绑定渠道中', () => {
    // 内部页面没有渠道账号可绑，出现在绑定候选里会让用户点进一条走不完的流程。
    expect(BINDABLE_CHANNEL_IDS).not.toContain(INTERNAL_ID);
  });

  it('不被 isOtaChannelWithUrl 命中', () => {
    // 这个守卫是「历史绑定记录反查」「新建登录」「cookie 导入」几条路的共同入口，
    // 内部页面被它排除，就等于同时从那几处消失了。
    expect(internal && isOtaChannelWithUrl(internal)).toBe(false);
  });

  it('不持有落地地址', () => {
    // URL 由主进程拼（要带访问令牌）。渲染进程持有它就意味着令牌可能流到渲染层。
    expect(internal?.url).toBeUndefined();
  });
});

describe('OTA 渠道条目', () => {
  const otaChannels = OTA_CHANNELS.filter((channel) => channel.id !== INTERNAL_ID);

  it('全部标记为 ota 且都有落地地址', () => {
    for (const channel of otaChannels) {
      expect(channel.kind).toBe('ota');
      expect(isOtaChannelWithUrl(channel)).toBe(true);
    }
  });

  it('可绑定渠道全部是 OTA', () => {
    for (const id of BINDABLE_CHANNEL_IDS) {
      const channel = OTA_CHANNELS.find((item) => item.id === id);
      expect(channel?.kind).toBe('ota');
    }
  });

  /** 历史绑定记录靠 `source` 反查中文名；被内部页面挡住会退化成裸 id。 */
  it('历史 source 反查不会命中内部页面', () => {
    const historicalSources = ['ctrip', 'douyin', 'meituan', 'fliggy'];
    for (const source of historicalSources) {
      const channel = OTA_CHANNELS.filter(isOtaChannelWithUrl).find((item) => item.id === source);
      expect(channel).toBeDefined();
      expect(channel?.id).not.toBe(INTERNAL_ID);
    }
  });
});
