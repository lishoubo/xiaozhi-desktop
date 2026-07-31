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

export type CookieImportResult = Readonly<{
  cancelled: boolean;
  imported: number;
  failed: number;
}>;

export type SystemPreferences = Readonly<{
  autoLaunch: boolean;
  version: string;
}>;
