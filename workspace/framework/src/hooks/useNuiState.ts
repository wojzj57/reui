/**
 * useNuiState —— 声明式订阅 NUI 事件，事件触发时自动更新 state（RFC-004 §3.5）。
 *
 * 适用于驱动 UI 渲染的数据（如背包列表、血量）。
 * 内部结合 valtio proxy + useNuiEvent，事件触发时更新 proxy，
 * 组件通过 useSnapshot 精确订阅。
 */

import { useEffect, useRef } from 'react';
import { proxy, useSnapshot } from 'valtio';
import { nui } from '@reui/core';

export function useNuiState<T>(eventName: string, initialValue: T): T {
  const storeRef = useRef<ReturnType<typeof proxy<{ value: T }>> | null>(null);
  const eventNameRef = useRef(eventName);

  // 当 eventName 变化时，重新创建 proxy
  if (eventNameRef.current !== eventName || !storeRef.current) {
    eventNameRef.current = eventName;
    storeRef.current = proxy({ value: initialValue });
  }

  const store = storeRef.current;

  useEffect(() => {
    const unsub = nui.onGameEvent(eventName, (data: unknown) => {
      store.value = data as T;
    });
    return unsub;
  }, [eventName]);

  const snap = useSnapshot(store);
  return snap.value as T;
}
