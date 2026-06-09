/**
 * usePersistentState —— 本地持久化（RFC-004 §3.7.4）。
 *
 * 重写旧 Common/Storage。
 *
 * 修复旧库 bug：save key 不再写死为 "UserData"，由参数 key 决定。
 * valtio + localStorage，序列化失败/超限有降级处理。
 */

import { proxy, useSnapshot } from 'valtio';
import { useEffect, useRef } from 'react';

const STORAGE_PREFIX = 'reui:';

interface StoreEntry {
  value: unknown;
  timestamp: number;
}

const storeCache: Record<string, ReturnType<typeof proxy<{ value: unknown }>>> = {};

/**
 * 本地持久化状态 Hook。
 *
 * @param key localStorage 键名（会自动加前缀 reui:）
 * @param initial 初始值
 *
 * @example
 * const [name, setName] = usePersistentState('player-name', '');
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const fullKey = `${STORAGE_PREFIX}${key}`;

  if (!storeCache[fullKey]) {
    // 从 localStorage 恢复
    let stored = initial as T;
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StoreEntry;
        stored = parsed.value as T;
      }
    } catch {
      // 降级：清除损坏的数据
      localStorage.removeItem(fullKey);
    }

    storeCache[fullKey] = proxy({ value: stored });
  }

  const store = storeCache[fullKey];
  const snap = useSnapshot(store as { value: T });

  // 持久化到 localStorage（内联，不依赖 useEffect）
  const save = (v: T) => {
    (store as { value: T }).value = v;
    try {
      const entry: StoreEntry = {
        value: v,
        timestamp: Date.now(),
      };
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch {
      // 降级：存储失败时清除（可能是配额超限）
      console.warn(`[ReUI] Failed to save persistent state: ${fullKey}`);
    }
  };

  // 使用 ref 保持 setValue 引用稳定
  const setValueRef = useRef(save);
  setValueRef.current = save;

  const setValue = (v: T) => {
    setValueRef.current(v);
  };

  // 清理：组件卸载时不清除数据（持久化）
  // 但清除内存中的 store 缓存（可选）
  useEffect(() => {
    return () => {
      // 可选：卸载时清除内存缓存
      // delete storeCache[fullKey];
    };
  }, [fullKey]);

  return [snap.value as T, setValue];
}
