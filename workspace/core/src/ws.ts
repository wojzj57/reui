/**
 * ws 模块（RFC-003 §4.3）—— 共享 WebSocket 的 iframe 侧封装。
 *
 * channel 名不带 `ws:` 前缀传入；订阅经 Client push 链路收取
 * `ws:${channel}` 与 `ws:stateChanged`。需要 `runtime.websocket` 权限发送。
 */

import { Client, type Unsubscribe } from './client';
import type { WSState } from '@reui/interface';

export type { WSState };

export type MessageHandler = (data: unknown) => void;

export const ws = {
  /** 订阅某 channel 的入站消息。 */
  subscribe(channel: string, handler: MessageHandler): Unsubscribe {
    return Client.getInstance().onPush(`ws:${channel}`, handler);
  },

  /** 发送消息到 channel（未连接时 Runtime 会离线缓冲）。 */
  async send(channel: string, data: unknown): Promise<void> {
    await Client.getInstance().request('ws:send', { channel, data });
  },

  /** 查询当前连接状态。 */
  async getState(): Promise<WSState> {
    const res = await Client.getInstance().request<{ state: WSState }>('ws:state');
    return res.state;
  },

  /** 订阅连接状态变更。 */
  onStateChange(handler: (state: WSState) => void): Unsubscribe {
    return Client.getInstance().onPush('ws:stateChanged', (payload) =>
      handler(payload as WSState),
    );
  },
};
