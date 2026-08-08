/**
 * 开机自动化的启用判定。
 *
 * 这是 opt-in 而非 opt-out：默认不跑。
 *
 * 历史上这里用的是 `HOTEL_BUTLER_DISABLE_STARTUP_AUTOMATION`（默认开、显式关），
 * 意味着任何用户装上应用后，开机即在**全局共享 session** 上、**无业务上下文**、
 * **无人工审批**地对携程执行一次自动化操作。默认值站在了危险的一侧。
 *
 * 反转成 opt-in 后，「什么都不配置」的结果是「什么都不做」。
 */
export type StartupAutomationEnv = Readonly<{
  HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION?: string | undefined;
}>;

export function isStartupAutomationEnabled(env: StartupAutomationEnv): boolean {
  return env.HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION === '1';
}
