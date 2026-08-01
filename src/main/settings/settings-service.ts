import type { AppSetting, JsonValue, SetAppSettingInput } from '../../shared/settings';
import type { AppLogger } from '../../shared/logging';

type SettingsStore = Readonly<{
  list: () => AppSetting[];
  get: (key: string) => AppSetting | null;
  set: (key: string, value: JsonValue) => AppSetting;
  delete: (key: string) => boolean;
}>;

const MAX_KEY_LENGTH = 128;

function validateKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('设置项 key 必须是字符串');
  }

  const key = value.trim();
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new RangeError(`设置项 key 的长度必须在 1 到 ${MAX_KEY_LENGTH} 之间`);
  }

  return key;
}

function validateJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('设置项 value 必须是可序列化的 JSON 值');
  }

  return JSON.parse(serialized) as JsonValue;
}

function validateSetInput(input: unknown): SetAppSettingInput {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('设置项参数无效');
  }

  const candidate = input as Record<string, unknown>;
  return {
    key: validateKey(candidate.key),
    value: validateJsonValue(candidate.value),
  };
}

export class SettingsService {
  public constructor(
    private readonly repository: SettingsStore,
    private readonly logger: AppLogger,
  ) {}

  public list(): AppSetting[] {
    return this.repository.list();
  }

  public get(key: unknown): AppSetting | null {
    return this.repository.get(validateKey(key));
  }

  public set(input: unknown): AppSetting {
    const setting = validateSetInput(input);
    const saved = this.repository.set(setting.key, setting.value);
    this.logger.info('Application setting updated');
    return saved;
  }

  public delete(key: unknown): boolean {
    const deleted = this.repository.delete(validateKey(key));
    this.logger.info('Application setting deleted', { deleted });
    return deleted;
  }
}
