export type BrowserBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type BrowserTab = Readonly<{
  id: string;
  channelId: string;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}>;

export type BrowserCookieSourceId = 'chrome' | 'edge' | 'firefox' | 'safari';

export type BrowserCookieSource = Readonly<{
  id: BrowserCookieSourceId;
  name: string;
}>;

export type CookieImportResult = Readonly<{
  imported: number;
  failed: number;
  error?: string;
}>;

export type SystemPreferences = Readonly<{
  autoLaunch: boolean;
  version: string;
}>;
