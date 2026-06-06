/**
 * nui 模块（RFC-003 §4.5）—— FiveM 游戏端事件桥接的 iframe 侧封装。
 *
 * 事件名不带 `nui:` 前缀传入；订阅经 Client push 链路收取游戏端推送的
 * `nui:${eventName}`。`sendToGame` 经 Runtime NuiBridge 回调游戏端。
 * 需要 `runtime.message` 权限发送。
 */

import { Client, type Unsubscribe } from './client';

export const nui = {
  /** 订阅游戏端推送的某个事件。 */
  onGameEvent(eventName: string, handler: (data: unknown) => void): Unsubscribe {
    return Client.getInstance().onPush(`nui:${eventName}`, handler);
  },

  /** 向游戏端发送 NUI 回调，返回游戏端响应。 */
  async sendToGame(eventName: string, data?: unknown): Promise<unknown> {
    return Client.getInstance().request('nui:send', { event: eventName, data });
  },
};
