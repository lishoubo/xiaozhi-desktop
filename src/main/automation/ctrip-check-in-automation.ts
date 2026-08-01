import { WebContentsView, type Session } from 'electron';
import type { CtripCheckInResult } from '../../shared/automation';
import type { AppLogger } from '../../shared/logging';

const CTRIP_HOME_URL = 'https://www.ctrip.com/';
const LOOKUP_ERROR_MESSAGE = '暂时未获取到携程入住时间，请稍后重试';

const CHECK_IN_EXPRESSION = `
  new Promise((resolve) => {
    const readCheckIn = () => {
      const element = document.getElementById('checkIn');
      if (!element) return '';
      const text = element.textContent?.trim() ?? '';
      const value = 'value' in element && typeof element.value === 'string'
        ? element.value.trim()
        : '';
      const placeholder = element.getAttribute('placeholder')?.trim() ?? '';
      return text || value || placeholder;
    };

    const initialValue = readCheckIn();
    if (initialValue) {
      resolve(initialValue);
      return;
    }

    const interval = setInterval(() => {
      const value = readCheckIn();
      if (!value) return;
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(value);
    }, 100);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve(null);
    }, 15000);
  })
`;

function isAllowedCtripUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'ctrip.com' || parsed.hostname.endsWith('.ctrip.com'))
    );
  } catch {
    return false;
  }
}

function evaluationValue(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const remoteObject = Reflect.get(response, 'result');
  if (!remoteObject || typeof remoteObject !== 'object') return null;
  const value = Reflect.get(remoteObject, 'value');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export class CtripCheckInAutomation {
  private view: WebContentsView | null = null;
  private result: Promise<CtripCheckInResult> | null = null;

  constructor(
    private readonly browserSession: Session,
    private readonly logger: AppLogger,
  ) {}

  start(): Promise<CtripCheckInResult> {
    this.result ??= this.run();
    return this.result;
  }

  destroy(): void {
    this.releaseView();
  }

  private async run(): Promise<CtripCheckInResult> {
    this.logger.info('Ctrip check-in lookup started');
    try {
      const view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          session: this.browserSession,
        },
      });
      this.view = view;
      this.bindSecurityHandlers(view);

      await view.webContents.loadURL(CTRIP_HOME_URL);
      view.webContents.debugger.attach('1.3');
      const response: unknown = await view.webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: CHECK_IN_EXPRESSION,
        awaitPromise: true,
        returnByValue: true,
      });
      const checkIn = evaluationValue(response);
      if (!checkIn) throw new Error('CheckInUnavailable');

      this.logger.info('Ctrip check-in lookup completed');
      return { ok: true, checkIn };
    } catch (error) {
      this.logger.warn('Ctrip check-in lookup failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { ok: false, message: LOOKUP_ERROR_MESSAGE };
    } finally {
      this.releaseView();
    }
  }

  private bindSecurityHandlers(view: WebContentsView): void {
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedCtripUrl(url)) event.preventDefault();
    });
  }

  private releaseView(): void {
    const view = this.view;
    this.view = null;
    if (!view || view.webContents.isDestroyed()) return;
    if (view.webContents.debugger.isAttached()) view.webContents.debugger.detach();
    view.webContents.close();
  }
}
