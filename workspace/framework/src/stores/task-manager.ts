/**
 * TaskManager —— 并发任务队列（RFC-004 §3.7.5）。
 *
 * 吸收旧 Common/TaskManager（async.queue + valtio 进度）。
 *
 * 设计：
 *   - addTask 将任务入队，并触发 scheduleTasks()
 *   - scheduleTasks() 在并发上限内启动 pending 任务
 *   - 任务完成后自动触发下一次调度
 *   - removeTask / abortTask 可中止运行中的任务
 */

import { proxy, useSnapshot } from 'valtio';
import { useEffect, useRef } from 'react';
import { createId } from '../utils/id';

export interface Task {
  id: string;
  name: string;
  progress: number;    // 0-100
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  error?: Error;
  abortController: AbortController;
  /** 内部：任务执行函数 */
  _fn?: (signal: AbortSignal) => Promise<void>;
}

interface TaskManagerStore {
  tasks: Task[];
  maxConcurrency: number;
  runningCount: number;
}

const DEFAULT_MAX_CONCURRENCY = 3;

const taskManagerStore = proxy<TaskManagerStore>({
  tasks: [],
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  runningCount: 0,
});

/**
 * 调度任务：在并发上限内启动 pending 任务
 */
function scheduleTasks() {
  // 如果已达并发上限，不启动新任务
  if (taskManagerStore.runningCount >= taskManagerStore.maxConcurrency) return;

  // 查找下一个 pending 任务
  const next = taskManagerStore.tasks.find((t) => t.status === 'pending');
  if (!next) return;

  // 启动任务
  next.status = 'running';
  taskManagerStore.runningCount++;

  // 异步执行任务
  (async () => {
    try {
      if (next._fn) {
        await next._fn(next.abortController.signal);
      }
      next.status = 'completed';
    } catch (err) {
      if (next.abortController.signal.aborted) {
        next.status = 'aborted';
      } else {
        next.status = 'failed';
        next.error = err as Error;
      }
    } finally {
      taskManagerStore.runningCount--;
      // 任务完成后，尝试启动下一个 pending 任务
      scheduleTasks();
    }
  })();
}

/**
 * 任务管理器 Hook。
 *
 * @example
 * const { tasks, addTask, removeTask, abortTask } = useTaskManager();
 *
 * addTask('task-1', async (signal) => {
 *   // 长时间运行的任务
 *   while (!signal.aborted) {
 *     await doWork();
 *   }
 * });
 */
export function useTaskManager() {
  const snap = useSnapshot(taskManagerStore);

  const addTask = (name: string, fn: (signal: AbortSignal) => Promise<void>): string => {
    const id = createId();
    const abortController = new AbortController();

    const task: Task = {
      id,
      name,
      progress: 0,
      status: 'pending',
      abortController,
      _fn: fn,
    };

    taskManagerStore.tasks.push(task);

    // 触发调度
    scheduleTasks();

    return id;
  };

  const removeTask = (id: string) => {
    const idx = taskManagerStore.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const removed = taskManagerStore.tasks.splice(idx, 1)[0];

    // 如果任务正在运行，仅触发 abort——runningCount 的递减与后续调度
    // 统一交由任务执行体的 finally 处理，避免双重递减导致计数为负、调度死锁。
    if (removed && removed.status === 'running') {
      removed.abortController.abort();
    }
  };

  const abortTask = (id: string) => {
    const task = taskManagerStore.tasks.find((t) => t.id === id);
    if (task && task.status === 'running') {
      task.abortController.abort();
    }
  };

  const clearCompleted = () => {
    taskManagerStore.tasks = taskManagerStore.tasks.filter(
      (t) => t.status !== 'completed' && t.status !== 'aborted',
    );
  };

  return {
    tasks: [...snap.tasks] as Task[],
    runningCount: snap.runningCount,
    addTask,
    removeTask,
    abortTask,
    clearCompleted,
  };
}

/**
 * 获取当前任务列表（只读，用于渲染）。
 */
export function useTasks(): Task[] {
  const snap = useSnapshot(taskManagerStore);
  return [...snap.tasks] as Task[];
}
