# RFC-001: Phase 1 — 通讯协议与核心通讯层

| 字段 | 值 |
|------|---|
| **状态** | Draft |
| **作者** | ReUI Team |
| **创建日期** | 2026-05-27 |
| **依赖** | 无（基础层） |
| **被依赖** | RFC-002 (Runtime Services), RFC-003 (Plugin Lifecycle), RFC-004 (Framework UI) |

---

## 1. 背景与动机

ReUI 是一个 FiveM 前端插件框架，其核心架构为：单一 Runtime 宿主页面通过 iframe 管理多个子插件页面。所有子插件不直接与游戏端或后端服务通讯，而是通过 Runtime 中转。

这种架构的通讯基础完全依赖 `window.postMessage`。如果没有一套严格定义的通讯协议和可靠的通讯层实现，上层所有功能（事件系统、HTTP 代理、WebSocket 订阅、认证查询、插件生命周期）都无法正确工作。

**本 RFC 定义的是整个 ReUI 系统的绝对基础——通讯协议格式、消息路由机制、握手流程、心跳保活，以及 iframe 侧的通讯客户端。**

### 当前痛点

1. FiveM NUI 原生仅提供 `SendNUIMessage`（游戏→CEF）和 `fetch` callback（CEF→游戏），没有多 iframe 管理能力
2. 多个插件如果各自监听 `message` 事件，会导致消息互相干扰、难以调试
3. 缺乏统一的协议版本控制，SDK 升级时无法优雅处理不兼容
4. 没有心跳机制时，iframe 崩溃（JS 异常导致无响应）无法被检测
5. 跨 iframe 通讯缺乏安全验证机制，存在消息伪造和越权访问风险

---

## 2. 目标与非目标

### 2.1 目标

- **定义完整的消息协议格式**：所有 Runtime ↔ iframe 消息的 TypeScript 类型定义、字段约束、版本策略
- **实现 Runtime 侧统一消息入口（MessageDispatcher）**：单一 `message` 监听器，正确区分游戏消息与 iframe 消息
- **实现 Runtime 侧协议路由（PostMessageRouter）**：版本检查、capability 权限检查、方法分发
- **实现 NUI Bridge**：Runtime 与 FiveM 游戏端的双向通讯桥接
- **实现 iframe 侧 Client 类**：@reui/core 中的通讯核心，管理握手、请求/响应、事件订阅、心跳响应
- **定义握手协议**：包含超时、重试、拒绝机制的完整握手流程
- **定义心跳协议**：ping/pong 检测 iframe 健康状态，处理插件崩溃

### 2.2 非目标

- 具体业务服务实现细节（EventBus、HttpClient、WebSocketManager 等属于 Phase 2）
- 插件生命周期管理（加载/卸载/热重载属于 Phase 3）
- UI 组件库（@reui/framework 属于 Phase 4）
- 层级系统与显示控制（HUD/Panel/Overlay 属于 Runtime Layer System）

---

## 3. 详细设计

### 3.1 消息协议格式

所有 ReUI 消息必须遵循以下基础结构：

```typescript
interface BaseMessage {
  /** 协议标识，固定前缀 "reui:" 用于快速过滤非 ReUI 消息 */
  type: `reui:${string}`;
  /** 协议版本号（当前为 1），严格相等匹配 */
  version: number;
}
```

**协议版本策略：**

- 当前版本：`PROTOCOL_VERSION = 1`
- Runtime 对 `version` 字段执行**严格相等匹配**（`message.version !== PROTOCOL_VERSION` → 拒绝）
- 新增可选字段不升版本（向后兼容，旧版 SDK 忽略新字段）
- 修改/移除已有字段语义必须升版本
- 版本不匹配时返回 `VERSION_MISMATCH` 错误并附带当前支持的版本号

#### 消息类型总览

| type | 方向 | 用途 |
|------|------|------|
| `reui:handshake` | iframe → Runtime | 子页面发起握手 |
| `reui:handshake-ack` | Runtime → iframe | 握手确认 |
| `reui:handshake-reject` | Runtime → iframe | 握手拒绝 |
| `reui:request` | iframe → Runtime | 请求调用服务 |
| `reui:response` | Runtime → iframe | 请求响应（成功/失败） |
| `reui:push` | Runtime → iframe | 事件推送 |
| `reui:notify` | iframe → Runtime | 无需响应的通知 |
| `reui:ping` | Runtime → iframe | 心跳探测 |
| `reui:pong` | iframe → Runtime | 心跳响应 |

#### 各消息接口定义

```typescript
// ── 握手 ──
interface HandshakeMessage extends BaseMessage {
  type: 'reui:handshake';
  version: 1;
  payload: {
    pluginId: string;        // 从 URL ?__reui_id= 自动获取
    sdkVersion: string;      // @reui/core 版本号
    capabilities?: string[]; // 插件声明需要的能力
  };
}

interface HandshakeAckMessage extends BaseMessage {
  type: 'reui:handshake-ack';
  version: 1;
  payload: {
    sessionId: string;       // Runtime 分配的会话 ID
    pluginId: string;        // 确认的插件 ID
    runtimeOrigin: string;   // Runtime origin，SDK 后续消息发往此 origin
    permissions: string[];   // 该插件被授予的权限列表
    config: {
      layer: string;
      allowedEvents: string[];
    };
  };
}

interface HandshakeRejectMessage extends BaseMessage {
  type: 'reui:handshake-reject';
  version: 1;
  payload: {
    reason: string;
    code: 'UNKNOWN_PLUGIN' | 'VERSION_MISMATCH' | 'PERMISSION_DENIED';
  };
}

// ── 请求/响应 ──
interface RequestMessage extends BaseMessage {
  type: 'reui:request';
  version: 1;
  id: string;                // 唯一请求 ID，格式: "{pluginId}:{sequence}"
  method: string;            // 调用的方法名
  params?: unknown;          // 方法参数
}

interface ResponseMessage extends BaseMessage {
  type: 'reui:response';
  version: 1;
  id: string;                // 对应请求的 ID
  success: true;
  result: unknown;
}

interface ErrorResponseMessage extends BaseMessage {
  type: 'reui:response';
  version: 1;
  id: string;
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ── 推送 ──
interface PushMessage extends BaseMessage {
  type: 'reui:push';
  version: 1;
  event: string;             // 带命名空间前缀的事件名
  payload: unknown;
}

// ── 通知（Fire-and-Forget） ──
interface NotifyMessage extends BaseMessage {
  type: 'reui:notify';
  version: 1;
  method: string;
  params?: unknown;
}

// ── 心跳 ──
interface PingMessage extends BaseMessage {
  type: 'reui:ping';
  version: 1;
  timestamp: number;
}

interface PongMessage extends BaseMessage {
  type: 'reui:pong';
  version: 1;
  pluginId: string;
  timestamp: number;         // 原始 ping 的时间戳（用于计算 RTT）
}
```

#### 事件命名空间

Push 消息的 `event` 字段使用命名空间前缀区分来源：

| 前缀 | 来源 | 示例 |
|------|------|------|
| `event:` | EventBus 业务事件（插件间通讯） | `event:inventory:item-used` |
| `nui:` | 游戏端 NUI 事件 | `nui:player:health-changed` |
| `ws:` | WebSocket 频道消息 | `ws:chat:message` |
| `auth:` | 认证/权限状态变更 | `auth:userChanged` |
| `plugin:` | 插件生命周期事件 | `plugin:visibilityChanged` |

SDK 各模块在 API 层对开发者隐藏前缀细节：
- `event.on('inventory:item-used', ...)` → 内部订阅 `event:inventory:item-used`
- `nui.onGameEvent('player:health-changed', ...)` → 内部订阅 `nui:player:health-changed`
- `ws.subscribe('chat:message', ...)` → 内部订阅 `ws:chat:message`

---

### 3.2 MessageDispatcher（Runtime 侧统一入口）

Runtime 使用**单一** `message` 事件监听器，根据 `event.source` 区分消息来源并分流。

```typescript
class MessageDispatcher {
  private static instance: MessageDispatcher;
  private nuiBridge: NuiBridge;
  private postMessageRouter: PostMessageRouter;
  private pluginManager: PluginManager;

  constructor() {
    // 唯一的 message 监听入口
    window.addEventListener('message', this.dispatch.bind(this));
  }

  /**
   * 统一消息分流
   * 职责：来源鉴别 + 协议前缀过滤
   * 不做 version 检查（由 PostMessageRouter 负责）
   */
  private dispatch(event: MessageEvent): void {
    // ── 情况1：来自游戏端（FiveM SendNUIMessage） ──
    // 游戏端 postMessage 的 source 为 null 或 window 自身
    if (event.source === null || event.source === window) {
      this.nuiBridge.handleGameMessage(event.data);
      return;
    }

    // ── 情况2：来自已注册的 iframe ──
    const plugin = this.pluginManager.findBySource(event.source);
    if (plugin) {
      // 协议前缀快速过滤（非 reui: 消息直接丢弃）
      if (!event.data?.type?.startsWith('reui:')) return;
      // 转交 PostMessageRouter 做后续验证（version、capability）
      this.postMessageRouter.handlePluginMessage(plugin, event.data);
      return;
    }

    // ── 情况3：未知来源，忽略 ──
    if (__DEV__) {
      console.warn('[ReUI] Message from unknown source ignored', event.origin);
    }
  }
}
```

**关键设计决策：**

- **使用 `event.source`（而非 `event.origin`）鉴别来源**——因 iframe 使用 `sandbox="allow-scripts"`（不含 `allow-same-origin`），其 origin 始终为 `null`。`event.source` 是对 iframe `contentWindow` 的引用，浏览器保证无法伪造
- **单一入口**避免多个 listener 之间的竞争和遗漏
- **职责精简**：Dispatcher 仅做来源分流 + `reui:` 前缀快速过滤，详细验证下沉到 PostMessageRouter
- **游戏消息天然区分**：FiveM `SendNUIMessage` 的 `source` 为 `null` 或 `window`，与 iframe 消息无歧义

---

### 3.3 PostMessageRouter（Runtime 侧路由）

接收经 MessageDispatcher 分流后的插件消息，执行版本检查、capability 验证、方法路由分发。

```typescript
class PostMessageRouter {
  private handlers: Map<string, RequestHandler>;
  private pluginManager: PluginManager;
  private heartbeatMonitor: HeartbeatMonitor;

  /**
   * 处理来自插件的消息（由 MessageDispatcher 调用）
   * 消息已通过来源验证和协议前缀过滤
   * 此处负责：版本检查、capability 检查、路由分发
   */
  handlePluginMessage(plugin: PluginInstance, data: CoreMessage): void {
    // 1. 验证协议版本（严格相等）
    if (data.version !== PROTOCOL_VERSION) {
      this.sendError(plugin, data.id, 'VERSION_MISMATCH');
      return;
    }

    // 2. 根据消息类型分流
    switch (data.type) {
      case 'reui:handshake':
        this.handleHandshake(plugin, data);
        break;
      case 'reui:request':
        this.handleRequest(plugin, data);
        break;
      case 'reui:notify':
        this.handleNotify(plugin, data);
        break;
      case 'reui:pong':
        this.heartbeatMonitor.handlePong(plugin.id);
        break;
    }
  }

  private handleRequest(plugin: PluginInstance, msg: RequestMessage): void {
    // Capability 权限检查
    if (!this.checkCapability(plugin, msg.method)) {
      this.sendError(plugin, msg.id, 'CAPABILITY_DENIED');
      return;
    }

    // 路由到对应 handler
    const handler = this.handlers.get(msg.method);
    if (handler) {
      handler(plugin, msg);
    } else {
      this.sendError(plugin, msg.id, 'METHOD_NOT_FOUND');
    }
  }

  /**
   * event:subscribe 的分流逻辑
   * 根据事件名的命名空间前缀，将订阅转发到对应的内部服务
   */
  private handleEventSubscribe(plugin: PluginInstance, params: { event: string }): void {
    const { event } = params;
    const colonIdx = event.indexOf(':');
    const namespace = event.slice(0, colonIdx);

    switch (namespace) {
      case 'event':
        // EventBus 业务事件
        this.eventBus.subscribeForPlugin(plugin.id, event, (payload) => {
          plugin.postMessage({ type: 'reui:push', version: 1, event, payload });
        });
        break;
      case 'nui':
        // NUI 游戏事件
        this.nuiBridge.onGameEvent(event.slice(colonIdx + 1), (payload) => {
          plugin.postMessage({ type: 'reui:push', version: 1, event, payload });
        });
        break;
      case 'ws':
        // WebSocket 频道
        this.wsManager.subscribe(event.slice(colonIdx + 1), (payload) => {
          plugin.postMessage({ type: 'reui:push', version: 1, event, payload });
        });
        break;
      case 'auth':
      case 'plugin':
        // 系统事件
        this.systemEventRegistry.register(plugin.id, event);
        break;
      default:
        this.sendError(plugin, null, {
          code: 'INVALID_PARAMS',
          message: `Unknown event namespace: "${namespace}"`,
        });
    }
  }

  registerHandler(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler);
  }
}
```

**职责分层：**

| 层级 | 组件 | 职责 |
|------|------|------|
| L1 | MessageDispatcher | 来源鉴别 + `reui:` 前缀快速过滤 |
| L2 | PostMessageRouter | 版本检查 + capability 权限 + 方法路由 |

---

### 3.4 NUI Bridge（游戏端桥接）

Runtime 与 FiveM 游戏端的双向通讯桥接。不自行监听 `message` 事件，由 MessageDispatcher 分发。

```typescript
class NuiBridge {
  private static instance: NuiBridge;
  private resourceName: string = '';
  private eventBus: EventBus;

  /**
   * 处理来自游戏的 NUI 消息（由 MessageDispatcher 调用）
   */
  handleGameMessage(data: unknown): void {
    if (data && typeof data === 'object' && 'type' in data) {
      const msg = data as { type: string; payload?: unknown };

      // 特殊处理：初始化消息（获取 resourceName）
      if (msg.type === 'reui:init' && msg.payload) {
        const { resourceName } = msg.payload as { resourceName: string };
        this.resourceName = resourceName;
        return;
      }

      // 其他游戏消息通过 EventBus 分发
      this.eventBus.emit(`nui:${msg.type}`, msg.payload);
    }
  }

  /**
   * 向游戏端发送 NUI Callback
   * 使用标准 FiveM fetch 方式：fetch('https://{resourceName}/{eventName}')
   */
  async sendToGame(eventName: string, data?: unknown): Promise<unknown> {
    if (!this.resourceName) {
      throw new Error(
        '[ReUI] NUI Bridge not initialized: resourceName is empty. ' +
        'Ensure reui:init message has been received before calling sendToGame.'
      );
    }

    const response = await fetch(`https://${this.resourceName}/${eventName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? {}),
    });
    return response.json();
  }

  /**
   * 注册 NUI 事件处理器
   */
  onGameEvent(eventName: string, handler: (data: unknown) => void): Unsubscribe {
    return this.eventBus.on(`nui:${eventName}`, handler);
  }
}
```

**关键约束：**

- `resourceName` 通过游戏端 `client.lua` 启动时发送的 `reui:init` 消息获取
- 必须防护 `resourceName` 为空时的调用（抛出明确错误而非发送无效请求）
- 所有来自游戏的消息通过 EventBus 分发，事件名加 `nui:` 前缀
- 子页面不直接与游戏通讯，必须通过 Runtime 中转

---

### 3.5 Client 类（@reui/core 侧通讯核心）

`Client` 是 iframe 侧 SDK 的底层核心，负责与 Runtime 的全部 postMessage 交互。

```typescript
class Client {
  private static instance: Client;
  private requestId: number = 0;
  private pendingRequests: Map<string, PendingRequest>;
  private eventHandlers: Map<string, Set<Handler>>;
  private ready: boolean = false;
  private readyPromise: Promise<void>;
  private pluginId: string;
  private runtimeOrigin: string;

  static getInstance(): Client;

  /**
   * 初始化：解析 pluginId，发起握手，等待确认
   */
  async init(options?: InitOptions): Promise<void> {
    this.pluginId = this.resolvePluginId(options);

    // 握手阶段尚未获知 Runtime origin，使用 '*'
    window.parent.postMessage({
      type: 'reui:handshake',
      version: 1,
      payload: {
        pluginId: this.pluginId,
        sdkVersion: SDK_VERSION,
      },
    }, '*');

    // 等待 handshake-ack 或超时
    await this.readyPromise;
  }

  /**
   * pluginId 解析
   * 优先 options 中显式指定（向后兼容、测试场景）
   * 其次从 URL ?__reui_id= 参数获取（Runtime 创建 iframe 时追加）
   *
   * 注意：iframe 使用 sandbox="allow-scripts"（不含 allow-same-origin），
   * window.frameElement 不可用（跨域返回 null），改用 URL 参数传递 pluginId
   */
  private resolvePluginId(options?: InitOptions): string {
    if (options?.pluginId) return options.pluginId;

    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('__reui_id');
    if (urlId) return urlId;

    throw new Error(
      '[ReUI] Cannot resolve pluginId. ' +
      'Ensure the iframe URL contains ?__reui_id=<pluginId> query parameter, ' +
      'or pass pluginId in init options.'
    );
  }

  /**
   * 请求-响应模式：向 Runtime 发送请求并等待结果
   */
  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();

    const id = `${this.pluginId}:${++this.requestId}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new ReUIError('TIMEOUT', method, `Request timeout: ${method}`));
      }, REQUEST_TIMEOUT);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      window.parent.postMessage({
        type: 'reui:request',
        version: 1,
        id,
        method,
        params,
      }, this.runtimeOrigin);
    });
  }

  /**
   * 订阅 Runtime 下发的事件/推送
   * 首次订阅某事件时通知 Runtime (event:subscribe)
   *
   * init 之前调用：本地 handler 立即注册，subscribe 请求等待 ready 后发出
   */
  onPush(event: string, handler: Handler): Unsubscribe {
    const isNew = !this.eventHandlers.has(event);
    if (isNew) this.eventHandlers.set(event, new Set());
    this.eventHandlers.get(event)!.add(handler);

    if (isNew) {
      this.ensureReady().then(() => {
        this.request('event:subscribe', { event }).catch((err) => {
          console.warn(`[ReUI] Failed to subscribe to "${event}":`, err);
        });
      });
    }

    return () => this.offPush(event, handler);
  }

  /**
   * 取消订阅
   * 最后一个 handler 移除时通知 Runtime (event:unsubscribe)
   */
  private offPush(event: string, handler: Handler): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    handlers.delete(handler);

    if (handlers.size === 0) {
      this.eventHandlers.delete(event);
      this.request('event:unsubscribe', { event }).catch((err) => {
        console.warn(`[ReUI] Failed to unsubscribe from "${event}":`, err);
      });
    }
  }

  /**
   * 消息处理入口
   */
  private handleMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg?.type?.startsWith('reui:')) return;

    switch (msg.type) {
      case 'reui:response':
        this.handleResponse(msg);
        break;
      case 'reui:push':
        this.handlePush(msg);
        break;
      case 'reui:handshake-ack':
        this.handleHandshakeAck(msg);
        break;
      case 'reui:handshake-reject':
        this.handleHandshakeReject(msg);
        break;
      case 'reui:ping':
        this.handlePing(msg);
        break;
    }
  }

  /**
   * 处理握手确认：记录 Runtime origin，标记 ready
   */
  private handleHandshakeAck(msg: HandshakeAckMessage): void {
    this.runtimeOrigin = msg.payload.runtimeOrigin ?? '*';
    this.ready = true;
    // resolve readyPromise
  }

  /**
   * 处理握手拒绝：reject readyPromise 并携带拒绝原因
   */
  private handleHandshakeReject(msg: HandshakeRejectMessage): void {
    const { reason, code } = msg.payload;
    this.ready = false;
    // reject readyPromise with ReUIError(code, 'handshake', reason)
  }

  /**
   * 自动响应 Runtime 心跳 ping（开发者无需关心）
   */
  private handlePing(msg: PingMessage): void {
    window.parent.postMessage({
      type: 'reui:pong',
      version: 1,
      pluginId: this.pluginId,
      timestamp: msg.timestamp,
    }, this.runtimeOrigin);
  }
}
```

---

### 3.6 握手流程

握手是建立 Runtime ↔ iframe 通讯信道的第一步。

**时序图：**

```
iframe(@reui/core)                         Runtime
  │                                           │
  │  [从 URL ?__reui_id= 读取 pluginId]       │
  │                                           │
  │  ─── reui:handshake ──────────────────→   │
  │      {pluginId, sdkVersion}               │
  │                                           │
  │                         ┌─ 验证 pluginId（是否已注册）
  │                         │  验证 SDK 版本兼容性
  │                         │  检查插件 capabilities
  │                         └─ 分配 sessionId
  │                                           │
  │  ←── reui:handshake-ack ──────────────    │  (验证通过)
  │      {sessionId, permissions,             │
  │       runtimeOrigin, config}              │
  │                                           │
  │  [记录 runtimeOrigin]                     │
  │  [SDK 标记为 ready]                       │
  │  [后续消息 targetOrigin = runtimeOrigin]   │
  │                                           │
  │  ─── reui:request ────────────────────→   │  (正常通讯开始)
```

**超时与重试策略：**

| 参数 | 值 | 说明 |
|------|---|------|
| 握手等待超时 | 5s | 每次握手尝试的最大等待时间 |
| 最大重试次数 | 3 | 超时后重试上限 |
| 重试间隔 | 1s, 2s, 4s | 指数退避 |
| 最终失败 | 抛出 `HandshakeTimeoutError` | 3 次均超时后 SDK 进入不可用状态 |

**握手拒绝场景：**

| 拒绝码 | 触发条件 |
|--------|----------|
| `UNKNOWN_PLUGIN` | pluginId 未在 Runtime 插件注册表中找到 |
| `VERSION_MISMATCH` | SDK 版本与 Runtime 支持的协议版本不兼容 |
| `PERMISSION_DENIED` | 当前玩家权限不满足该插件的加载条件 |

---

### 3.7 心跳机制

Runtime 通过 ping/pong 监控所有已握手成功的 iframe 健康状态。

```typescript
class HeartbeatMonitor {
  private static instance: HeartbeatMonitor;
  private intervals: Map<string, number>;     // pluginId → intervalId
  private lastPong: Map<string, number>;      // pluginId → timestamp
  private missedCounts: Map<string, number>;  // pluginId → missed count

  private readonly PING_INTERVAL = 10_000;    // 每 10 秒 ping 一次
  private readonly PONG_TIMEOUT = 5_000;      // 5 秒内未收到 pong 视为超时
  private readonly MAX_MISSED = 3;            // 连续 3 次超时视为崩溃

  startMonitoring(plugin: PluginInstance): void {
    this.lastPong.set(plugin.id, Date.now());
    this.missedCounts.set(plugin.id, 0);

    const intervalId = setInterval(() => {
      const pingTime = Date.now();
      plugin.postMessage({ type: 'reui:ping', version: 1, timestamp: pingTime });

      setTimeout(() => {
        const lastPong = this.lastPong.get(plugin.id) ?? 0;
        if (lastPong < pingTime) {
          const missed = (this.missedCounts.get(plugin.id) ?? 0) + 1;
          this.missedCounts.set(plugin.id, missed);
          if (missed >= this.MAX_MISSED) {
            this.handlePluginCrash(plugin);
          }
        } else {
          this.missedCounts.set(plugin.id, 0);
        }
      }, this.PONG_TIMEOUT);
    }, this.PING_INTERVAL);

    this.intervals.set(plugin.id, intervalId);
  }

  handlePong(pluginId: string): void {
    this.lastPong.set(pluginId, Date.now());
    this.missedCounts.set(pluginId, 0);
  }

  /** 隐藏插件暂停心跳（避免浏览器节流导致误报） */
  pauseMonitoring(pluginId: string): void {
    const intervalId = this.intervals.get(pluginId);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(pluginId);
    }
  }

  /** 插件重新可见时恢复监控 */
  resumeMonitoring(plugin: PluginInstance): void {
    if (this.intervals.has(plugin.id)) return;
    this.lastPong.set(plugin.id, Date.now());
    this.missedCounts.set(plugin.id, 0);
    this.startMonitoring(plugin);
  }

  private handlePluginCrash(plugin: PluginInstance): void {
    console.error(`[ReUI] Plugin "${plugin.id}" is not responding. Marking as error.`);
    this.stopMonitoring(plugin.id);
    plugin.state = 'error';
    EventBus.getInstance().emit('plugin:crashed', { pluginId: plugin.id });
  }
}
```

**心跳时序：**

```
Runtime                              iframe
  │                                    │
  │  ─── reui:ping ─────────────────→  │
  │  {timestamp: 1716700000000}        │
  │                                    │
  │  ←── reui:pong ─────────────────   │  (SDK 自动响应)
  │  {pluginId:"inv", timestamp:...}   │
  │                                    │
  │       ... 10s later ...            │
  │                                    │
  │  ─── reui:ping ─────────────────→  │
  │  {timestamp: 1716700010000}        │
  │                                    │
  │  [5s 内无 pong → missedCount++]    │
  │  [missedCount >= 3 → error]        │
```

**设计要点：**

- 每个 iframe 独立监控，单个崩溃不影响其他插件
- SDK 侧自动响应 ping，开发者无需编写任何代码
- 隐藏状态（`hidden`）的插件暂停心跳监控（浏览器对不可见 iframe 节流 JS 执行，可能导致 pong 超时误报）
- 崩溃处理流程：标记 `error` 状态 → 通知 EventBus (`plugin:crashed`) → 由 PluginManager 决定是否自动重载
- 开发模式下心跳超时阈值可适当放宽（避免调试时误报）

---

## 4. API 定义

### 4.1 方法注册表（Runtime PostMessageRouter 支持的 methods）

#### 事件相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `event:subscribe` | `{event: string}` | `void` | 订阅事件（event 含命名空间前缀） |
| `event:unsubscribe` | `{event: string}` | `void` | 取消订阅 |
| `event:emit` | `{event: string, payload?: any}` | `void` | 发布事件（广播给其他订阅插件） |

> **统一机制：** 所有类型的事件订阅（EventBus、NUI、WebSocket）都通过 `event:subscribe` / `event:unsubscribe` 方法管理。Runtime 根据事件名的命名空间前缀分流到对应的内部服务。

#### HTTP 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `http:request` | `{method, url, data?, headers?, params?}` | `{status, data, headers}` | 代理 HTTP 请求 |

#### WebSocket 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `ws:send` | `{channel: string, data: any}` | `void` | 通过 Runtime WS 连接发送消息 |
| `ws:state` | — | `{state: string}` | 查询连接状态 |

#### Auth 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `auth:getUser` | — | `UserInfo \| null` | 获取当前用户 |
| `auth:hasPermission` | `{permission: string}` | `boolean` | 检查单个权限 |
| `auth:checkPermissions` | `{permissions: string[]}` | `Record<string,boolean>` | 批量检查权限 |

#### NUI 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `nui:send` | `{event: string, data?: any}` | `any` | 发送 NUI Callback 到游戏端 |

#### Plugin 自身

| method | params | response | 说明 |
|--------|--------|----------|------|
| `plugin:getConfig` | — | `PluginManifest` | 获取插件配置 |
| `plugin:show` | — | `void` | 请求显示自己 |
| `plugin:hide` | — | `void` | 请求隐藏自己 |
| `plugin:ready` | — | `void` | 通知 Runtime 渲染完成 |
| `plugin:saveState` | `{state: any}` | `void` | 保存状态到 Runtime 临时存储 |
| `plugin:restoreState` | — | `any \| null` | 恢复上次保存的状态 |

### 4.2 错误码定义

| Code | 含义 | 触发条件 |
|------|------|----------|
| `TIMEOUT` | 请求超时 | Runtime 未在规定时间内响应 |
| `NOT_READY` | 未就绪 | 握手未完成就发送请求 |
| `PERMISSION_DENIED` | 权限不足 | 用户权限不满足插件要求 |
| `CAPABILITY_DENIED` | 能力未授予 | 调用未声明 capability 的 API |
| `METHOD_NOT_FOUND` | 方法不存在 | method 字段无对应处理器 |
| `INVALID_PARAMS` | 参数错误 | params 格式或类型不合规 |
| `VERSION_MISMATCH` | 协议版本不匹配 | 消息 version 不被 Runtime 支持 |
| `RUNTIME_ERROR` | 运行时错误 | Runtime 执行过程中出错 |
| `NETWORK_ERROR` | 网络错误 | HTTP/WS 通讯失败 |
| `PLUGIN_NOT_FOUND` | 插件未注册 | 握手时 pluginId 未在配置中 |
| `EVENT_DENIED` | 事件未授权 | 订阅不在 events 白名单中的事件 |

### 4.3 @reui/core 公开 API

```typescript
// 初始化（pluginId 自动从 URL ?__reui_id= 获取）
export async function init(options?: InitOptions): Promise<void>;

// 模块单例
export const event: ReUIEvent;   // 事件订阅/发布
export const http: ReUIHttp;     // HTTP 请求代理
export const ws: ReUIWebSocket;  // WebSocket 消息
export const auth: ReUIAuth;     // 权限认证查询
export const nui: ReUINui;       // NUI 游戏事件
export const plugin: ReUIPlugin; // 插件自身状态

// 错误类
export class ReUIError extends Error {
  code: string;      // 错误码（见 4.2 错误码定义）
  method: string;    // 调用的方法
  details?: unknown; // 额外错误信息
}
```

---

## 5. 安全考量

### 5.1 iframe 沙箱隔离

```html
<iframe
  src="plugin/index.html?__reui_id=inventory"
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
></iframe>
```

- **不包含 `allow-same-origin`**：iframe origin 为 opaque `null`，无法访问父页面 DOM/Storage/Cookie
- 消息验证改用 `event.source`（无法伪造的 contentWindow 引用）
- 开发模式下追加 `allow-same-origin`（HMR WebSocket 需要），但生产模式**绝对不包含**

### 5.2 来源验证两层架构

| 层 | 组件 | 检查内容 | 拒绝行为 |
|----|------|---------|---------|
| L1 | MessageDispatcher | `event.source` 匹配已注册 iframe + `reui:` 前缀 | 静默丢弃 |
| L2 | PostMessageRouter | `version` 严格匹配 + capability 白名单 | 返回结构化错误响应 |

### 5.3 Capability 访问控制

- 每次 `reui:request` 检查插件是否具备调用该 method 所需的 capability
- 事件订阅检查 `allowedEvents` 白名单
- Capability 未通过时返回 `CAPABILITY_DENIED` 错误
- Capability 在握手阶段由 Runtime 根据 plugin.json manifest 声明授予

### 5.4 攻击面分析

| 攻击向量 | 防护措施 |
|----------|----------|
| 伪造 pluginId | 握手时 Runtime 验证 pluginId 是否在注册表中 |
| 伪造 event.source | `event.source` 是浏览器引擎提供的引用，无法通过 JS 伪造 |
| 越权调用 method | PostMessageRouter 每次请求检查 capability 白名单 |
| 订阅未授权事件 | 事件订阅检查 manifest 中声明的 `events` 白名单 |
| 协议版本降级 | 严格相等匹配，不支持向下兼容 |
| 恶意 iframe 注入 | 未在 PluginManager 注册的 source 直接忽略 |
| 心跳 pong 伪造 | pong 必须来自 source 匹配的已注册 iframe |

### 5.5 开发模式安全豁免

开发模式下的差异（仅本地开发时生效）：

- iframe 追加 `allow-same-origin`（HMR WebSocket 需要建立连接）
- 心跳超时阈值放宽（避免调试断点时误报崩溃）
- 控制台输出详细消息日志（方便调试）

> **安全说明：** 开发模式下追加 `allow-same-origin` 意味着 iframe 可访问父页面 DOM/Storage，仅在本地开发时可接受。生产模式**绝对不包含**此权限。

---

## 6. 测试计划

### 6.1 单元测试

| 组件 | 测试项 |
|------|--------|
| MessageDispatcher | `source === null/window` → 转发 NuiBridge |
| MessageDispatcher | `source` 匹配已注册 iframe → 转发 PostMessageRouter |
| MessageDispatcher | 未知 source → 静默丢弃 |
| MessageDispatcher | 非 `reui:` 前缀消息 → 丢弃 |
| PostMessageRouter | `version !== PROTOCOL_VERSION` → 返回 VERSION_MISMATCH |
| PostMessageRouter | 无 capability → 返回 CAPABILITY_DENIED |
| PostMessageRouter | 未知 method → 返回 METHOD_NOT_FOUND |
| PostMessageRouter | 正常请求 → 正确路由到 handler |
| NuiBridge | `reui:init` → 正确存储 resourceName |
| NuiBridge | `sendToGame` 未初始化 → 抛出明确错误 |
| NuiBridge | 正常消息 → 通过 EventBus 分发 |
| Client.init | 从 URL `?__reui_id=` 正确解析 pluginId |
| Client.init | 手动传入 `options.pluginId` 优先使用 |
| Client.init | 无法解析 pluginId → 抛出错误 |
| Client.init | 握手超时 → 1s/2s/4s 退避重试 → 3 次失败抛 HandshakeTimeoutError |
| Client.request | 正确生成 `{pluginId}:{sequence}` 格式 ID |
| Client.request | 超时后清理 pendingRequests 并 reject |
| Client.request | 收到匹配 response → resolve |
| Client.onPush | 首次订阅 → 触发 event:subscribe 请求 |
| Client.offPush | 最后一个 handler 移除 → 触发 event:unsubscribe |
| Client.handlePing | 自动发回 pong（含正确 pluginId 和 timestamp） |
| HeartbeatMonitor | 正常 pong → missedCount 重置为 0 |
| HeartbeatMonitor | 超时 → missedCount 递增 |
| HeartbeatMonitor | missedCount >= 3 → 触发 crash 处理 |
| HeartbeatMonitor | pause → 停止 ping / resume → 重新开始 |

### 6.2 集成测试

| 场景 | 验证内容 |
|------|---------|
| 完整握手流程 | iframe 加载 → 自动握手 → 收到 ack → SDK ready → 可正常 request |
| 握手拒绝 | 未注册 pluginId → reject → SDK 抛出 ReUIError |
| 握手超时重试 | Runtime 延迟响应 → SDK 重试 → 最终成功 |
| 请求/响应往返 | Client.request → Dispatcher → Router → handler → response → resolve |
| 事件订阅推送 | subscribe → Runtime 记录 → emit → push 到达 iframe → handler 执行 |
| 心跳正常 | ping → pong → missedCount 保持 0 |
| 心跳崩溃 | ping → 无 pong × 3 → plugin.state = 'error' |
| 隐藏暂停 | hide → 暂停 ping / show → 恢复 ping |
| 多插件隔离 | 插件 A 崩溃 → 插件 B 不受影响，继续正常通讯 |

### 6.3 边界测试

- 多个 iframe 同时发起握手（并发安全）
- 握手完成前调用 request（应等待 ready 或抛 NOT_READY）
- 高频 request 场景下的 ID 唯一性验证
- iframe 被销毁后 Runtime 侧的资源清理（心跳停止、订阅清除）
- `postMessage` 携带不可序列化数据时的错误处理
- 网络延迟模拟下超时机制正确触发

---

## 7. 验收标准

### 7.1 功能验收

- [ ] MessageDispatcher 正确区分游戏消息（`source === null/window`）和 iframe 消息
- [ ] PostMessageRouter 对 `version !== 1` 的消息返回 `VERSION_MISMATCH`
- [ ] PostMessageRouter 对无 capability 的 method 调用返回 `CAPABILITY_DENIED`
- [ ] NuiBridge 在 `resourceName` 为空时抛出明确错误
- [ ] NuiBridge 正确将游戏消息通过 EventBus 分发
- [ ] Client.init() 能自动从 URL `?__reui_id=` 解析 pluginId
- [ ] 握手超时后按 1s/2s/4s 间隔重试，3 次失败抛出 `HandshakeTimeoutError`
- [ ] 握手成功后 Client 记录 runtimeOrigin 并用于后续消息的 targetOrigin
- [ ] `request()` 在超时后 reject 并清理 pendingRequests
- [ ] `onPush()` 首次订阅时自动发送 `event:subscribe`
- [ ] `offPush()` 最后一个 handler 移除时发送 `event:unsubscribe`
- [ ] HeartbeatMonitor 对连续 3 次无 pong 的插件标记为 `error`
- [ ] 隐藏的插件暂停心跳，恢复可见后重新开始监控

### 7.2 性能验收

- [ ] MessageDispatcher 单次分流处理耗时 < 0.1ms
- [ ] 支持同时管理 20+ 个 iframe 的心跳监控无性能问题
- [ ] request/response 往返延迟 < 5ms（不含业务逻辑耗时）
- [ ] @reui/core 打包体积 < 10KB gzipped

### 7.3 安全验收

- [ ] 未注册来源的消息被静默丢弃，无任何副作用
- [ ] 版本不匹配的消息收到明确的 VERSION_MISMATCH 错误响应
- [ ] 未授权 capability 调用返回 CAPABILITY_DENIED
- [ ] 事件订阅白名单外的事件返回 EVENT_DENIED
- [ ] 生产模式 iframe 不包含 `allow-same-origin`

### 7.4 代码质量验收

- [ ] 所有消息类型有完整 TypeScript 类型定义，无 `any` 类型逃逸
- [ ] 单元测试覆盖率 > 90%
- [ ] 错误信息包含足够的调试上下文（pluginId、method、错误码）
- [ ] 关键路径有 JSDoc 注释

---

## 8. 依赖关系

### 8.1 本 RFC 的外部依赖

| 依赖 | 说明 |
|------|------|
| 浏览器 postMessage API | 核心通讯机制 |
| FiveM CEF（Chromium Embedded Framework） | 运行环境 |
| FiveM SendNUIMessage | 游戏→CEF 消息通道 |
| FiveM fetch NUI Callback | CEF→游戏 消息通道 |
| TypeScript | 类型系统 |
| Vite | @reui/core 打包（ESM + CJS + UMD） |
| Vitest | 单元测试框架 |

### 8.2 被其他 RFC/Phase 依赖

```
RFC-001 (本文档) ─── 通讯协议与核心通讯层
  │
  ├── RFC-002: Runtime Services
  │   (EventBus, HttpClient, WebSocketManager, AuthService)
  │   依赖: PostMessageRouter 的 handler 注册机制
  │
  ├── RFC-003: Plugin Lifecycle
  │   (PluginManager, LayerSystem, 热重载)
  │   依赖: 握手流程 + 心跳监控 + PluginInstance.postMessage
  │
  └── RFC-004: Framework UI (@reui/framework)
      依赖: @reui/core 的公开 API (init, event, http, ws, auth, nui, plugin)
```

### 8.3 实现顺序建议

```
1. 协议类型定义（types.ts）— 所有消息接口 + 错误码枚举
2. MessageDispatcher — 统一消息入口 + 来源分流
3. NuiBridge — 游戏端桥接（handleGameMessage + sendToGame）
4. PostMessageRouter — 路由骨架（版本检查 + handler 注册 + capability 检查）
5. Client 类 — @reui/core 通讯核心（init + request + onPush + handleMessage）
6. 握手流程联调 — 双端集成（handshake → ack/reject → ready）
7. HeartbeatMonitor — 心跳监控（ping/pong + crash 检测 + pause/resume）
8. 集成测试 — 端到端全流程验证
```

---

## 附录 A：通讯模式速查

| 模式 | 方向 | 场景 | 是否需要响应 |
|------|------|------|-------------|
| Request/Response | iframe → Runtime → iframe | API 调用（HTTP、Auth、NUI 等） | 是 |
| Push | Runtime → iframe | 事件推送（游戏事件、WS消息等） | 否 |
| Notify (Fire-and-Forget) | iframe → Runtime | 日志上报、Telemetry | 否 |
| Ping/Pong | Runtime ↔ iframe | 心跳保活、健康检测 | 是（自动） |

## 附录 B：消息流完整示例

**场景：插件通过 SDK 发起 HTTP 请求**

```
 1. 插件代码调用 http.get('/api/players')
 2. ReUIHttp 内部调用 client.request('http:request', {method:'GET', url:'/api/players'})
 3. Client 生成 id="inventory:1"，发送 reui:request 到 parent (targetOrigin=runtimeOrigin)
 4. MessageDispatcher 收到消息，event.source 匹配 inventory 插件的 contentWindow
 5. 前缀检查通过（type 以 'reui:' 开头），转交 PostMessageRouter
 6. PostMessageRouter 验证 version=1 ✓，检查 inventory 插件有 http capability ✓
 7. 路由到 http:request handler
 8. Handler 调用 Runtime 的 HttpClient.get('/api/players')
 9. HttpClient 返回结果 {status:200, data:[...]}
10. PostMessageRouter 发送 reui:response {id:"inventory:1", success:true, result:{...}}
11. Client 收到 response，匹配 pendingRequests["inventory:1"]，清除 timeout，resolve promise
12. http.get() 返回数据给插件调用方
```

## 附录 C：事件订阅分流逻辑

PostMessageRouter 收到 `event:subscribe` 请求时，根据事件名的命名空间前缀分流到对应内部服务：

```typescript
private handleEventSubscribe(plugin: PluginInstance, params: { event: string }): void {
  const { event } = params;
  const colonIdx = event.indexOf(':');
  const namespace = event.slice(0, colonIdx);

  switch (namespace) {
    case 'event':  // → EventBus（插件间业务事件）
    case 'nui':    // → NuiBridge（游戏端 NUI 事件）
    case 'ws':     // → WebSocketManager（WS 频道消息）
    case 'auth':   // → AuthService（认证状态变更）
    case 'plugin': // → SystemEventRegistry（插件生命周期）
  }
}
```

所有类型的事件订阅/取消订阅都通过统一的 `event:subscribe` / `event:unsubscribe` 方法管理，Router 内部根据命名空间前缀分流，对子页面开发者完全透明。

## 附录 D：与 FiveM NUI 原生通讯的对比

| 维度 | FiveM 原生 NUI | ReUI 协议层 |
|------|----------------|-------------|
| 多 iframe 支持 | 不支持（单页面） | 支持（多 iframe 隔离管理） |
| 类型安全 | 无（纯 JSON） | 完整 TypeScript 类型定义 |
| 消息路由 | 手动 if/else | 统一 Dispatcher + Router |
| 健康监控 | 无 | Ping/Pong 心跳机制 |
| 权限控制 | 无 | Capability 白名单逐调用检查 |
| 版本管理 | 无 | 严格版本匹配 |
| 错误处理 | 静默失败 | 结构化错误码 + 超时机制 |
| 事件系统 | 无 | 命名空间事件 + 订阅管理 |
