/**
 * 进程入口 —— 只做 Electron 生命周期编排，不 new 任何业务对象。
 * 对象装配全部在 `composition/`：进程级看 `app-scope.ts`，窗口级看 `window-scope.ts`。
 */
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { APP_ENVIRONMENT, APP_PRODUCT_NAME } from '../shared/app-environment';
import { AUTH_PROFILE_DIRECTORY } from '../shared/auth-variant';
import { safeLogErrorDetails } from '../shared/logging';
import {
  configureDesktopLogDirectory,
  configureMainLogging,
} from './logging/configure-main-logging';
import { initializeErrorReporting } from './error-reporting/init-error-reporting';
import { configureNetworkPrivacy } from './security/network-privacy';
import { createAppScope, type AppScope } from './composition/app-scope';
import { createWindowScope, type WindowScope } from './composition/window-scope';
import { loadPackagedPrivateCa } from './server-client/private-ca-trust';
import { resolveRmsOrigin } from './staff-auth/rms-endpoint';

/**
 * ⚠️ **必须是本文件的第一条语句**：`app.getName()` 决定 userData 与日志目录，而
 * 下面的 `configureDesktopLogDirectory` 会读 `getPath('logs')`、`app-scope` 会取
 * userData。晚一步这两者就落到旧目录去了。
 *
 * 日志目录最终是 `<环境专属应用名>/<登录变体>/` —— 环境由这里的应用名决定，
 * 变体由 `configureDesktopLogDirectory` 再加一层子目录。
 *
 * 打包时 forge 的 `packagerConfig.name` 已经设了同一个值，这行是为了让 **dev 模式**
 * （`electron-forge start`，不经 packager）也拿到环境专属的应用名——否则 dev 会回落到
 * package.json 的 productName，与正式包共用目录。
 */
app.setName(APP_PRODUCT_NAME);

let appScope: AppScope | null = null;
let windowScope: WindowScope | null = null;

configureNetworkPrivacy(app.commandLine);
const logsDirectory = configureDesktopLogDirectory(app, AUTH_PROFILE_DIRECTORY);
configureMainLogging(log, {
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  logsDirectory,
  platform: process.platform,
});

/**
 * 尽早初始化：晚于此处发生的崩溃就上报不出去了。放在日志配置之后是有意的——上报本身
 * 出问题时（缺 DSN、CA 装不上）要有地方留痕。
 *
 * 私有 CA 读取失败不该拦住启动：`loadPackagedPrivateCa` 对显式指定却读不到会抛错
 * （那是打包命令写错了，必须暴露），但那条路径只在设了环境变量时触发。这里额外兜一层，
 * 是因为**上报是辅助能力，任何情况下都不该成为应用起不来的原因**。
 */
try {
  initializeErrorReporting({
    appVersion: app.getVersion(),
    privateCaPem: loadPackagedPrivateCa(app.isPackaged, process.resourcesPath, process.env),
    logger: log,
  });
} catch (error) {
  log.warn('Error reporting failed to initialize', { error: safeLogErrorDetails(error) });
}

// 排查任何问题的第一个问题都是「这装的是哪套环境、连的哪个后端」。三套包可并存安装，
// 光看应用名不足以确认后端地址，所以两者一起记。
log.info('Application environment', {
  appEnvironment: APP_ENVIRONMENT,
  rmsOrigin: resolveRmsOrigin(),
  userDataDir: app.getPath('userData'),
});

function openMainWindow(): void {
  if (!appScope) throw new Error('Application scope is not initialized');
  windowScope = createWindowScope(appScope);
}

function initializeApplication(): void {
  log.info('Application initialization started');
  appScope = createAppScope(log);
  openMainWindow();
  log.info('Application initialization completed');
  // 卫生工作，不挡启动路径：此刻还没有标签页占用任何 partition，是最安全的清理时机。
  void appScope.cleanupPartitionsOnStartup();
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(initializeApplication)
    .catch((error: unknown) => {
      // 启动失败是终局错误：应用马上就退出，用户只剩这一行日志可看，所以要连
      // message 与 stack 一并落盘（真机上出现过「errorName: 'Error'」这种毫无
      // 线索的记录）。`safeLogErrorDetails` 逐段脱敏，比手工摊平 stack 更安全。
      log.error('Application initialization failed', {
        error: safeLogErrorDetails(error),
      });
      app.quit();
    });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    openMainWindow();
  }
});

app.once('will-quit', () => {
  log.info('Application shutdown started');
  windowScope?.dispose();
  windowScope = null;
  appScope?.dispose();
  appScope = null;
  log.info('Application shutdown completed');
});
