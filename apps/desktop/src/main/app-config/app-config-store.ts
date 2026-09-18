/**
 * 配置的读取与合并。
 *
 * 优先级见 `types.ts`：内置默认值 → 服务端下发 → 本地覆盖，后者覆盖前者。
 *
 * **本期只有默认值层真正接了来源**，其余两层留着接口：构造时不传 `sources` 即为纯默认值。
 * 这样将来接下发只需在 composition root 多传一个 source，本类与所有消费方都不用改。
 */
import { DEFAULT_APP_CONFIG } from './defaults';
import type { AppConfig, AppConfigSource, PartialAppConfig } from './types';

/**
 * 逐层深合并（只深一层 —— `AppConfig` 的结构就是「分组 → 标量」两层，不做通用递归）。
 *
 * ⚠️ 未被覆盖的键必须保留下层的值。写成 `{ ...base, ...patch }` 的浅合并会让「某一层只
 * 给了 `delayMs`」把同组的 `windowDays`/`timeoutMs` 整组抹成 undefined —— 类型上看不出来
 * （`Partial` 允许缺键），运行期才炸。
 */
function mergeConfig(base: AppConfig, patch: PartialAppConfig): AppConfig {
  // 按 base 的键遍历，而不是逐组手写 —— 手写版每加一个配置组都要改这里，
  // 漏改的表现是「新组的覆盖永远不生效」。键以 base 为准，覆盖层引入不了新键。
  //
  // 用泛型辅助函数逐键合并：直接在循环里写 `merged[key] = {...}` 时，TS 把 `key` 看成
  // 键的联合类型，于是值被推成**所有组的交集**而报错。泛型把单次调用的 K 钉死。
  const merged = {} as { -readonly [K in keyof AppConfig]: AppConfig[K] };
  const assign = <K extends keyof AppConfig>(key: K): void => {
    merged[key] = { ...base[key], ...(patch[key] ?? {}) };
  };
  for (const key of Object.keys(base) as (keyof AppConfig)[]) assign(key);
  return merged;
}

export class AppConfigStore {
  /**
   * @param sources 覆盖来源，**按优先级从低到高**排列。省略即纯默认值。
   */
  constructor(private readonly sources: readonly AppConfigSource[] = []) {}

  /**
   * 当前生效的配置。
   *
   * 每次调用都重新合并，而不是构造时算一次并缓存 —— 将来服务端下发是会在运行中变的，
   * 缓存会让下发后仍用旧值，而这种失效很难在日志里看出来。当前合并成本可以忽略。
   */
  get(): AppConfig {
    let config = DEFAULT_APP_CONFIG;
    for (const source of this.sources) {
      const patch = source.read();
      // null 与 {} 不同：前者是「这层没有意见」，后者是「这层明确给了空覆盖」。
      // 两者结果一样，但保留区别以免将来加日志时分不清。
      if (patch === null) continue;
      config = mergeConfig(config, patch);
    }
    return config;
  }
}
