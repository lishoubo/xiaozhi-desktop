import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const views: MockWebContentsView[] = [];
  let evaluationResult: unknown = {
    result: { type: 'string', value: '8月1日' },
  };

  class MockWebContentsView {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly debugger = {
      attach: vi.fn(),
      detach: vi.fn(),
      isAttached: vi.fn(() => true),
      sendCommand: vi.fn(async () => evaluationResult),
    };
    readonly webContents = {
      close: vi.fn(),
      debugger: this.debugger,
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        this.handlers.set(event, listener);
      }),
      setWindowOpenHandler: vi.fn(),
    };

    constructor(readonly options: unknown) {
      views.push(this);
    }
  }

  return {
    MockWebContentsView,
    setEvaluationResult: (result: unknown) => {
      evaluationResult = result;
    },
    views,
  };
});

vi.mock('electron', () => ({ WebContentsView: electron.MockWebContentsView }));

import { CtripCheckInAutomation } from '../../../../src/main/startup/ctrip-check-in';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  electron.views.splice(0);
  electron.setEvaluationResult({ result: { type: 'string', value: '8月1日' } });
});

describe('CtripCheckInAutomation', () => {
  it('loads Ctrip without a visible view and reads checkIn through in-process CDP', async () => {
    const browserSession = {};
    const logger = createLogger();
    const automation = new CtripCheckInAutomation(browserSession as never, logger);

    await expect(automation.start()).resolves.toEqual({ ok: true, checkIn: '8月1日' });

    const view = electron.views[0];
    expect(view.options).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: browserSession,
      },
    });
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://www.ctrip.com/');
    expect(view.debugger.attach).toHaveBeenCalledWith('1.3');
    expect(view.debugger.sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({
        awaitPromise: true,
        returnByValue: true,
        expression: expect.stringContaining("getElementById('checkIn')"),
      }),
    );
    expect(view.debugger.detach).toHaveBeenCalledOnce();
    expect(view.webContents.close).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls).toEqual([
      ['Ctrip check-in lookup started'],
      ['Ctrip check-in lookup completed'],
    ]);
  });

  it('returns a safe error and releases the hidden view when the element is unavailable', async () => {
    electron.setEvaluationResult({ result: { type: 'object', value: null } });
    const logger = createLogger();
    const automation = new CtripCheckInAutomation({} as never, logger);

    await expect(automation.start()).resolves.toEqual({
      ok: false,
      message: '暂时未获取到携程入住时间，请稍后重试',
    });

    expect(logger.warn).toHaveBeenCalledWith('Ctrip check-in lookup failed', {
      errorName: 'Error',
    });
    expect(electron.views[0].webContents.close).toHaveBeenCalledOnce();
  });
});
