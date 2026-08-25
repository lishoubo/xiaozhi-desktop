/**
 * 内测诊断开关 —— 决定「原始错误详情」能不能下发到界面。
 *
 * 面向用户的失败提示一律是友好文案（措辞稳定、不含实现细节）。但内测阶段
 * 光有友好文案定位不了问题：文案会把不同根因归成同一句话，而真机上我们既
 * 不方便远程调试，也不能指望每次都拿到日志文件。所以在**非 online 构建**里
 * 额外附带一份原始 message，测试同学截个图就够定位。
 *
 * 用 `APP_ENVIRONMENT` 而不是新加构建开关：环境本来就是编译期常量，三套包
 * 的用途已经区分得很清楚（dev/pre 是内部的，online 是给客户的），再引入一根
 * 独立的轴只会多一个要记得设置的地方。
 */
import { APP_ENVIRONMENT } from './app-environment';

export const DIAGNOSTICS_ENABLED: boolean = APP_ENVIRONMENT !== 'online';
