/**
 * `app-env-profiles.mjs` 的类型声明。
 *
 * 表本身是 `.mjs`，因为打包/清理脚本（裸 Node，没有 TS 编译步骤）要直接 import 它；
 * 类型在这里补上，让 `app-env.ts` 与 `forge.config.ts` 侧仍是强类型。
 */
export type AppEnvironment = 'dev' | 'pre' | 'online';

export type EnvironmentProfile = Readonly<{
  productName: string;
  bundleId: string;
  squirrelName: string;
  rmsOrigin: string | null;
  serverOrigin: string | null;
  sentryDsn: string | null;
}>;

export declare const ENVIRONMENTS: readonly AppEnvironment[];
export declare const DEFAULT_ENVIRONMENT: AppEnvironment;
export declare const PROFILES: Readonly<Record<AppEnvironment, EnvironmentProfile>>;

export declare function isAppEnvironment(value: string): value is AppEnvironment;
export declare function resolveAppEnvironment(environment?: NodeJS.ProcessEnv): AppEnvironment;
export declare function environmentProfile(environment?: NodeJS.ProcessEnv): EnvironmentProfile;
