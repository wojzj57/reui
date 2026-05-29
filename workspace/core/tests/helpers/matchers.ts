import { expect } from 'vitest';
import type { AnyMessage } from '@reui/interface';

/**
 * Custom matcher: assert that the given list contains at least one
 * message whose fields are a *superset* of `expected` (deep partial).
 * Per plan §7.4, never use `toEqual` against the full message — that
 * couples tests to incidental field ordering and additions.
 */

interface CustomMatchers<R = unknown> {
  toContainMessageMatching: (expected: Record<string, unknown>) => R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

const matches = (actual: unknown, expected: unknown): boolean => {
  if (expected === actual) return true;
  if (
    typeof expected !== 'object' ||
    expected === null ||
    typeof actual !== 'object' ||
    actual === null
  ) {
    return false;
  }
  for (const [k, v] of Object.entries(expected)) {
    if (!matches((actual as Record<string, unknown>)[k], v)) return false;
  }
  return true;
};

export const registerMatchers = (): void => {
  expect.extend({
    toContainMessageMatching(received: AnyMessage[], expected: Record<string, unknown>) {
      const pass = received.some((msg) => matches(msg, expected));
      return {
        pass,
        message: () =>
          pass
            ? `expected message list NOT to contain message matching ${JSON.stringify(expected)}`
            : `expected message list to contain message matching ${JSON.stringify(expected)}\n` +
              `received: ${JSON.stringify(received, null, 2)}`,
      };
    },
  });
};
