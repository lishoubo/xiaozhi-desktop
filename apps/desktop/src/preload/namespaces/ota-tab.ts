import { browserTabSchema, type OtaTabIntentDto, type StartLoginInput } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createOtaTabApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    /** `intent` 说明这次打开是为了做什么；不带则只是普通打开。 */
    openExisting: (credentialId: string, intent?: OtaTabIntentDto) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openExisting, credentialId, intent),
    /**
     * 同 `openExisting`，但换一份干净 partition、只把 cookie 注入过去。
     * 绑定流程用它，好让渠道重新问一次「要操作哪家门店」。
     *
     * 为什么必须新建 partition（本地存储清理三条路都实测无效），见主进程侧
     * `OtaTabService.openExistingForBinding` 的注释。
     */
    openExistingForBinding: (credentialId: string, intent?: OtaTabIntentDto) =>
      invoke(
        browserTabSchema,
        IPC_CHANNELS.otaTab.openExistingForBinding,
        credentialId,
        intent,
      ),
    /** `intent` 同 `openExisting`：绑定入口的「新登录账号」带意图走这条路。 */
    openForNewLogin: (input: StartLoginInput, intent?: OtaTabIntentDto) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openForNewLogin, input, intent),
    /** `intent` 同上：绑定入口走「已导入 Cookie」这条路时照样要探测门店。 */
    openWithImportedCookie: (input: StartLoginInput, intent?: OtaTabIntentDto) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openWithImportedCookie, input, intent),
  });
}
