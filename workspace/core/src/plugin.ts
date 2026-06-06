/**
 * plugin 模块（RFC-003 §4.6）—— 插件自管理（配置 / 可见性 / 状态）封装。
 *
 * 自控类 API（show/hide/saveState/...）针对插件自身，无需 capability。
 * - 可见性变更经 Runtime 广播 `plugin:visibility`，本模块按自身 pluginId 过滤；
 * - `saveState` 受 Runtime 端 1MB 上限约束（超限抛 PAYLOAD_TOO_LARGE）。
 *
 * 注：`onBeforeUnload` 仅订阅 Runtime 的 `plugin:beforeUnload` 推送；
 * Runtime 侧「卸载前最多等待 5s 的优雅协调」属后续 RFC-002 生命周期工作，
 * 当前未提供阻塞式 ack。
 */

import { Client, type Unsubscribe } from './client';

export type PluginConfig = Record<string, unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export const plugin = {
  /** 读取自身 manifest 配置。 */
  getConfig(): Promise<PluginConfig> {
    return Client.getInstance().request<PluginConfig>('plugin:getConfig');
  },

  /** 请求显示自身。 */
  async requestShow(): Promise<void> {
    await Client.getInstance().request('plugin:show');
  },

  /** 请求隐藏自身。 */
  async requestHide(): Promise<void> {
    await Client.getInstance().request('plugin:hide');
  },

  /** 持久化自身状态（受 1MB 上限约束）。 */
  async saveState<T = unknown>(state: T): Promise<void> {
    await Client.getInstance().request('plugin:saveState', { payload: state });
  },

  /** 恢复此前持久化的状态；无则返回 null。 */
  async restoreState<T = unknown>(): Promise<T | null> {
    const res = await Client.getInstance().request<{ payload: T | null }>(
      'plugin:restoreState',
    );
    return res.payload ?? null;
  },

  /** 订阅自身可见性变更（已按 pluginId 过滤，仅自身事件回调）。 */
  onVisibilityChange(handler: (visible: boolean) => void): Unsubscribe {
    const client = Client.getInstance();
    return client.onPush('plugin:visibility', (payload) => {
      if (isRecord(payload) && payload['pluginId'] === client.id) {
        handler(Boolean(payload['visible']));
      }
    });
  },

  /** 订阅卸载前通知。 */
  onBeforeUnload(handler: (reason: string) => void | Promise<void>): Unsubscribe {
    return Client.getInstance().onPush('plugin:beforeUnload', (payload) => {
      const reason =
        isRecord(payload) && typeof payload['reason'] === 'string'
          ? payload['reason']
          : '';
      void handler(reason);
    });
  },
};
