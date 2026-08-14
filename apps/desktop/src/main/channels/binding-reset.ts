/**
 * 绑定前的「选择记忆」重置 —— 渠道声明要清掉哪些 localStorage 键。
 *
 * ## 为什么需要它
 *
 * 绑定流程要求用户**这一次**重新选门店。但渠道会记住上次的选择：抖音把
 * `core:PoiSwitch:poi_<poiId>_<uuid>` 写进 localStorage，下次进来直接跳过选公司页、
 * 落到上次那家门店 —— 一个账号管多家门店时，第二家就绑不了了。
 *
 * 此前的解法是**每次绑定新开一份 partition**（`openExistingInFreshPartition`），
 * 把 cookie 搬过去、把 localStorage 甩掉。代价是每绑一次泄漏一份 partition，
 * 且 cookie 搬运本身可能丢字段。改成原地删键之后，partition 复用、cookie 零搬运。
 *
 * ## 为什么按前缀删键，而不是 `clearStorageData({storages:['localstorage']})`
 *
 * 那个 API 会清掉该渠道**全部** localStorage（埋点、AB 配置、微前端缓存都在里面），
 * 副作用不可控 —— 万一渠道把登录相关状态也放在那儿，就变成掉登录态。按前缀删只碰
 * 那一条选择记忆，代价是依赖键名（渠道改名即失效），因此**必须记日志**：删了 0 个
 * 而绑定又跳过了选店页，日志是唯一能指认「键名变了」的线索。
 *
 * ## 渠道差异
 *
 * 只有抖音有这种「上次选的门店」页面。携程与美团的后台没有选店步骤，
 * 因此不注册前缀 —— 不注册即不执行，连脚本都不注入。
 */
import type { ChannelId } from '../ids';

/**
 * 抖音：`core:PoiSwitch:poi_7202809170041505832_104680039472`
 * 形如 `core:PoiSwitch:poi_<门店 poiId>_<账号 uuid>`，一个账号一条。
 * 真机踩点见 `openspec/changes/ota-tab-entry-and-partition-lifecycle/design.md` §3.1.1。
 */
const DOUYIN_SELECTION_KEY_PREFIXES = ['core:PoiSwitch:'] as const;

const PREFIXES_BY_CHANNEL: ReadonlyMap<string, readonly string[]> = new Map([
  ['douyin', DOUYIN_SELECTION_KEY_PREFIXES],
]);

/** 该渠道在绑定前要清的 localStorage 键前缀；没有则返回空数组。 */
export function bindingResetKeyPrefixes(channel: ChannelId): readonly string[] {
  return PREFIXES_BY_CHANNEL.get(channel) ?? [];
}

/**
 * 生成删键脚本。返回被删的键名数组，供调用方记日志。
 *
 * 用 `JSON.stringify` 注入前缀而不是模板拼接：前缀虽是本地常量，但拼进 JS 源码前
 * 转义是硬要求 —— 这段字符串会被 `executeJavaScript` 当代码执行。
 */
export function removeSelectionKeysExpression(prefixes: readonly string[]): string {
  return `
    (() => {
      try {
        const prefixes = ${JSON.stringify(prefixes)};
        const removed = [];
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i);
          if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
            localStorage.removeItem(key);
            removed.push(key);
          }
        }
        return removed;
      } catch (error) {
        return null;
      }
    })()
  `;
}
