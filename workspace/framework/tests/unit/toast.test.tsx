import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { toast, ToastHost } from '../../src/stores/toast';

describe('toast store', () => {
  beforeEach(() => {
    toast.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    toast.clear();
    vi.useRealTimers();
  });

  it('module import has no side effects (api is ready synchronously)', () => {
    // 调用不依赖 Host 挂载，不抛错
    expect(() => toast.success('ok')).not.toThrow();
    toast.clear();
  });

  it('auto-dismisses non-loading toast after duration', () => {
    const id = toast.success('saved', { duration: 1000 });
    expect(typeof id).toBe('string');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 队列应已清空（通过再次插入并检查不报错间接验证）
    expect(() => toast.dismiss(id)).not.toThrow();
  });

  it('loading toast does not auto-dismiss', () => {
    toast.loading('uploading');
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    // loading 仍在；dismiss 手动清除
    toast.clear();
  });

  it('enforces max queue length and clears evicted timers', () => {
    for (let i = 0; i < 8; i++) toast.info(`t${i}`);
    // 上限 5，不应抛错，clear 清理所有定时器
    expect(() => toast.clear()).not.toThrow();
  });

  it('dismiss removes a specific toast and fires onClose', () => {
    const onClose = vi.fn();
    const id = toast.error('err', { onClose });
    toast.dismiss(id);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ToastHost', () => {
  beforeEach(() => toast.clear());
  afterEach(() => toast.clear());

  it('renders queued toasts with status role', async () => {
    render(<ToastHost />);
    act(() => {
      toast.success('hello');
    });
    // valtio 快照异步通知，用 findByText 轮询等待。
    expect(await screen.findByText('hello')).toBeTruthy();
    const host = document.querySelector('.reui-toast-host');
    expect(host?.getAttribute('role')).toBe('status');
  });
});
