/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

/**
 * 构建变体：由 vite-plugins/auth-variant.ts 在三处构建里 define 注入。
 * 编译期字面量，用于让未选中的登录实现被 DCE 摇掉。
 */
declare const __AUTH_VARIANT__: 'staff' | 'phone';
