export type DialogKind = 'alert' | 'confirm' | 'prompt';

/** 跨隔离世界的事件不能依赖 instanceof；只读取一个受限的类型字段。 */
export function dialogKindOf(event: Event): DialogKind | null {
  if (!('detail' in event)) return null;
  const kind: unknown = event.detail;
  return kind === 'alert' || kind === 'confirm' || kind === 'prompt' ? kind : null;
}

/** 在页面主世界观察原生对话框；事件只携带种类，绝不携带正文或输入。 */
export function installDialogObserver(eventName: string): void {
  const report = (kind: DialogKind): void => {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: kind }));
    } catch {
      // 网页可能改写这些全局对象；诊断失败不能阻止原生弹窗。
    }
  };

  const originalAlert = window.alert;
  const originalConfirm = window.confirm;
  const originalPrompt = window.prompt;

  window.alert = function (...args): void {
    report('alert');
    return originalAlert.apply(window, args);
  };
  window.confirm = function (...args): boolean {
    report('confirm');
    return originalConfirm.apply(window, args);
  };
  window.prompt = function (...args): string | null {
    report('prompt');
    return originalPrompt.apply(window, args);
  };
}
