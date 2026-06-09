import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const core = vi.hoisted(() => {
  const make = () => {
    const handlers = new Set<(d: unknown) => void>();
    const unsub = vi.fn(() => {});
    // 兼容 onGameEvent(name, handler) 与 onVisibilityChange(handler)：handler 总是最后一个参数。
    const register = vi.fn((...args: unknown[]) => {
      const h = args[args.length - 1] as (d: unknown) => void;
      handlers.add(h);
      return unsub;
    });
    return { handlers, unsub, register, fire: (d: unknown) => handlers.forEach((h) => h(d)) };
  };
  const nuiBus = make();
  const eventBus = make();
  const userBus = make();
  const visBus = make();
  return {
    nuiBus,
    eventBus,
    userBus,
    visBus,
    hasPermission: vi.fn(async (_p: string) => true),
    getUser: vi.fn(async () => ({ id: '1', name: 'Neo' })),
  };
});

vi.mock('@reui/core', () => ({
  nui: { onGameEvent: core.nuiBus.register },
  event: { on: core.eventBus.register },
  auth: {
    hasPermission: core.hasPermission,
    getUser: core.getUser,
    onUserChange: core.userBus.register,
  },
  plugin: { onVisibilityChange: core.visBus.register },
}));

import { useNuiEvent } from '../../src/hooks/useNuiEvent';
import { useNuiState } from '../../src/hooks/useNuiState';
import { useEvent } from '../../src/hooks/useEvent';
import { usePermission } from '../../src/hooks/usePermission';
import { useUser } from '../../src/hooks/useUser';
import { useVisibility } from '../../src/hooks/useVisibility';
import { useInterval } from '../../src/hooks/useInterval';

describe('useNuiEvent', () => {
  it('subscribes, invokes handler, and unsubscribes on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useNuiEvent('evt', handler));
    act(() => core.nuiBus.fire({ a: 1 }));
    expect(handler).toHaveBeenCalledWith({ a: 1 });
    unmount();
    expect(core.nuiBus.unsub).toHaveBeenCalled();
  });
});

describe('useNuiState', () => {
  it('updates state when event fires', async () => {
    const { result } = renderHook(() => useNuiState<number>('hp', 100));
    expect(result.current).toBe(100);
    act(() => core.nuiBus.fire(42));
    await waitFor(() => expect(result.current).toBe(42));
  });
});

describe('useEvent', () => {
  it('subscribes to EventBus', () => {
    const handler = vi.fn();
    renderHook(() => useEvent('bus-evt', handler));
    act(() => core.eventBus.fire('payload'));
    expect(handler).toHaveBeenCalledWith('payload');
  });
});

describe('usePermission', () => {
  it('resolves allowed and clears loading', async () => {
    const { result } = renderHook(() => usePermission('inventory.drop'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
  });
});

describe('useUser', () => {
  it('loads the user and clears loading', async () => {
    const { result } = renderHook(() => useUser());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.name).toBe('Neo');
  });
});

describe('useVisibility', () => {
  it('defaults to visible and updates on change', async () => {
    const { result } = renderHook(() => useVisibility());
    expect(result.current).toBe(true);
    act(() => core.visBus.fire(false));
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe('useInterval', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invokes callback on interval and stops on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useInterval(cb, 100));
    act(() => vi.advanceTimersByTime(350));
    expect(cb).toHaveBeenCalledTimes(3);
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does not start when ms <= 0', () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 0));
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).not.toHaveBeenCalled();
  });
});
