/**
 * 把随包分发的私有 CA 加进 **Node 全局** 信任链。
 *
 * ## 为什么需要它，而 `server-client/private-ca-trust.ts` 不够
 *
 * 那一份是给 Electron 的 `session.setCertificateVerifyProc` 用的，作用域是**单个
 * session**，而且按 hostname 精确匹配那一台 hotel-butler 服务器：
 *
 * ```
 * hotel-butler API ──▶ apiSession ──▶ setCertificateVerifyProc ✅ 已信任
 * Sentry 上报       ──▶ Node net/tls ─▶ 全局信任链          ❌ 不经过上面那条
 * ```
 *
 * Sentry SDK 走的是 Node 侧的 `https`，压根不经过 Electron 的 session 校验钩子。
 * 两台服务器 CA 相同也没用——**不是同一条信任路径**。
 *
 * ## 为什么不用 `rejectUnauthorized: false`
 *
 * 上报内容含渠道 cookie 与酒店经营数据，关掉校验等于对中间人明文裸奔。服务端接入
 * 方案里也明确禁止。所以这里是"多信任一个 CA"，不是"不校验"。
 *
 * ## 副作用范围
 *
 * `NODE_EXTRA_CA_CERTS` 只能在进程启动前设置，此刻已经晚了，所以改用 `tls` 的
 * 全局默认证书列表。影响的是主进程内**所有** Node 侧 HTTPS 请求——这是本方案自觉
 * 接受的代价：加入的是一份我们自己签发、随包分发的 CA，不降低对公网站点的校验强度
 * （公网证书仍需链到系统根 CA），只是额外认了自家这一个。
 */
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import type { AppLogger } from '../../shared/logging';

/**
 * ⚠️ 幂等：重复调用不会把同一份 CA 叠加进列表。主进程理论上只初始化一次，但
 * 单测与将来可能的重入都不该把列表撑大。
 */
export function trustPrivateCaGlobally(caPem: string, logger: AppLogger): void {
  let fingerprint: string;
  try {
    fingerprint = new X509Certificate(caPem).fingerprint256;
  } catch (error) {
    // 证书解析不了就不装：这不该拦住应用启动，但要留痕，否则上报静默失败极难查。
    logger.warn('Private CA could not be parsed; global trust not installed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const existing = tls.rootCertificates;
  const current = globalThis.__xiaozhiTrustedCaFingerprints__ ?? new Set<string>();
  if (current.has(fingerprint)) return;
  current.add(fingerprint);
  globalThis.__xiaozhiTrustedCaFingerprints__ = current;

  // `setDefaultCACertificates` 是 Node 22.15+ / 23.5+ 才有的 API。Electron 43 带的
  // Node 满足，但仍做能力检测——缺了就降级为不装，而不是启动即崩。
  const setDefault = (
    tls as unknown as { setDefaultCACertificates?: (certs: readonly string[]) => void }
  ).setDefaultCACertificates;
  if (typeof setDefault !== 'function') {
    logger.warn('tls.setDefaultCACertificates is unavailable; error reports may fail TLS');
    return;
  }

  setDefault([...existing, caPem]);
  logger.info('Private CA trusted globally for error reporting');
}

declare global {
  // eslint-disable-next-line no-var
  var __xiaozhiTrustedCaFingerprints__: Set<string> | undefined;
}
