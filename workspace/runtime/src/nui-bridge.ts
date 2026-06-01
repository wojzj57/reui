/**
 * NuiBridge（RFC-001 §3.4）。
 *
 * Runtime ↔ FiveM 游戏端的桥接层。游戏侧通过 `SendNUIMessage` 把消息推到
 * NUI window；Runtime 侧的 MessageDispatcher 把这些消息交给本类的
 * `handleGameMessage` 处理：
 *   - `{ type: 'reui:init', resourceName }`：记录 resourceName，后续
 *     `sendToGame` 才有意义；
 *   - `{ type: 'nui:<event>', payload? }`：转发到 EventBus，由插件订阅；
 *   - 其它形态：静默丢弃（DEV 下打印一条 warn）。
 *
 * `sendToGame` 反向调用：在 spec 模式下走 FiveM NUI callback——
 *   `POST https://<resourceName>/<eventName>`，body 为 JSON。
 * 在 mock 模式下不发请求，直接返回 `{ ok: true, mock: true }`，方便
 * 浏览器调试时不依赖游戏环境。
 *
 * 关键约定：
 *   1. 模块顶层不挂 `window.addEventListener('message', …)`——
 *      这是 MessageDispatcher 的职责，NuiBridge 仅暴露 `handleGameMessage`；
 *   2. 类型严格：所有外部输入用 `unknown` + 自定义 type guard；
 *   3. 单例 + 依赖注入：构造函数允许注入 EventBus 便于测试。
 */

import { EventBus } from './event-bus';

export type NuiBridgeMode = 'spec' | 'mock';

/** Runtime ↔ Game 消息形态：初始化握手。 */
interface ReuiInitMessage {
  type: 'reui:init';
  resourceName: string;
}

/** Runtime ↔ Game 消息形态：游戏推送的事件。 */
interface NuiEventMessage {
  type: `nui:${string}`;
  payload?: unknown;
}

export class NuiBridge {
  private static _instance: NuiBridge | null = null;

  private readonly eventBus: EventBus;
  private resourceName: string | null = null;
  private mode: NuiBridgeMode = 'spec';

  constructor(eventBus: EventBus = EventBus.getInstance()) {
    this.eventBus = eventBus;
  }

  static getInstance(): NuiBridge {
    if (!NuiBridge._instance) NuiBridge._instance = new NuiBridge();
    return NuiBridge._instance;
  }

  /** 仅测试使用：重置单例避免用例间状态泄漏。 */
  static __resetForTests(): void {
    NuiBridge._instance = null;
  }

  // ── 来自游戏端的消息 ──────────────────────────────────────────────────

  /**
   * 处理游戏端 `SendNUIMessage` 推送过来的消息。
   * 由 MessageDispatcher 调用。非法形态静默丢弃（DEV 下 warn）。
   */
  handleGameMessage(data: unknown): void {
    if (isReuiInitMessage(data)) {
      this.resourceName = data.resourceName;
      return;
    }
    if (isNuiEventMessage(data)) {
      this.eventBus.emit(data.type, data.payload);
      return;
    }
    devWarn('NuiBridge: dropped unrecognized game message', data);
  }

  /**
   * 订阅游戏端推送的某个 `nui:*` 事件。返回解绑函数。
   * 等价于 `eventBus.on(eventName, handler)` 的语法糖，便于插件代码语义清晰。
   */
  onGameEvent(
    eventName: string,
    handler: (payload: unknown) => void,
  ): () => void {
    return this.eventBus.on(eventName, handler);
  }

  // ── 反向：Runtime → Game ─────────────────────────────────────────────

  /**
   * 调用 FiveM NUI callback。
   *
   * - resourceName 未设置 → 抛错（提示需要等 `reui:init`）；
   * - mock 模式 → 不调 fetch，返回 `{ ok: true, mock: true }`；
   * - spec 模式 → POST `https://<resourceName>/<eventName>`；
   *   - response.ok=false → 抛包含 status 的错误；
   *   - response 是非 JSON / 解析失败 → 返回 null（不抛——
   *     FiveM 的 `cb({})` 在某些情况下会返回非 JSON，业务方按需处理）。
   */
  async sendToGame(eventName: string, data?: unknown): Promise<unknown> {
    if (this.resourceName === null) {
      throw new Error(
        'NuiBridge: resourceName not set; reui:init has not been received',
      );
    }
    if (this.mode === 'mock') {
      return { ok: true, mock: true };
    }
    const url = `https://${this.resourceName}/${encodeURIComponent(eventName)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data ?? {}),
    });
    if (!res.ok) {
      throw new Error(
        `NuiBridge: sendToGame "${eventName}" failed with status ${res.status}`,
      );
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // ── 配置与查询 ───────────────────────────────────────────────────────

  setMode(mode: NuiBridgeMode): void {
    this.mode = mode;
  }

  getResourceName(): string | null {
    return this.resourceName;
  }
}

// ── 类型守卫 ─────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isReuiInitMessage = (v: unknown): v is ReuiInitMessage =>
  isRecord(v) &&
  v['type'] === 'reui:init' &&
  typeof v['resourceName'] === 'string';

const isNuiEventMessage = (v: unknown): v is NuiEventMessage => {
  if (!isRecord(v)) return false;
  const type = v['type'];
  return typeof type === 'string' && type.startsWith('nui:') && type.length > 4;
};

const devWarn = (message: string, ...args: unknown[]): void => {
  if (
    typeof process !== 'undefined' &&
    process.env != null &&
    process.env.NODE_ENV !== 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(`[ReUI:NuiBridge] ${message}`, ...args);
  }
};
