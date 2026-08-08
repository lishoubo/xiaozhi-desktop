/**
 * OTA tab 模块的公开面。外部只应通过 `OtaTabService` 打开 OTA 标签页；
 * `LoginDetector` 由 composition root 装配，不是给业务调用的。
 */
export { OtaTabService, type OtaTabServiceDependencies } from './ota-tab-service';
export { LoginDetector, type LoginDetectorDependencies } from './login-detector';
