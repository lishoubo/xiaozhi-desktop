import { describe, expect, it, vi } from 'vitest';
import { createWaitingUiResult } from '../../src/renderer/waiting-ui-result';
import type { UiWaitingResultEnvelope } from '../../src/shared/types/ui-waiting-result-types';

function setup() {
  let deliver: (envelope: UiWaitingResultEnvelope) => void = () => undefined;
  const unsubscribe = vi.fn();
  const waiting = createWaitingUiResult((listener) => {
    deliver = listener;
    return unsubscribe;
  });
  return { waiting, deliver: (e: UiWaitingResultEnvelope) => deliver(e), unsubscribe };
}

function envelope(requestId: string): UiWaitingResultEnvelope {
  return {
    requestId,
    kind: 'bind-hotel',
    payload: {
      credentialId: 'credential-1',
      hotels: [{ otaHotelId: 'dy-111', otaHotelName: '测试酒店', bindExtra: null }],
    },
  };
}

describe('createWaitingUiResult', () => {
  it('requestId 匹配时回调，并拿到 payload', () => {
    const { waiting, deliver } = setup();
    const onResult = vi.fn();

    waiting.await('bind-hotel', 'req-1', onResult);
    deliver(envelope('req-1'));

    expect(onResult).toHaveBeenCalledWith(envelope('req-1').payload);
  });

  it('requestId 不匹配时忽略', () => {
    const { waiting, deliver } = setup();
    const onResult = vi.fn();

    waiting.await('bind-hotel', 'req-1', onResult);
    deliver(envelope('req-other'));

    expect(onResult).not.toHaveBeenCalled();
  });

  it('结果送达后自动清除，同一 requestId 再来不重复回调', () => {
    const { waiting, deliver } = setup();
    const onResult = vi.fn();

    waiting.await('bind-hotel', 'req-1', onResult);
    deliver(envelope('req-1'));
    deliver(envelope('req-1'));

    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('cancel() 后不再回调（用户放弃或组件卸载）', () => {
    const { waiting, deliver } = setup();
    const onResult = vi.fn();

    const cancel = waiting.await('bind-hotel', 'req-1', onResult);
    cancel();
    deliver(envelope('req-1'));

    expect(onResult).not.toHaveBeenCalled();
  });

  it('多个等待并存，各自认领各自的结果', () => {
    const { waiting, deliver } = setup();
    const first = vi.fn();
    const second = vi.fn();

    waiting.await('bind-hotel', 'req-1', first);
    waiting.await('bind-hotel', 'req-2', second);
    deliver(envelope('req-2'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('dispose() 退订底层通道', () => {
    const { waiting, unsubscribe } = setup();

    waiting.dispose();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
