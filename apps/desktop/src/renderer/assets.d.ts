/**
 * 静态资源模块声明。
 *
 * renderer 侧本来由 `vite/client` 提供这些声明（见 tsconfig.renderer.json 的
 * `types`），但 `tsconfig.node.json` 用的是 `types: ["node"]`，拿不到那一份——
 * 而它又必须 include `tests/unit/**`，那里的单测会间接 import 到 renderer 的
 * 资源引用：
 *
 * ```
 * tests/unit/renderer-internal-channel-entry.test.ts
 *   → renderer/build-features.ts
 *     → renderer/data/ota-channels.ts
 *       → renderer/data/ota-icons.ts
 *         → import '../assets/xiaozhi-logo-flat.png'   ← 这里报 TS2307
 * ```
 *
 * 两个 project 共用这一份声明，避免只修好一边。只声明实际用到的扩展名，
 * 不做 `*` 通配——通配会让真正拼错的资源路径也静默通过。
 */
declare module '*.png' {
  const source: string;
  export default source;
}

declare module '*.svg' {
  const source: string;
  export default source;
}

declare module '*.webp' {
  const source: string;
  export default source;
}
