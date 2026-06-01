/**
 * 单元测试：HeartbeatMonitor（RFC-001 §3.7）。
 *
 * 时序设计依赖 fake timers + setSystemTime——
 * Date.now() 在测试中由 vitest 控制，因此每个用例的"当前时间"可推断：
 *   - start 时 lastPong = 0；
 *   - 第 N 个 PING_INTERVAL（10s）触发一次 tick，每次未收到 pong 则 missed +1。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus';
import { HeartbeatMonitor, type HeartbeatTarget } from '../src/heartbeat-monitor';

const makeTarget = (
  pluginId = 'plugin-a',
): HeartbeatTarget & { postMessage: ReturnType<typeof vi.fn> } => ({
  pluginId,
  postMessage: vi.fn(),
});

describe('HeartbeatMonitor.start', () => {
  let bus: EventBus;
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    bus = EventBus.getInstance();
    monitor = new HeartbeatMonitor(bus);
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should send a single reui:ping with numeric ts on the first PING_INTERVAL when started', async () => {
    // arrange
    const target = makeTarget();
    monitor.start(target);

    // act
    await vi.advanceTimersByTimeAsync(10_000);

    // assert
    expect(target.postMessage).toHaveBeenCalledTimes(1);
    const [msg] = target.postMessage.mock.calls[0] as [
      { type: string; ts: number },
    ];
    expect(msg.type).toBe('reui:ping');
    expect(typeof msg.ts).toBe('number');
  });

  it('should not double-send pings when start is called twice for the same pluginId', async () => {
    // arrange
    const target = makeTarget();
    monitor.start(target);
    monitor.start(target);

    // act
    await vi.advanceTimersByTimeAsync(10_000);

    // assert
    expect(target.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('HeartbeatMonitor.handlePong', () => {
  let bus: EventBus;
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    bus = EventBus.getInstance();
    monitor = new HeartbeatMonitor(bus);
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should not mark a missed pong when pong arrives between pings within PONG_TIMEOUT', async () => {
    // arrange
    const target = makeTarget();
    const crashHandler = vi.fn();
    bus.on('plugin:crashed', crashHandler);
    monitor.start(target);
    // pong arrives 5s after start, just at the edge of PONG_TIMEOUT
    await vi.advanceTimersByTimeAsync(5_000);
    monitor.handlePong(target.pluginId);

    // act: advance to first tick at t=10s; diff = 10s - 5s = 5s, not > 5s ⇒ no miss
    await vi.advanceTimersByTimeAsync(5_000);

    // assert
    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(crashHandler).not.toHaveBeenCalled();
  });

  it('should silently ignore handlePong for an unknown pluginId', () => {
    // arrange
    const fn = (): void => monitor.handlePong('never-registered');

    // act + assert
    expect(fn).not.toThrow();
  });
});

describe('HeartbeatMonitor crash signaling', () => {
  let bus: EventBus;
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    bus = EventBus.getInstance();
    monitor = new HeartbeatMonitor(bus);
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should emit plugin:crashed and stop pinging after MAX_MISSED consecutive missed pongs', async () => {
    // arrange
    const target = makeTarget();
    const crashHandler = vi.fn();
    bus.on('plugin:crashed', crashHandler);
    monitor.start(target);

    // act: 3 ticks without any pong ⇒ crash on the 3rd
    await vi.advanceTimersByTimeAsync(30_000);

    // assert
    expect(crashHandler).toHaveBeenCalledTimes(1);
    expect(crashHandler).toHaveBeenCalledWith({
      pluginId: target.pluginId,
      reason: 'heartbeat-timeout',
    });
    // first two ticks sent ping, the crash tick did not
    expect(target.postMessage).toHaveBeenCalledTimes(2);
    expect(monitor.isMonitoring(target.pluginId)).toBe(false);
  });

  it('should emit plugin:crashed only once and not tick anymore after crash', async () => {
    // arrange
    const target = makeTarget();
    const crashHandler = vi.fn();
    bus.on('plugin:crashed', crashHandler);
    monitor.start(target);

    // act
    await vi.advanceTimersByTimeAsync(30_000);
    const callsAtCrash = target.postMessage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);

    // assert
    expect(crashHandler).toHaveBeenCalledTimes(1);
    expect(target.postMessage).toHaveBeenCalledTimes(callsAtCrash);
  });
});

describe('HeartbeatMonitor.stop', () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    monitor = new HeartbeatMonitor(EventBus.getInstance());
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should stop pinging and report not monitoring after stop', async () => {
    // arrange
    const target = makeTarget();
    monitor.start(target);
    monitor.stop(target.pluginId);

    // act
    await vi.advanceTimersByTimeAsync(30_000);

    // assert
    expect(target.postMessage).not.toHaveBeenCalled();
    expect(monitor.isMonitoring(target.pluginId)).toBe(false);
  });
});

describe('HeartbeatMonitor.pause / resume', () => {
  let bus: EventBus;
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    bus = EventBus.getInstance();
    monitor = new HeartbeatMonitor(bus);
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should not ping while paused and should not count paused time as missed pongs after resume', async () => {
    // arrange
    const target = makeTarget();
    const crashHandler = vi.fn();
    bus.on('plugin:crashed', crashHandler);
    monitor.start(target);
    monitor.pause(target.pluginId);

    // act: 60s of pause time should not produce pings nor accumulate misses
    await vi.advanceTimersByTimeAsync(60_000);
    const callsDuringPause = target.postMessage.mock.calls.length;
    monitor.resume(target.pluginId);
    // one ping cycle after resume should fire exactly once (lastPong was reset)
    await vi.advanceTimersByTimeAsync(10_000);

    // assert
    expect(callsDuringPause).toBe(0);
    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(crashHandler).not.toHaveBeenCalled();
  });
});

describe('HeartbeatMonitor.pause edge cases', () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    monitor = new HeartbeatMonitor(EventBus.getInstance());
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should silently ignore pause for an unknown pluginId', () => {
    // arrange
    const fn = (): void => monitor.pause('never-registered');

    // act + assert
    expect(fn).not.toThrow();
  });

  it('should be idempotent when pause is called twice for the same pluginId', async () => {
    // arrange
    const target = makeTarget();
    monitor.start(target);
    monitor.pause(target.pluginId);
    monitor.pause(target.pluginId);

    // act
    await vi.advanceTimersByTimeAsync(60_000);

    // assert
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it('should silently ignore resume when the pluginId is not paused', () => {
    // arrange
    const target = makeTarget();
    monitor.start(target);
    const fn = (): void => monitor.resume(target.pluginId);

    // act + assert
    expect(fn).not.toThrow();
  });
});

describe('HeartbeatMonitor singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should return the same instance from getInstance', () => {
    // arrange
    const a = HeartbeatMonitor.getInstance();

    // act
    const b = HeartbeatMonitor.getInstance();

    // assert
    expect(a).toBe(b);
  });

  it('should stop all targets and discard the instance when __resetForTests runs after start', async () => {
    // arrange
    const target = makeTarget();
    const monitor = HeartbeatMonitor.getInstance();
    monitor.start(target);

    // act
    HeartbeatMonitor.__resetForTests();
    await vi.advanceTimersByTimeAsync(30_000);

    // assert
    expect(target.postMessage).not.toHaveBeenCalled();
    expect(HeartbeatMonitor.getInstance()).not.toBe(monitor);
  });
});

describe('HeartbeatMonitor.stopAll', () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(0);
    EventBus.__resetForTests();
    HeartbeatMonitor.__resetForTests();
    monitor = new HeartbeatMonitor(EventBus.getInstance());
  });

  afterEach(() => {
    HeartbeatMonitor.__resetForTests();
    EventBus.__resetForTests();
    vi.useRealTimers();
  });

  it('should clear every monitored target when stopAll is called', async () => {
    // arrange
    const a = makeTarget('plugin-a');
    const b = makeTarget('plugin-b');
    monitor.start(a);
    monitor.start(b);
    monitor.stopAll();

    // act
    await vi.advanceTimersByTimeAsync(30_000);

    // assert
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(b.postMessage).not.toHaveBeenCalled();
    expect(monitor.isMonitoring('plugin-a')).toBe(false);
    expect(monitor.isMonitoring('plugin-b')).toBe(false);
  });
});
