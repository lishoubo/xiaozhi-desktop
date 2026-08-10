/**
 * rms-server 的业务错误码（`ErrorCode.java`）。只收录本模块会遇到的那几个，
 * 不镜像整张表——用不到的码留在 RMS 侧，避免两边各维护一份枚举。
 */
export const RMS_ERROR = {
  invalidParameter: 10001,
  unauthorized: 10002,
  usernameOrPasswordInvalid: 11002,
  accountLocked: 11003,
  tokenExpired: 11004,
  tokenInvalid: 11005,
  refreshTokenInvalid: 11006,
} as const;

/** access token 失效——调用方应据此触发一次 refresh，而不是直接把用户踢回登录页。 */
export function isAccessTokenRejected(code: number): boolean {
  return code === RMS_ERROR.tokenExpired || code === RMS_ERROR.tokenInvalid;
}

export class RmsAuthError extends Error {
  constructor(
    readonly code: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RmsAuthError';
  }
}

/**
 * 错误码 → 用户可读文案。
 *
 * 与旧 `AuthService.safeCall` 的差别：**不把所有失败压成同一句话**。
 * "账号已被锁定"和"用户名或密码错误"对用户是完全不同的行动指引。
 */
export function messageForRmsError(code: number, fallback: string): string {
  switch (code) {
    case RMS_ERROR.usernameOrPasswordInvalid:
      return '用户名或密码错误';
    case RMS_ERROR.accountLocked:
      // RMS 的锁定标记无 TTL、不会自动解锁（见 RmsSecurityProperties.Lockout），
      // 所以不能写"稍后再试"。
      return '账号已被锁定，请联系管理员';
    case RMS_ERROR.refreshTokenInvalid:
    case RMS_ERROR.unauthorized:
      return '登录已过期，请重新登录';
    case RMS_ERROR.invalidParameter:
      return '请检查用户名和密码';
    default:
      return fallback;
  }
}
