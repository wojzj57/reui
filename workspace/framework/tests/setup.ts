/**
 * Vitest 测试环境初始化。
 *
 * jsdom 缺少 antd 运行时所需的若干浏览器 API，这里做最小 polyfill。
 */

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// 每个测试后卸载 RTL 渲染的组件，避免相互污染。
afterEach(() => {
  cleanup();
});

// antd 依赖 matchMedia（响应式断点 / 主题）。
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// antd 部分组件依赖 ResizeObserver。
if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom 不实现 PointerEvent capture，Panel 拖拽会调用，stub 掉避免抛错。
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function setPointerCapture() {};
  HTMLElement.prototype.releasePointerCapture = function releasePointerCapture() {};
}

// jsdom 未实现 scrollTo。
if (!window.scrollTo) {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
}
