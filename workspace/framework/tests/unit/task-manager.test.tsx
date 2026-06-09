import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskManager, useTasks } from '../../src/stores/task-manager';

/** 创建一个直到 abort 才 resolve 的任务函数。 */
function abortableTask() {
  return (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', () => resolve());
    });
}

describe('useTaskManager', () => {
  it('runs tasks up to concurrency and abort decrements runningCount exactly once', async () => {
    const { result } = renderHook(() => useTaskManager());

    let ids: string[] = [];
    act(() => {
      ids = [
        result.current.addTask('t1', abortableTask()),
        result.current.addTask('t2', abortableTask()),
        result.current.addTask('t3', abortableTask()),
        result.current.addTask('t4', abortableTask()),
      ];
    });

    // 并发上限为 3
    await waitFor(() => expect(result.current.runningCount).toBe(3));
    const pending = result.current.tasks.filter((t) => t.status === 'pending');
    expect(pending.map((t) => t.id)).toContain(ids[3]);

    // 移除一个运行中的任务 → abort，runningCount 应仅 -1（不可为负），
    // 并自动调度下一个 pending 任务补位（仍为 3）。
    act(() => {
      result.current.removeTask(ids[0]!);
    });
    await waitFor(() => expect(result.current.runningCount).toBe(3));
    expect(result.current.runningCount).toBeGreaterThanOrEqual(0);

    // 清空剩余任务
    act(() => {
      result.current.tasks.forEach((t) => result.current.removeTask(t.id));
    });
    await waitFor(() => expect(result.current.runningCount).toBe(0));
  });

  it('marks a throwing task as failed with error', async () => {
    const { result } = renderHook(() => useTaskManager());
    let id = '';
    act(() => {
      id = result.current.addTask('boom', async () => {
        throw new Error('boom');
      });
    });
    await waitFor(() => {
      const t = result.current.tasks.find((x) => x.id === id);
      expect(t?.status).toBe('failed');
      expect(t?.error?.message).toBe('boom');
    });
    expect(result.current.runningCount).toBe(0);
  });

  it('clearCompleted removes finished tasks', async () => {
    const { result } = renderHook(() => useTaskManager());
    let id = '';
    act(() => {
      id = result.current.addTask('done', async () => {});
    });
    await waitFor(() => {
      const t = result.current.tasks.find((x) => x.id === id);
      expect(t?.status).toBe('completed');
    });
    act(() => result.current.clearCompleted());
    await waitFor(() =>
      expect(result.current.tasks.find((x) => x.id === id)).toBeUndefined(),
    );
  });

  it('useTasks exposes the task list', () => {
    const { result } = renderHook(() => useTasks());
    expect(Array.isArray(result.current)).toBe(true);
  });
});
