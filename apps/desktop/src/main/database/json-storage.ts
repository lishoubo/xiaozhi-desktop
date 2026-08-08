import type { JsonObject, JsonValue } from '../../shared/types/json';

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === 'object' && isJsonValue(value);
}

export function parseJsonObject(value: string | null, field: string): JsonObject | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${field} 不是合法 JSON`, { cause: error });
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${field} 必须是 JSON object`);
  }
  return parsed;
}

export function serializeJsonObject(value: JsonObject | null): string | null {
  return value === null ? null : JSON.stringify(value);
}
