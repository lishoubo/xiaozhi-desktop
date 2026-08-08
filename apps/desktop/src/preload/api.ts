/**
 * 暴露给渲染进程的 API 门面 —— 只做组装，每个 namespace 的实现在
 * `namespaces/` 下各自一个文件。
 *
 * `DesktopApi` 由实现推导（`ReturnType`），不再手写一份大类型：手写的那份
 * 需要和实现逐字段同步，改一处漏一处就会静默失配。
 */
import {
  createValidatedInvoke,
  createValidatedSubscribe,
  type Invoke,
  type Subscribe,
} from './invoke';
import { createAuthApi } from './namespaces/auth';
import { createBrowserApi } from './namespaces/browser';
import { createCalendarApi } from './namespaces/calendar';
import { createCookiesApi } from './namespaces/cookies';
import { createHotelManagementApi } from './namespaces/hotel-management';
import { createOtaCredentialApi } from './namespaces/ota-credential';
import { createOtaTabApi } from './namespaces/ota-tab';
import { createSystemApi } from './namespaces/system';

type RuntimeVersions = Readonly<{
  chrome: string;
  electron: string;
  node: string;
}>;

export function createDesktopApi(
  versions: RuntimeVersions,
  invoke: Invoke,
  subscribe: Subscribe = () => () => undefined,
) {
  const validatedInvoke = createValidatedInvoke(invoke);
  const validatedSubscribe = createValidatedSubscribe(subscribe);

  return Object.freeze({
    auth: createAuthApi(validatedInvoke),
    browser: createBrowserApi(validatedInvoke, validatedSubscribe),
    calendar: createCalendarApi(validatedInvoke),
    cookies: createCookiesApi(validatedInvoke),
    hotelManagement: createHotelManagementApi(validatedInvoke, validatedSubscribe),
    otaCredential: createOtaCredentialApi(validatedInvoke, validatedSubscribe),
    otaTab: createOtaTabApi(validatedInvoke),
    system: createSystemApi(validatedInvoke),
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
  });
}

export type DesktopApi = ReturnType<typeof createDesktopApi>;
