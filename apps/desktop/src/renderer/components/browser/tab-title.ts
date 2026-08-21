/**
 * 标签页显示什么文字 —— 标签栏、tooltip、以及引用标题的辅助文本（如
 * 「关闭 xxx」）**共用这一个来源**。
 *
 * ## 为什么单独一个文件
 *
 * 此前标题直接取 `tab.title`，界面上有三处各自拼字符串，其中「关闭 ${tab.title}」
 * 在加载中会读成「关闭 正在加载…」——占位文字被当成了真标题。收到一处之后，
 * 占位、故障、清洗规则只有一份定义。
 *
 * ## 为什么放渲染进程而不是主进程
 *
 * 清洗规则是**渠道知识**，而 `main/browser/` 不认识任何渠道（分层约束）。为一个
 * 纯展示问题去拉一条主进程跨层依赖不划算。这里与 `renderer/data/ota-channels.ts`
 * 同层，且是纯函数，可直接测。
 */
import type { BrowserTab } from '../../../shared/browser';

/**
 * 各渠道后台标题里的固定冗余部分。截断后剩下的文字必须还有区分度——渠道后台
 * 常把「-携程酒店eBooking」这类后缀挂在每个页面上，不清掉的话，几个标签页截断后
 * 长得一模一样。
 *
 * ⚠️ 规则按**真机实测**的 `document.title` 补充，不要凭渠道名猜。空表是合法的
 * 初始状态（等价于不清洗），逐渠道补即可。
 */
const CHANNEL_TITLE_SUFFIXES: Readonly<Record<string, readonly RegExp[]>> = {
  ctrip: [/\s*[-—|]\s*携程.*$/u],
  meituan: [/\s*[-—|]\s*美团.*$/u],
  'meituan-minsu': [/\s*[-—|]\s*美团.*$/u],
  douyin: [/\s*[-—|]\s*抖音.*$/u],
};

/** 加载中且还没拿到标题时的占位。 */
const LOADING_PLACEHOLDER = '正在加载…';

const FAILURE_LABELS: Readonly<Record<NonNullable<BrowserTab['failure']>, string>> = {
  crashed: '页面已崩溃',
  'load-failed': '页面加载失败',
  unresponsive: '页面无响应',
};

/**
 * 去掉渠道后缀。清洗后为空说明整个标题就是后缀本身（渠道首页常见），
 * 此时保留原标题——空标签比带后缀的标签更糟。
 */
function stripChannelSuffix(title: string, channelId: string): string {
  const patterns = CHANNEL_TITLE_SUFFIXES[channelId] ?? [];
  let cleaned = title;
  for (const pattern of patterns) cleaned = cleaned.replace(pattern, '');
  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : title.trim();
}

/**
 * 标签页该显示的文字。故障态优先于标题：页面崩了还显示崩溃前的标题，用户无从
 * 判断自己看到的是什么。
 */
export function displayTabTitle(tab: BrowserTab): string {
  if (tab.failure) return FAILURE_LABELS[tab.failure];
  const title = tab.title.trim();
  if (title.length === 0) return LOADING_PLACEHOLDER;
  return stripChannelSuffix(title, tab.channelId);
}
