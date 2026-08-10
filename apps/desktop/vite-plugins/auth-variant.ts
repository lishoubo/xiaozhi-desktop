/**
 * 构建变体开关：决定这个包里装哪一套登录。
 *
 * 三个 vite config（main / preload / renderer）是三次独立的 Rollup 构建，`define`
 * 是每次构建各自的编译期替换，没有跨构建共享的机制——所以三处都得挂一次本插件。
 * 把取值、校验、注入收在这里，是为了让"合法值清单"和"拼错怎么办"只有一份。
 *
 * 用 `define` 而非 `import.meta.env`：前者是字面量替换，`__AUTH_VARIANT__ === 'staff'`
 * 会被折叠成常量，Rollup 的 DCE 才能把未选中那套连同其 import 一起摇掉。
 */
import type { Plugin } from 'vite';

const VARIANTS = ['staff', 'phone'] as const;

export type AuthVariant = (typeof VARIANTS)[number];

const DEFAULT_VARIANT: AuthVariant = 'staff';

function isAuthVariant(value: string): value is AuthVariant {
  return (VARIANTS as readonly string[]).includes(value);
}

export function resolveAuthVariant(environment: NodeJS.ProcessEnv = process.env): AuthVariant {
  const raw = environment.XIAOZHI_AUTH_VARIANT;
  if (raw === undefined || raw === '') return DEFAULT_VARIANT;
  if (!isAuthVariant(raw)) {
    // 不做默认回退：静默回退会打出一个"看起来正常、却装错登录"的包，比构建失败危险得多。
    throw new Error(`XIAOZHI_AUTH_VARIANT 取值非法: ${raw}（可选 ${VARIANTS.join(' | ')}）`);
  }
  return raw;
}

/** 三个 vite config 共用，确保 main / preload / renderer 拿到同一个值。 */
export function authVariantDefine(): Plugin {
  const variant = resolveAuthVariant();
  return {
    name: 'xiaozhi-auth-variant',
    config: () => ({
      define: { __AUTH_VARIANT__: JSON.stringify(variant) },
    }),
  };
}
