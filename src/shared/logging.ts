const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|secret|token|authorization|cookie|credential|sessionid|apikey)/i;
const SENSITIVE_VALUE_PATTERN =
  /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|secret|session[_-]?id|api[_-]?key)\s*[:=]\s*)([^&\s,;]+)/gi;

export type LogMessageData = Readonly<{
  data: unknown[];
}>;

export type AppLogger = Readonly<{
  info: (...data: unknown[]) => unknown;
  warn: (...data: unknown[]) => unknown;
  error: (...data: unknown[]) => unknown;
}>;

export function redactLogData(data: unknown[]): unknown[] {
  const visited = new WeakSet<object>();

  return data.map((value) => redactValue(value, visited));
}

function redactValue(value: unknown, visited: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }

  if (value instanceof Error) {
    return { name: value.name };
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return '[Circular]';
    }

    visited.add(value);
    return value.map((item) => redactValue(item, visited));
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return '[Circular]';
    }

    visited.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redactValue(item, visited),
      ]),
    );
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.replaceAll(/[-_\s]/g, ''));
}

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(SENSITIVE_VALUE_PATTERN, `$1${REDACTED}`)
    .replace(/(cookie\s*:\s*)[^\r\n]+/gi, `$1${REDACTED}`);
}
