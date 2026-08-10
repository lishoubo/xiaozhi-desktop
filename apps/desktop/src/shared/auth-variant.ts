/**
 * 本次构建装的是哪一套登录。值由 vite-plugins/auth-variant.ts 在编译期 define 注入，
 * main / preload / renderer 三端同源。
 *
 * 用它做分支（而不是运行期读配置）是有意的：编译期常量能让 Rollup 把未选中的那套
 * 实现连同 import 一起摇掉，两套登录不会同时进产物。
 */
export const AUTH_VARIANT: 'staff' | 'phone' = __AUTH_VARIANT__;

export const IS_STAFF_AUTH = AUTH_VARIANT === 'staff';
