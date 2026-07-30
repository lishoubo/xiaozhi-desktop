export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AppSetting = Readonly<{
  key: string;
  value: JsonValue;
  createdAt: number;
  updatedAt: number;
}>;

export type SetAppSettingInput = Readonly<{
  key: string;
  value: JsonValue;
}>;
