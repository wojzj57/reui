/**
 * Dialog 状态管理（RFC-004 §3.4.4）。
 *
 * 吸收旧 Framework/Presence 的 `open()/close()` 命令式设计，
 * 用 valtio store 驱动，挂载一次全局宿主即可在任意位置调用。
 *
 * Dialog 栈（FIFO，互斥可见），由 `<DialogHost />` 渲染（封装 antd Modal）。
 * 焦点陷阱、ESC 关闭、`role="dialog"`/`aria-modal` 由 antd Modal 提供。
 */

import { proxy, useSnapshot } from 'valtio';
import { useEffect, useState, useCallback } from 'react';
import { Modal, Input } from 'antd';
import type { ModalProps } from 'antd';
import { createId } from '../utils/id';

// ============================================================================
// 类型定义
// ============================================================================

export interface DialogOptions {
  title?: React.ReactNode;
  content?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  width?: number | string;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface PromptOptions extends Omit<DialogOptions, 'content' | 'onOk'> {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  onOk?: (value: string) => void | Promise<void>;
}

interface DialogItem {
  id: string;
  type: 'confirm' | 'alert' | 'prompt';
  options: DialogOptions | PromptOptions;
  resolve: (value: boolean | string | null | undefined) => void;
  open: boolean;
}

interface DialogStore {
  /** Dialog 栈（FIFO，互斥可见） */
  stack: DialogItem[];
  /** Host 是否已挂载 */
  hostMounted: boolean;
}

// ============================================================================
// Valtio Store
// ============================================================================

const dialogStore = proxy<DialogStore>({
  stack: [],
  hostMounted: false,
});

// ============================================================================
// 命令式 API
// ============================================================================

export const dialog = {
    /**
     * 确认对话框，返回 Promise<boolean>
     */
    async confirm(options: DialogOptions): Promise<boolean> {
      return new Promise((resolve) => {
        const id = createId();
        const item: DialogItem = {
          id,
          type: 'confirm',
          options,
          resolve: (v) => resolve(v as boolean),
          open: true,
        };
        dialogStore.stack.push(item);
      });
    },

    /**
     * 提示对话框（带输入框），返回 Promise<string | null>
     */
    async prompt(options: PromptOptions): Promise<string | null> {
      return new Promise((resolve) => {
        const id = createId();
        const item: DialogItem = {
          id,
          type: 'prompt',
          options,
          resolve: (v) => resolve(v as string | null),
          open: true,
        };
        dialogStore.stack.push(item);
      });
    },

  /**
   * 警告对话框，返回 Promise<void>
   */
  async alert(options: Omit<DialogOptions, 'onOk' | 'onCancel'>): Promise<void> {
    return new Promise((resolve) => {
      const id = createId();
      const item: DialogItem = {
        id,
        type: 'alert',
        options: options as DialogOptions,
        resolve: () => resolve(),
        open: true,
      };
      dialogStore.stack.push(item);
    });
  },

  /**
   * 关闭指定 Dialog（内部使用）
   */
  _close(id: string, value: unknown): void {
    const idx = dialogStore.stack.findIndex((d) => d.id === id);
    if (idx !== -1) {
      const removed = dialogStore.stack.splice(idx, 1)[0];
      if (removed) {
        removed.resolve(value as boolean | string | null | undefined);
      }
    }
  },

  /**
   * 关闭最顶层的 Dialog
   */
  closeAll(): void {
    while (dialogStore.stack.length > 0) {
      const item = dialogStore.stack.pop();
      item?.resolve(item.type === 'confirm' ? false : null);
    }
  },
};

// ============================================================================
// DialogHost 组件（渲染宿主，封装 antd Modal）
// ============================================================================

export function DialogHost() {
  const snap = useSnapshot(dialogStore);

  // 标记宿主挂载/卸载（供命令式 API 判断是否已就绪）
  useEffect(() => {
    dialogStore.hostMounted = true;
    return () => {
      dialogStore.hostMounted = false;
    };
  }, []);

  // 只渲染栈顶的 Dialog；空栈时不渲染任何 Modal。
  // 注意：所有 per-dialog 的 Hook 都放在 DialogView 子组件内，
  // 子组件以 key={topItem.id} 挂载/卸载，宿主自身不持有条件 Hook，
  // 从而不违反 React Hooks 规则（修复栈空↔非空切换时 Hook 数变化导致的崩溃）。
  const top = snap.stack.length > 0 ? snap.stack[snap.stack.length - 1] : undefined;
  if (!top) return null;

  // 从只读快照取出对应的可变 store 项，传给子组件。
  const topItem = dialogStore.stack.find((d) => d.id === top.id);
  if (!topItem) return null;

  return <DialogView key={topItem.id} item={topItem} />;
}

/**
 * 单个 Dialog 的渲染视图。
 * 以 key={item.id} 挂载，确保每个 Dialog 的本地状态（输入值/loading）独立，
 * 且 Hook 调用始终无条件执行。
 */
function DialogView({ item }: { item: DialogItem }) {
  const opts = item.options as DialogOptions;
  const promptOpts = item.options as PromptOptions;

  const [promptValue, setPromptValue] = useState(promptOpts.defaultValue ?? '');
  const [loading, setLoading] = useState(false);

  const handleOk = useCallback(async () => {
    try {
      if (opts.onOk) {
        setLoading(true);
        // prompt 的 onOk 接收输入值；其余无参。
        await (item.type === 'prompt'
          ? (opts.onOk as (v: string) => void | Promise<void>)(promptValue)
          : (opts.onOk as () => void | Promise<void>)());
      }
    } finally {
      setLoading(false);
    }
    if (item.type === 'prompt') {
      dialog._close(item.id, promptValue);
    } else {
      dialog._close(item.id, true);
    }
  }, [item.id, item.type, opts.onOk, promptValue]);

  const handleCancel = useCallback(() => {
    opts.onCancel?.();
    if (item.type === 'prompt') {
      dialog._close(item.id, null);
    } else {
      dialog._close(item.id, item.type === 'confirm' ? false : undefined);
    }
  }, [item.id, item.type, opts.onCancel]);

  const modalProps: ModalProps = {
    title: opts.title,
    open: item.open,
    onOk: handleOk,
    onCancel: handleCancel,
    confirmLoading: loading,
    width: opts.width ?? 400,
    okText: opts.okText ?? 'OK',
    cancelText: opts.cancelText ?? 'Cancel',
    okButtonProps: opts.danger ? { danger: true } : undefined,
    destroyOnClose: true,
  };

  // alert 类型不显示取消按钮
  if (item.type === 'alert') {
    modalProps.cancelButtonProps = { style: { display: 'none' } };
  }

  return (
    <Modal {...modalProps}>
      {item.type === 'prompt' ? (
        <div>
          {promptOpts.label && (
            <label style={{ display: 'block', marginBottom: 8 }}>{promptOpts.label}</label>
          )}
          <Input
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            placeholder={promptOpts.placeholder}
            autoFocus
            onPressEnter={handleOk}
          />
        </div>
      ) : (
        opts.content
      )}
    </Modal>
  );
}
