/**
 * Toast 状态管理（RFC-004 §3.4.5）。
 *
 * 吸收旧 Framework/Message 的命令式思路，
 * **修复其 import 期 throw、挂载后才可用的竞态**——store 在模块加载时即就绪，
 * 渲染宿主缺失时静默入队，挂载后补放。
 *
 * 底层为 valtio 的 Toast 队列（默认上限 5 条），`<ToastHost />` 渲染。
 * 副作用全部置于 effect / 挂载后，模块 import 期**无副作用、不 throw**。
 */

import { proxy, useSnapshot } from 'valtio';
import { useEffect, useState } from 'react';
import { createId } from '../utils/id';

// ============================================================================
// 类型定义
// ============================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastItem {
  id: string;
  type: ToastType;
  content: React.ReactNode;
  duration?: number;
  onClose?: () => void;
}

interface ToastStore {
  /** Toast 队列（FIFO，上限 MAX_TOASTS） */
  queue: ToastItem[];
  /** Host 是否已挂载 */
  hostMounted: boolean;
}

/** 存储 setTimeout ID，用于清理 */
const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// ============================================================================
// 常量
// ============================================================================

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 3000;

// ============================================================================
// Valtio Store（模块加载时即就绪，无副作用）
// ============================================================================

const toastStore = proxy<ToastStore>({
  queue: [],
  hostMounted: false,
});

// ============================================================================
// 内部工具函数
// ============================================================================

function generateId(): string {
  return createId();
}

function addToast(
  type: ToastType,
  content: React.ReactNode,
  duration?: number,
  onClose?: () => void,
): string {
  const id = generateId();
  const item: ToastItem = { id, type, content, duration, onClose };

  // 超过上限，移除最旧的项（并清理其定时器，避免残留）
  if (toastStore.queue.length >= MAX_TOASTS) {
    const removed = toastStore.queue.shift();
    if (removed) {
      clearToastTimeout(removed.id);
      removed.onClose?.();
    }
  }

  toastStore.queue.push(item);

  // 非 loading 类型自动消失
  if (type !== 'loading' && duration !== 0) {
    const delay = duration ?? DEFAULT_DURATION;
    const timeoutId = setTimeout(() => {
      removeToast(id);
    }, delay);
    toastTimeouts.set(id, timeoutId);
  }

  return id;
}

function clearToastTimeout(id: string): void {
  const timeoutId = toastTimeouts.get(id);
  if (timeoutId) {
    clearTimeout(timeoutId);
    toastTimeouts.delete(id);
  }
}

function removeToast(id: string): void {
  clearToastTimeout(id);

  const idx = toastStore.queue.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const [removed] = toastStore.queue.splice(idx, 1);
    removed?.onClose?.();
  }
}

// ============================================================================
// 命令式 API（模块 import 后即可调用，无挂载要求）
// ============================================================================

export const toast = {
  success(content: React.ReactNode, options?: { duration?: number; onClose?: () => void }): string {
    return addToast('success', content, options?.duration, options?.onClose);
  },

  error(content: React.ReactNode, options?: { duration?: number; onClose?: () => void }): string {
    return addToast('error', content, options?.duration, options?.onClose);
  },

  warning(content: React.ReactNode, options?: { duration?: number; onClose?: () => void }): string {
    return addToast('warning', content, options?.duration, options?.onClose);
  },

  info(content: React.ReactNode, options?: { duration?: number; onClose?: () => void }): string {
    return addToast('info', content, options?.duration, options?.onClose);
  },

  loading(content: React.ReactNode): string {
    return addToast('loading', content, 0); // duration=0 不自动消失
  },

  dismiss(id: string): void {
    removeToast(id);
  },

  /** 清除所有 Toast（并清理其定时器） */
  clear(): void {
    while (toastStore.queue.length > 0) {
      const item = toastStore.queue.pop();
      if (item) {
        clearToastTimeout(item.id);
        item.onClose?.();
      }
    }
  },
};

// ============================================================================
// ToastHost 组件（渲染宿主，必须挂载到应用顶层）
// ============================================================================

function ToastIcon({ type }: { type: ToastType }) {
  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    loading: '⟳',
  };
  return <span className={`reui-toast-icon reui-toast-icon--${type}`}>{icons[type]}</span>;
}

export function ToastHost() {
  const snap = useSnapshot(toastStore);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    toastStore.hostMounted = true;
    setMounted(true);
    return () => {
      toastStore.hostMounted = false;
    };
  }, []);

  if (!mounted) return null;

  return (
    <div className="reui-toast-host" role="status" aria-live="polite" aria-atomic="true">
      {snap.queue.map((item) => (
        <div key={item.id} className={`reui-toast reui-toast--${item.type}`}>
          <ToastIcon type={item.type} />
          <span className="reui-toast-content">{item.content as React.ReactNode}</span>
          <button
            className="reui-toast-close"
            onClick={() => toast.dismiss(item.id)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
