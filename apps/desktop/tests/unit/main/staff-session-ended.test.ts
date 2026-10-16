import { describe, expect, it, vi } from 'vitest';
import { createStaffSessionEndedHandler } from '../../../src/main/composition/staff-session-ended';

describe('createStaffSessionEndedHandler', () => {
  it('stops session work, closes the internal page and notifies the renderer', () => {
    const stopHeartbeat = vi.fn();
    const closeInternalPage = vi.fn();
    const notifyRenderer = vi.fn();
    const endSession = createStaffSessionEndedHandler({
      stopHeartbeat,
      closeInternalPage,
      notifyRenderer,
    });

    endSession();

    expect(stopHeartbeat).toHaveBeenCalledOnce();
    expect(closeInternalPage).toHaveBeenCalledOnce();
    expect(notifyRenderer).toHaveBeenCalledWith();
  });

  it('still notifies the renderer when closing the internal page fails', () => {
    const notifyRenderer = vi.fn();
    const endSession = createStaffSessionEndedHandler({
      stopHeartbeat: vi.fn(),
      closeInternalPage: () => {
        throw new Error('tab unavailable');
      },
      notifyRenderer,
    });

    expect(endSession).toThrow('tab unavailable');
    expect(notifyRenderer).toHaveBeenCalledOnce();
  });
});
