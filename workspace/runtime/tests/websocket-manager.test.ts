/**
 * WebSocketManager 单元测试（RFC-003 §3.2）。
 *
 * 用注入的 FakeSocket 驱动连接生命周期，不触达真实 WebSocket。覆盖：
 * 状态机与 ws:stateChanged 广播、离线队列与 flush、FIFO 上限淘汰、
 * 入站消息按 channel 经 EventBus 派发、指数退避重连、maxRetries 耗尽、手动断开。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus';
import {
  WebSocketManager,
  type WebSocketCtor,
  type WebSocketLike,
} from '../src/websocket-manager';

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // ── 测试驱动 ──
  open(): void {
    this.readyState = 1;
    this.onopen?.(undefined);
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.(undefined);
  }
}

const Ctor = FakeSocket as unknown as WebSocketCtor;
const last = (): FakeSocket =>
  FakeSocket.instances[FakeSocket.instances.length - 1]!;

describe('WebSocketManager', () => {
  let eventBus: EventBus;
  let mgr: WebSocketManager;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    EventBus.__resetForTests();
    eventBus = EventBus.getInstance();
    mgr = new WebSocketManager({ eventBus, WebSocketCtor: Ctor });
  });

  afterEach(() => {
    mgr.disconnect();
    vi.useRealTimers();
    EventBus.__resetForTests();
  });

  it('should transition to connected and broadcast ws:stateChanged on open', () => {
    // arrange
    const states: unknown[] = [];
    eventBus.on('ws:stateChanged', (s) => states.push(s));

    // act
    mgr.connect('wss://x');
    expect(mgr.state).toBe('connecting');
    last().open();

    // assert
    expect(mgr.state).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('should send JSON frame with channel and data when connected', () => {
    // arrange
    mgr.connect('wss://x');
    last().open();

    // act
    mgr.send('chat', { text: 'hi' });

    // assert
    expect(JSON.parse(last().sent[0]!)).toEqual({
      channel: 'chat',
      data: { text: 'hi' },
    });
  });

  it('should queue messages while disconnected and flush on connect', () => {
    // act: 未连接先发
    mgr.send('a', 1);
    mgr.send('b', 2);
    mgr.connect('wss://x');
    last().open();

    // assert: 按 FIFO flush
    const frames = last().sent.map((s) => JSON.parse(s));
    expect(frames).toEqual([
      { channel: 'a', data: 1 },
      { channel: 'b', data: 2 },
    ]);
  });

  it('should cap the offline queue at 100 evicting oldest', () => {
    // act: 入队 101 条
    for (let i = 0; i < 101; i++) mgr.send('c', i);
    mgr.connect('wss://x');
    last().open();

    // assert: 仅保留最近 100 条，最旧（data:0）被淘汰
    const frames = last().sent.map((s) => JSON.parse(s) as { data: number });
    expect(frames).toHaveLength(100);
    expect(frames[0]!.data).toBe(1);
    expect(frames[99]!.data).toBe(100);
  });

  it('should dispatch inbound messages to channel subscribers via EventBus', () => {
    // arrange
    const handler = vi.fn();
    mgr.subscribe('chat', handler);
    mgr.connect('wss://x');
    last().open();

    // act
    last().emitMessage(JSON.stringify({ channel: 'chat', data: { m: 1 } }));

    // assert
    expect(handler).toHaveBeenCalledWith({ m: 1 });
  });

  it('should ignore malformed inbound frames', () => {
    // arrange
    const handler = vi.fn();
    mgr.subscribe('chat', handler);
    mgr.connect('wss://x');
    last().open();

    // act
    last().emitMessage('not-json');
    last().emitMessage(JSON.stringify({ nochannel: true }));

    // assert
    expect(handler).not.toHaveBeenCalled();
  });

  it('should reconnect with exponential backoff after server close', async () => {
    // arrange
    mgr.connect('wss://x');
    last().open();
    expect(FakeSocket.instances).toHaveLength(1);

    // act: 服务端断开 → 进入 reconnecting，1s 后重连
    last().serverClose();
    expect(mgr.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);

    // assert: 新建了第二个 socket
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(mgr.state).toBe('connected');
  });

  it('should give up and go disconnected after maxRetries', async () => {
    // arrange: 最多重连 1 次
    mgr.connect('wss://x', { maxRetries: 1 });
    last().open();

    // act: 第一次断开 → 重连一次
    last().serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    // 第二次断开 → 已达上限，不再重连
    last().serverClose();

    // assert
    expect(mgr.state).toBe('disconnected');
  });

  it('should not reconnect after manual disconnect', () => {
    // arrange
    mgr.connect('wss://x');
    last().open();
    const count = FakeSocket.instances.length;

    // act
    mgr.disconnect();
    expect(mgr.state).toBe('disconnected');

    // assert: close 回调不触发重连
    expect(FakeSocket.instances).toHaveLength(count);
  });
});
