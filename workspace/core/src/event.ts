/**
 * event 模块（RFC-003 §4.1）—— 跨插件事件总线的 iframe 侧封装。
 *
 * 事件名不带 `event:` 前缀传入；模块负责补全命名空间前缀后再交给 Runtime
 * 的 EventBus 中转。订阅与发布都经由 Client 的 push / request 链路。
 */

import { Client, type Handler, type Unsubscribe } from './client';

const prefixed = (name: string): string => `event:${name}`;

export const event = {
  /** 订阅事件。返回取消订阅函数。 */
  on(name: string, handler: Handler): Unsubscribe {
    return Client.getInstance().onPush(prefixed(name), handler);
  },

  /** 订阅一次，回调触发后自动解绑。 */
  once(name: string, handler: Handler): Unsubscribe {
    const unsub = Client.getInstance().onPush(prefixed(name), (payload) => {
      unsub();
      handler(payload);
    });
    return unsub;
  },

  /** 发布事件到 Runtime EventBus。 */
  async emit(name: string, payload?: unknown): Promise<void> {
    await Client.getInstance().request('event:emit', {
      event: prefixed(name),
      payload,
    });
  },
};
