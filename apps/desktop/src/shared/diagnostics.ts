/**
 * 内测诊断开关 —— 决定「原始错误详情」能不能下发到界面。
 *
 * 面向用户的失败提示一律是友好文案（措辞稳定、不含实现细节）。但内测阶段
 * 光有友好文案定位不了问题：文案会把不同根因归成同一句话，而真机上我们既
 * 不方便远程调试，也不能指望每次都拿到日志文件。开启后界面会在友好文案下
 * 附一份原始 message，测试同学截个图就够定位。
 *
 * ## ⚠️ 当前处于「全环境开启」状态
 *
 * 本来的判据是 `APP_ENVIRONMENT !== 'online'`——正式包不该把 powershell 报错
 * 和文件路径摊给真实客户看。2026-08-25 为排查 Windows cookie 导入失败，需要
 * 在 online 包上也拿到诊断，故临时放开。
 *
 * **Windows cookie 导入问题定位完成后，改回下面注释掉的那行。**
 *
 * 之所以留成一个独立常量而不是把条件直接写死在调用点：改回去只需要动这一行，
 * 不用去翻哪些地方消费了它。
 */
// import { APP_ENVIRONMENT } from './app-environment';

// 定位完成后恢复这行，并删掉下面的 `true`：
// export const DIAGNOSTICS_ENABLED: boolean = APP_ENVIRONMENT !== 'online';
export const DIAGNOSTICS_ENABLED = true;
