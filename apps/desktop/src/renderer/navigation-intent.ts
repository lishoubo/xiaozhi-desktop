/**
 * svelte-spa-router 切换路由会卸载整棵组件树，跨页面的一次性意图无法通过组件
 * 状态传递。这里提供模块级的一次性信箱：写入方 push 路由前 set，目标页面挂载
 * 时 consume（读取即清空，避免下次挂载重复触发）。
 */
export interface NavigationIntent<T> {
  set(value: T): void;
  consume(): T | undefined;
}

export function createNavigationIntent<T>(): NavigationIntent<T> {
  let pending: T | undefined;
  return {
    set(value) {
      pending = value;
    },
    consume() {
      const value = pending;
      pending = undefined;
      return value;
    },
  };
}
