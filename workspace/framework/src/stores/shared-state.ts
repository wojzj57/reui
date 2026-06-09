/**
 * useSharedState —— 跨 frame 共享状态（RFC-004 §3.7.3）。
 *
 * 重写旧 Common/SharedObject。
 * 基于 @reui/core 的 event 模块（EventBus）+ reui: 协议同步，
 * 而非旧库直连 postMessage。
 *
 * 修复旧库缺陷：
 *   ① 用单调递增版本号 + 唯一 origin 标识取代脆弱的「布尔防回环位」；
 *   ② 正确处理 delete 操作（旧库未处理）；
 *   ③ 不依赖旧 stub EventManager；
 *   ④ 真正接上「本地写 → 广播」链路（旧实现仅有接收侧）：
 *      返回可写的 valtio proxy，并通过 subscribe 监听本地变更广播出去；
 *   ⑤ origin 改用 createId()（避免 Math.random 碰撞）。
 */

import { proxy, subscribe, useSnapshot } from 'valtio';
import { useEffect, useReducer } from 'react';
import { event } from '@reui/core';
import { createId } from '../utils/createId';

/** 本 frame 的唯一标识，用于过滤自身发出的广播。 */
const ORIGIN = `reui-shared-${createId()}`;

/** 单调递增的版本号（本/远端共享一个计数器，丢弃过期消息）。 */
let versionCounter = 0;

interface SharedStore {
  [key: string]: unknown;
}

const stores: Record<string, ReturnType<typeof proxy<SharedStore>>> = {};

/** 正在回放远程变更的 store 名集合——回放期间不再向外广播，避免回环。 */
const applyingRemote = new Set<string>();

/** 顶层键值的浅快照（仅取顶层），用于 diff 出本地变更。 */
function shallowSnapshot(store: SharedStore): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(store)) out[key] = store[key];
  return out;
}

interface SharedMessage {
  key: string;
  value: unknown;
  op?: 'set' | 'delete';
  origin: string;
  version: number;
}

/**
 * 跨 frame 共享状态 Hook。
 *
 * 返回值是可写的 valtio proxy：直接赋值即同步到其他 frame，
 * 组件在状态变化时自动重渲染。
 *
 * @param name 共享状态名称（跨 frame 唯一标识）
 * @param initial 初始值
 *
 * @example
 * const state = useSharedState('player-info', { name: '', health: 100 });
 * state.name = 'John'; // 自动同步到其他 frame，并触发本组件重渲染
 */
export function useSharedState<T extends Record<string, unknown>>(
  name: string,
  initial: T,
): T {
  if (!stores[name]) {
    stores[name] = proxy<SharedStore>({ ...(initial as SharedStore) });
  }

  const store = stores[name]!;

  // 订阅快照，确保状态变化时组件重渲染（读用 proxy，写也用 proxy）。
  useSnapshot(store);
  // 兜底强制重渲染：useSnapshot 的访问追踪在某些读取模式下可能不触发，
  // 这里用一个 reducer tick 保证任何变更都重渲染。
  const [, force] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    // —— 监听远程变更 ——
    const unsub = event.on(`reui:shared:${name}:set`, (data: unknown) => {
      const msg = data as SharedMessage;
      // 忽略自己发出的消息
      if (msg.origin === ORIGIN) return;
      // 版本号检查（单调递增，丢弃过期消息）
      if (typeof msg.version === 'number') {
        if (msg.version < versionCounter) return;
        versionCounter = Math.max(versionCounter, msg.version);
      }

      applyingRemote.add(name);
      try {
        if (msg.op === 'delete') {
          delete store[msg.key];
        } else {
          store[msg.key] = msg.value;
        }
      } finally {
        applyingRemote.delete(name);
      }
    });

    // —— 本地变更 → 广播 ——
    // 注意：不同 valtio 版本传入 subscribe 的 ops 形态不一致（2.3.x 在本环境下
    // 为空数组），故不依赖 ops，改为对顶层键做前后快照 diff，稳健地得出
    // set / delete 变更再广播。
    let prev = shallowSnapshot(store);
    const unsubLocal = subscribe(store, () => {
      // 任何变更都触发重渲染
      force();

      const cur = shallowSnapshot(store);

      // 回放远程变更时不再广播，避免回环；但需同步 prev 基线。
      if (applyingRemote.has(name)) {
        prev = cur;
        return;
      }

      // 新增 / 更新的顶层键
      for (const key of Object.keys(cur)) {
        if (!Object.is(prev[key], cur[key])) {
          const version = ++versionCounter;
          const msg: SharedMessage = {
            key,
            value: cur[key],
            op: 'set',
            origin: ORIGIN,
            version,
          };
          void event.emit(`reui:shared:${name}:set`, msg);
        }
      }
      // 被删除的顶层键
      for (const key of Object.keys(prev)) {
        if (!(key in cur)) {
          const version = ++versionCounter;
          const msg: SharedMessage = {
            key,
            value: undefined,
            op: 'delete',
            origin: ORIGIN,
            version,
          };
          void event.emit(`reui:shared:${name}:set`, msg);
        }
      }

      prev = cur;
    });

    // —— 初始状态同步：新加入者请求，已有者应答 ——
    const unsubRequest = event.on(
      `reui:shared:${name}:request`,
      (data: unknown) => {
        const { origin: reqOrigin } = data as { origin: string };
        if (reqOrigin === ORIGIN) return;
        // 发送完整状态快照
        for (const key of Object.keys(store)) {
          const msg: SharedMessage = {
            key,
            value: store[key],
            op: 'set',
            origin: ORIGIN,
            version: versionCounter,
          };
          void event.emit(`reui:shared:${name}:set`, msg);
        }
      },
    );

    void event.emit(`reui:shared:${name}:request`, { origin: ORIGIN });

    return () => {
      unsub();
      unsubLocal();
      unsubRequest();
    };
  }, [name]);

  return store as unknown as T;
}
