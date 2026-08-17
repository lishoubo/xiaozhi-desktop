/**
 * 重新进入浏览器工作区时该激活哪个标签页 —— **用户上次看的那个**。
 *
 * ## 为什么需要它
 *
 * 离开工作区时会 `browser.hide()`，主进程的内容区被清空；而标签栏是渲染进程的本地
 * 状态，仍然画着。回来时必须重新 activate 一次，否则「标签在、内容区空白，手动点一下
 * 标签才出来」。
 *
 * 挂载时原本固定去找 `OTA_CHANNELS[0]`（携程）的标签页，这带来两个真机现象：
 *
 * ```
 * 只开了美团        找不到携程标签 → 一次 activate 都不发 → 内容区空白
 * 携程+美团都开着   总是激活携程   → 用户明明在看美团，回来跳到携程
 * ```
 *
 * `activeChannelId` / `activeTabIds` 在离开工作区时并不复位（`releaseViewportSession`
 * 只复位让位闸门），所以「上次看的是谁」这个事实本来就还在，之前只是没拿来用。
 *
 * ## 三级回退
 *
 * ```
 * 1. 上次激活的那个标签页还在      → 就是它
 * 2. 不在了，但上次那个渠道还有别的 → 同渠道的第一个（关掉当前标签后回来）
 * 3. 该渠道一个都不剩              → 任意一个已打开的
 * ```
 *
 * 第 3 级是有意的：空白内容区比「激活了另一个渠道」更糟——后者至少看得见东西，
 * 且标签栏会同步高亮，用户知道自己在哪。
 *
 * 与 store 分开是因为这是一条**可穷举测试的纯规则**，而 store 用了 Svelte runes，
 * 在 node 测试环境里跑不起来。
 */
import type { BrowserTab } from '../../../shared/browser';

export function pickRestoreTarget(
  tabs: readonly BrowserTab[],
  lastActiveChannelId: string,
  lastActiveTabId: string | undefined,
): BrowserTab | undefined {
  if (tabs.length === 0) return undefined;
  return (
    tabs.find((tab) => tab.id === lastActiveTabId) ??
    tabs.find((tab) => tab.channelId === lastActiveChannelId) ??
    tabs[0]
  );
}
