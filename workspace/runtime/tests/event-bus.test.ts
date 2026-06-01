/**
 * 单元测试：EventBus（RFC-003 §3.1）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    EventBus.__resetForTests();
    bus = EventBus.getInstance();
  });

  afterEach(() => {
    EventBus.__resetForTests();
  });

  it('should deliver payload to exact-match handlers', () => {
    // arrange
    const h = vi.fn();
    bus.on('player:died', h);

    // act
    bus.emit('player:died', { id: 1 });

    // assert
    expect(h).toHaveBeenCalledWith({ id: 1 });
  });

  it('should support multiple handlers for the same event', () => {
    // arrange
    const a = vi.fn();
    const b = vi.fn();
    bus.on('e', a);
    bus.on('e', b);

    // act
    bus.emit('e', 1);

    // assert
    expect(a).toHaveBeenCalledWith(1);
    expect(b).toHaveBeenCalledWith(1);
  });

  it('should remove handler with returned unsubscribe', () => {
    // arrange
    const h = vi.fn();
    const off = bus.on('e', h);

    // act
    off();
    bus.emit('e', null);

    // assert
    expect(h).not.toHaveBeenCalled();
    expect(bus.exactListenerCount).toBe(0);
  });

  it('should be a no-op to off() unknown handlers', () => {
    expect(() => bus.off('nothing', () => {})).not.toThrow();
  });

  it('should match prefix wildcard pattern', () => {
    // arrange
    const h = vi.fn();
    bus.on('player:*', h);

    // act
    bus.emit('player:died', 1);
    bus.emit('player:health-changed', 2);
    bus.emit('vehicle:exit', 3);

    // assert
    expect(h).toHaveBeenCalledTimes(2);
    expect(h).toHaveBeenNthCalledWith(1, 1);
    expect(h).toHaveBeenNthCalledWith(2, 2);
  });

  it('should match * to any event', () => {
    // arrange
    const h = vi.fn();
    bus.on('*', h);

    // act
    bus.emit('a', 1);
    bus.emit('b:c', 2);

    // assert
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('should fire exact handlers before wildcard handlers', () => {
    // arrange
    const order: string[] = [];
    bus.on('player:died', () => order.push('exact'));
    bus.on('player:*', () => order.push('wild'));

    // act
    bus.emit('player:died', null);

    // assert
    expect(order).toEqual(['exact', 'wild']);
  });

  it('should isolate handler errors', () => {
    // arrange
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.on('e', bad);
    bus.on('e', good);

    // act
    bus.emit('e', null);

    // assert
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should auto-unsubscribe after once handler fires', () => {
    // arrange
    const h = vi.fn();
    bus.once('e', h);

    // act
    bus.emit('e', 1);
    bus.emit('e', 2);

    // assert
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(1);
  });

  it('should snapshot handler set during emit (allow add/remove during dispatch)', () => {
    // arrange
    const order: number[] = [];
    const h1 = vi.fn(() => {
      order.push(1);
      bus.on('e', () => order.push(99)); // 在派发中新增
    });
    const h2 = vi.fn(() => order.push(2));
    bus.on('e', h1);
    bus.on('e', h2);

    // act
    bus.emit('e', null);
    bus.emit('e', null);

    // assert
    // 第一轮：[1, 2]；第二轮：[1, 2, 99] —— 新增的 handler 第二轮才生效
    expect(order.slice(0, 2)).toEqual([1, 2]);
    expect(order).toContain(99);
  });

  it('should track per-plugin subscriptions', () => {
    // arrange
    bus.subscribeForPlugin('inv', 'event:item-used', vi.fn());
    bus.subscribeForPlugin('inv', 'event:item-dropped', vi.fn());

    // assert
    expect(bus.pluginSubscriptionCount('inv')).toBe(2);
    expect(bus.exactListenerCount).toBe(2);
  });

  it('should clean up all subscriptions for a plugin via unsubscribePlugin', () => {
    // arrange
    bus.subscribeForPlugin('inv', 'a', vi.fn());
    bus.subscribeForPlugin('inv', 'b', vi.fn());
    bus.subscribeForPlugin('hud', 'c', vi.fn());

    // act
    bus.unsubscribePlugin('inv');

    // assert
    expect(bus.pluginSubscriptionCount('inv')).toBe(0);
    expect(bus.pluginSubscriptionCount('hud')).toBe(1);
    expect(bus.exactListenerCount).toBe(1);
  });

  it('should be a no-op to unsubscribePlugin for unknown id', () => {
    expect(() => bus.unsubscribePlugin('ghost')).not.toThrow();
  });

  it('should remove individual plugin subscription via returned unsubscribe', () => {
    // arrange
    const off = bus.subscribeForPlugin('inv', 'e', vi.fn());

    // act
    off();

    // assert
    expect(bus.pluginSubscriptionCount('inv')).toBe(0);
    expect(bus.exactListenerCount).toBe(0);
  });

  it('should be a singleton', () => {
    expect(EventBus.getInstance()).toBe(bus);
  });
});
