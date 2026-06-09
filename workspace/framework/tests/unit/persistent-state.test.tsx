import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePersistentState } from '../../src/stores/persistent-state';

describe('usePersistentState', () => {
  beforeEach(() => localStorage.clear());

  it('uses the provided key (not hardcoded "UserData") with reui: prefix', async () => {
    const { result } = renderHook(() => usePersistentState('player-name', 'init'));
    act(() => result.current[1]('Neo'));
    await waitFor(() => expect(result.current[0]).toBe('Neo'));
    const raw = localStorage.getItem('reui:player-name');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).value).toBe('Neo');
    // 不应写入旧库的 "UserData" 键
    expect(localStorage.getItem('UserData')).toBeNull();
  });

  it('restores persisted value on mount', () => {
    localStorage.setItem(
      'reui:restored-key',
      JSON.stringify({ value: 42, timestamp: 1 }),
    );
    const { result } = renderHook(() => usePersistentState('restored-key', 0));
    expect(result.current[0]).toBe(42);
  });

  it('recovers from corrupted storage by falling back to initial', () => {
    localStorage.setItem('reui:corrupt-key', '{not json');
    const { result } = renderHook(() => usePersistentState('corrupt-key', 'fallback'));
    expect(result.current[0]).toBe('fallback');
    expect(localStorage.getItem('reui:corrupt-key')).toBeNull();
  });
});
