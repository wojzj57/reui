import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// 一个同步的内存事件总线，模拟 @reui/core 的 event 模块。
const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    handlers,
    on(name: string, h: (p: unknown) => void) {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      set.add(h);
      return () => set!.delete(h);
    },
    emit(name: string, payload?: unknown) {
      handlers.get(name)?.forEach((h) => h(payload));
      return Promise.resolve();
    },
  };
});

// 注意：mock 工厂里通过箭头函数转发到 bus，这样 vi.spyOn(bus,'emit') 才能
// 捕获到经由 event.emit 发出的调用（直接传 bus.emit 会固定住旧引用）。
vi.mock('@reui/core', () => ({
  event: {
    on: (name: string, h: (p: unknown) => void) => bus.on(name, h),
    emit: (name: string, payload?: unknown) => bus.emit(name, payload),
  },
}));

import { useSharedState } from '../../src/stores/shared-state';

describe('useSharedState', () => {
  let emitSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    emitSpy = vi.spyOn(bus, 'emit') as unknown as ReturnType<typeof vi.fn>;
  });

  it('local writes update the proxy and broadcast a set message', async () => {
    const { result } = renderHook(() =>
      useSharedState('s-write', { count: 0 }),
    );
    act(() => {
      result.current.count = 5;
    });
    expect(result.current.count).toBe(5);
    // 应广播一条 set 消息（修复旧实现「broadcast 从未调用」的缺陷）。
    // valtio subscribe 在微任务中触发，故用 waitFor。
    await waitFor(() => {
      const setCalls = emitSpy.mock.calls.filter(
        (c) => c[0] === 'reui:shared:s-write:set',
      );
      expect(setCalls.length).toBeGreaterThan(0);
    });
    const setCalls = emitSpy.mock.calls.filter(
      (c) => c[0] === 'reui:shared:s-write:set',
    );
    const msg = setCalls.at(-1)![1] as { key: string; value: unknown; op: string };
    expect(msg.key).toBe('count');
    expect(msg.value).toBe(5);
    expect(msg.op).toBe('set');
  });

  it('applies remote set messages from a different origin', () => {
    const { result } = renderHook(() =>
      useSharedState('s-remote', { name: '' }),
    );
    act(() => {
      bus.emit('reui:shared:s-remote:set', {
        key: 'name',
        value: 'John',
        op: 'set',
        origin: 'other-frame',
        version: 100000,
      });
    });
    expect(result.current.name).toBe('John');
  });

  it('handles remote delete operations', () => {
    const { result } = renderHook(() =>
      useSharedState('s-del', { temp: 'x' }),
    );
    act(() => {
      bus.emit('reui:shared:s-del:set', {
        key: 'temp',
        op: 'delete',
        origin: 'other-frame',
        version: 200000,
      });
    });
    expect((result.current as Record<string, unknown>).temp).toBeUndefined();
  });
});
