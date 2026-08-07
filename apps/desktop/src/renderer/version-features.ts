/**
 * 版本特性开关：`VITE_VERSION_FEATURE` 环境变量是一段 JSON，形如
 * `{"name":"lishoubo_version","offFeatures":["auth"]}`——`name` 只用于
 * 日志/排查，各处业务代码不关心具体是哪个版本，只问
 * `isFeatureOff('auth')` 这类具名开关是否命中，避免版本名散落进各个文件。
 *
 * 未设置该变量（例如正式发行版）时一律返回 false，不影响默认行为。
 */
const rawConfig = import.meta.env.VITE_VERSION_FEATURE as string | undefined;

function parseOffFeatures(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { offFeatures?: unknown }).offFeatures)
    ) {
      return new Set();
    }
    return new Set(
      (parsed as { offFeatures: unknown[] }).offFeatures.filter(
        (feature): feature is string => typeof feature === 'string',
      ),
    );
  } catch {
    return new Set();
  }
}

const offFeatures = parseOffFeatures(rawConfig);

export function isFeatureOff(feature: string): boolean {
  return offFeatures.has(feature);
}
