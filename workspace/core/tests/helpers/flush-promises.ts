/**
 * Resolve all currently queued microtasks. Use this between `act` steps
 * when promise chains need to settle without advancing fake timers.
 *
 * Do NOT pair with real `setTimeout`. Per .codebuddy/rules/001-testing.mdc,
 * any time-based wait must use `vi.advanceTimersByTimeAsync`.
 */
export const flushPromises = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(resolve));
