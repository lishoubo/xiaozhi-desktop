import type { BrowserCookieSource, BrowserCookieSourceId } from '../../shared/browser';
import chrome from '../assets/browser-icons/chrome.png';
import edge from '../assets/browser-icons/edge.png';
import firefox from '../assets/browser-icons/firefox.png';
import qq from '../assets/browser-icons/qq.png';
import safari from '../assets/browser-icons/safari.png';
import browser360 from '../assets/browser-icons/360.png';
import sogou from '../assets/browser-icons/sogou.png';

export const BROWSER_ICON_URLS: Readonly<Record<BrowserCookieSourceId, string>> = {
  chrome,
  edge,
  firefox,
  safari,
  qq,
  '360': browser360,
  sogou,
};

export const BROWSER_COOKIE_OPTIONS = [
  { id: 'chrome', name: 'Google Chrome' },
  { id: 'edge', name: 'Microsoft Edge' },
  { id: 'firefox', name: 'Mozilla Firefox' },
  { id: 'safari', name: 'Safari' },
  { id: 'qq', name: 'QQ 浏览器' },
  { id: '360', name: '360 安全浏览器' },
  { id: 'sogou', name: '搜狗高速浏览器' },
] as const satisfies readonly BrowserCookieSource[];
