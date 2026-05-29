/**
 * jsdom iframe-window scaffolding.
 *
 * The Client (under test) calls `window.parent.postMessage(...)` and
 * filters incoming messages by `event.source === window.parent`. To
 * faithfully simulate the iframe ↔ Runtime relationship inside a single
 * jsdom window, we install a controlled "parent" object and wire it up
 * so:
 *
 *   - Calls from Client → Runtime go through `parent.postMessage`
 *     (captured by MockRuntime).
 *   - Pushes from Runtime → Client are dispatched as `MessageEvent`s on
 *     `window` whose `source` === `parent` (so the Client accepts them).
 *
 * Tests should call `setupIframeWindow()` in `beforeEach` and
 * `iframe.dispose()` in `afterEach`.
 */

export interface ControlledParent {
  /** Captures every message Client sends out. */
  postMessage: (data: unknown, targetOrigin: string) => void;
  /** History of (data, targetOrigin) pairs for assertions. */
  readonly outbound: Array<{ data: unknown; targetOrigin: string }>;
  /**
   * Internal: lets MockRuntime queue inbound messages onto the iframe
   * window with `source` set to `this` parent.
   */
  __deliver: (data: unknown, origin: string) => void;
}

export interface IframeHandle {
  readonly window: Window;
  readonly parent: ControlledParent;
  /** Restore `window.parent` to its prior value and clear listeners. */
  dispose: () => void;
}

export const setupIframeWindow = (): IframeHandle => {
  const win = globalThis.window;
  const originalParentDescriptor = Object.getOwnPropertyDescriptor(win, 'parent');

  const parent: ControlledParent = {
    outbound: [],
    postMessage(data, targetOrigin) {
      this.outbound.push({ data, targetOrigin });
    },
    __deliver(data, origin) {
      const ev = new MessageEvent('message', {
        data,
        origin,
        // Cast: jsdom's MessageEvent typings allow any object here.
        source: parent as unknown as MessageEventSource,
      });
      win.dispatchEvent(ev);
    },
  };

  Object.defineProperty(win, 'parent', {
    configurable: true,
    get: () => parent,
  });

  return {
    window: win,
    parent,
    dispose() {
      if (originalParentDescriptor) {
        Object.defineProperty(win, 'parent', originalParentDescriptor);
      } else {
        delete (win as unknown as Record<string, unknown>).parent;
      }
      parent.outbound.length = 0;
    },
  };
};
