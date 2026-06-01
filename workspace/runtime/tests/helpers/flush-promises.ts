/**
 * 等待当前 microtask 队列被冲刷完毕。
 * 用于在测试中确保 `await Promise.resolve()` 链式 then 全部执行完。
 */
export const flushPromises = (): Promise<void> =>
  new Promise<void>((resolve) => {
    // 借助 queueMicrotask 把 resolve 放在所有已挂起 microtask 之后。
    queueMicrotask(resolve);
  });
