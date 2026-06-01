/**
 * 单元测试：NuiBridge（RFC-001 §3.4）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus';
import { NuiBridge } from '../src/nui-bridge';

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const makeResponse = (init: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}): FetchLikeResponse => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: init.json ?? (() => Promise.resolve({})),
});

describe('NuiBridge.handleGameMessage', () => {
  let bus: EventBus;
  let bridge: NuiBridge;

  beforeEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
    bus = EventBus.getInstance();
    bridge = new NuiBridge(bus);
  });

  afterEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
  });

  it('should record resourceName when receiving reui:init', () => {
    // arrange
    const message = { type: 'reui:init', resourceName: 'reui_runtime' };

    // act
    bridge.handleGameMessage(message);

    // assert
    expect(bridge.getResourceName()).toBe('reui_runtime');
  });

  it('should emit event on EventBus when receiving nui:* message', () => {
    // arrange
    const handler = vi.fn();
    bus.on('nui:player:died', handler);
    const message = { type: 'nui:player:died', payload: { id: 7 } };

    // act
    bridge.handleGameMessage(message);

    // assert
    expect(handler).toHaveBeenCalledWith({ id: 7 });
  });

  it('should silently drop messages with unrecognized shape when payload is invalid', () => {
    // arrange
    const handler = vi.fn();
    bus.on('nui:foo', handler);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // act
    expect(() => bridge.handleGameMessage({ type: 'something:else' })).not.toThrow();
    expect(() => bridge.handleGameMessage(null)).not.toThrow();
    expect(() => bridge.handleGameMessage('string')).not.toThrow();
    expect(() => bridge.handleGameMessage({ type: 'nui:' })).not.toThrow();

    // assert
    expect(handler).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('NuiBridge.sendToGame', () => {
  let bridge: NuiBridge;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
    bridge = new NuiBridge(EventBus.getInstance());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
  });

  it('should throw with reui:init hint when resourceName is not set', async () => {
    // arrange
    // (no init received)

    // act
    const promise = bridge.sendToGame('foo', { x: 1 });

    // assert
    await expect(promise).rejects.toThrow(/reui:init/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should return mock envelope without calling fetch when in mock mode', async () => {
    // arrange
    bridge.handleGameMessage({ type: 'reui:init', resourceName: 'reui_runtime' });
    bridge.setMode('mock');

    // act
    const result = await bridge.sendToGame('foo', { x: 1 });

    // assert
    expect(result).toEqual({ ok: true, mock: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should POST to https://<resourceName>/<encoded eventName> with JSON body in spec mode', async () => {
    // arrange
    bridge.handleGameMessage({ type: 'reui:init', resourceName: 'reui_runtime' });
    fetchMock.mockResolvedValue(
      makeResponse({ ok: true, status: 200, json: () => Promise.resolve({ ok: 1 }) }),
    );

    // act
    const result = await bridge.sendToGame('player/heal', { hp: 100 });

    // assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://reui_runtime/player%2Fheal');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json; charset=UTF-8' });
    expect(init.body).toBe(JSON.stringify({ hp: 100 }));
    expect(result).toEqual({ ok: 1 });
  });

  it('should throw including status when fetch response is not ok', async () => {
    // arrange
    bridge.handleGameMessage({ type: 'reui:init', resourceName: 'reui_runtime' });
    fetchMock.mockResolvedValue(makeResponse({ ok: false, status: 500 }));

    // act
    const promise = bridge.sendToGame('foo');

    // assert
    await expect(promise).rejects.toThrow(/500/);
  });

  it('should return null when response JSON parsing fails', async () => {
    // arrange
    bridge.handleGameMessage({ type: 'reui:init', resourceName: 'reui_runtime' });
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('unexpected token')),
      }),
    );

    // act
    const result = await bridge.sendToGame('foo');

    // assert
    expect(result).toBeNull();
  });

  it('should send empty object body when data argument is omitted', async () => {
    // arrange
    bridge.handleGameMessage({ type: 'reui:init', resourceName: 'reui_runtime' });
    fetchMock.mockResolvedValue(
      makeResponse({ ok: true, status: 200, json: () => Promise.resolve(null) }),
    );

    // act
    await bridge.sendToGame('ping');

    // assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{}');
  });
});

describe('NuiBridge.onGameEvent', () => {
  let bus: EventBus;
  let bridge: NuiBridge;

  beforeEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
    bus = EventBus.getInstance();
    bridge = new NuiBridge(bus);
  });

  afterEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
  });

  it('should receive payload when matching event is emitted on EventBus', () => {
    // arrange
    const handler = vi.fn();
    bridge.onGameEvent('nui:hello', handler);

    // act
    bus.emit('nui:hello', { msg: 'hi' });

    // assert
    expect(handler).toHaveBeenCalledWith({ msg: 'hi' });
  });

  it('should stop receiving payload after returned unsubscribe is invoked', () => {
    // arrange
    const handler = vi.fn();
    const unsubscribe = bridge.onGameEvent('nui:tick', handler);

    // act
    unsubscribe();
    bus.emit('nui:tick', 1);

    // assert
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('NuiBridge.getInstance', () => {
  beforeEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
  });

  afterEach(() => {
    EventBus.__resetForTests();
    NuiBridge.__resetForTests();
  });

  it('should return the same instance across calls', () => {
    // arrange
    const a = NuiBridge.getInstance();

    // act
    const b = NuiBridge.getInstance();

    // assert
    expect(a).toBe(b);
  });
});
