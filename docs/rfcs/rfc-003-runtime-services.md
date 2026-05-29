# RFC-003: Phase 3 — Runtime 单例服务与 SDK 模块

| 字段     | 值                                      |
| -------- | --------------------------------------- |
| 编号     | RFC-003                                 |
| 标题     | Runtime 单例服务与 SDK 模块             |
| 状态     | 草案                                    |
| 作者     | ReUI Team                               |
| 创建日期 | 2026-05-27                              |
| 依赖     | RFC-001 (通讯协议), RFC-002 (插件系统)  |

---

## 1. 背景与动机

ReUI 的架构将所有基础设施能力集中在 Runtime 宿主页面中，子页面（插件 iframe）通过 `@reui/core` SDK 以 `postMessage` 代理的方式访问这些服务。这种设计带来以下优势：

- **单一连接**：WebSocket、HTTP 客户端由 Runtime 统一管理，避免每个插件各自建立连接导致资源浪费
- **统一认证**：Token 存储在 Runtime 内存中，子页面无法直接接触敏感凭据
- **生命周期管理**：插件卸载时 Runtime 可自动清理该插件的所有订阅与待处理请求
- **权限管控**：所有 API 调用经过 PostMessageRouter 的 capability 检查

本 RFC 详细定义 Runtime 侧四大单例服务（EventBus、WebSocket Manager、HTTP Client、Auth Service）的实现规范，以及 Core SDK 中对应的六个模块 API（event、http、ws、auth、nui、plugin）。

---

## 2. 目标与非目标

### 2.1 目标

- 定义 EventBus 的通配符匹配算法与插件订阅追踪机制
- 定义 WebSocket Manager 的自动重连策略与离线消息队列
- 定义 HTTP Client 的拦截器链与错误重试策略
- 定义 Auth Service 的被动模式接口与角色管理
- 定义 `event:subscribe` 请求的命名空间路由规则
- 定义 Core SDK 六个模块的完整 API 签名
- 定义统一的错误处理机制（ReUIError）
- 明确各模块的初始化时序与依赖关系

### 2.2 非目标

- 不涉及 PostMessage 通讯协议的底层格式（见 RFC-001）
- 不涉及插件加载/卸载的生命周期管理（见 RFC-002）
- 不涉及 `@reui/framework` UI 组件库的设计
- 不涉及 CLI 工具链的实现细节

---

## 3. 详细设计

### 3.1 EventBus（含通配符实现）

EventBus 是 Runtime 内部的全局事件总线，承载插件间通讯和系统事件分发。

#### 3.1.1 数据结构

```typescript
type Unsubscribe = () => void;
type EventHandler = (payload: unknown) => void;

class EventBus {
  private static instance: EventBus;

  /** 精确匹配的事件监听器 */
  private listeners: Map<string, Set<EventHandler>>;

  /** 通配符匹配的事件监听器 */
  private wildcardListeners: Map<string, Set<EventHandler>>;

  /** 插件订阅追踪：pluginId → Set<eventName> */
  private pluginSubscriptions: Map<string, Set<string>>;

  static getInstance(): EventBus;
}
```

#### 3.1.2 核心 API

```typescript
interface IEventBus {
  /**
   * 订阅事件
   * @param event - 事件名或通配符模式（如 "player:*"）
   * @param handler - 事件处理函数
   * @returns 取消订阅函数
   */
  on(event: string, handler: EventHandler): Unsubscribe;

  /**
   * 取消订阅
   */
  off(event: string, handler: EventHandler): void;

  /**
   * 单次订阅，触发后自动取消
   */
  once(event: string, handler: EventHandler): Unsubscribe;

  /**
   * 发布事件
   * 先触发精确匹配的 handler，再触发通配符匹配的 handler
   */
  emit(event: string, payload: unknown): void;

  /**
   * 为特定插件订阅事件（生命周期追踪）
   * 插件卸载时可一次性清理该插件的所有订阅
   */
  subscribeForPlugin(
    pluginId: string,
    event: string,
    handler: EventHandler
  ): Unsubscribe;

  /**
   * 清理指定插件的所有订阅
   * 在插件 unload 时由 PluginManager 调用
   */
  unsubscribePlugin(pluginId: string): void;
}
```

#### 3.1.3 通配符匹配规则

| 模式       | 含义                                   | 示例                                     |
| ---------- | -------------------------------------- | ---------------------------------------- |
| `prefix:*` | 匹配所有以 `prefix:` 开头的事件        | `player:*` 匹配 `player:health-changed`  |
| `*`        | 匹配所有事件（仅限管理插件使用）       | `*` 匹配任意事件名                       |
| 精确名称   | 仅匹配完全相同的事件名                 | `player:died` 仅匹配 `player:died`       |

#### 3.1.4 emit 实现逻辑

```typescript
emit(event: string, payload: unknown): void {
  // 阶段1: 精确匹配
  const exactHandlers = this.listeners.get(event);
  if (exactHandlers) {
    for (const handler of exactHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[ReUI:EventBus] Handler error for "${event}":`, err);
      }
    }
  }

  // 阶段2: 通配符匹配
  for (const [pattern, patternHandlers] of this.wildcardListeners) {
    if (this.matchPattern(pattern, event)) {
      for (const handler of patternHandlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[ReUI:EventBus] Wildcard handler error:`, err);
        }
      }
    }
  }
}

private matchPattern(pattern: string, event: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // "player:" from "player:*"
    return event.startsWith(prefix);
  }
  return false;
}
```

#### 3.1.5 插件订阅追踪

```typescript
subscribeForPlugin(
  pluginId: string,
  event: string,
  handler: EventHandler
): Unsubscribe {
  // 注册到 EventBus
  const unsub = this.on(event, handler);

  // 追踪到 pluginSubscriptions
  if (!this.pluginSubscriptions.has(pluginId)) {
    this.pluginSubscriptions.set(pluginId, new Set());
  }
  this.pluginSubscriptions.get(pluginId)!.add(event);

  return () => {
    unsub();
    this.pluginSubscriptions.get(pluginId)?.delete(event);
  };
}

unsubscribePlugin(pluginId: string): void {
  const events = this.pluginSubscriptions.get(pluginId);
  if (!events) return;

  // 移除该插件注册的所有 handler
  // 实际实现中需要维护 pluginId → handler 的映射以便精确移除
  this.pluginSubscriptions.delete(pluginId);
}
```

---

### 3.2 WebSocket Manager

Runtime 维护唯一的 WebSocket 连接，所有插件通过频道订阅机制复用该连接。

#### 3.2.1 状态机

```
                 connect()
  disconnected ───────────→ connecting
       ▲                        │
       │                        │ onopen
       │ max retries            ▼
       │ exceeded           connected
       │                        │
       │                        │ onclose / onerror
       │                        ▼
       └──────────────── reconnecting
                            │
                            │ backoff timer elapsed
                            │
                            └──→ connecting (循环)
```

状态定义：

```typescript
type WSState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
```

#### 3.2.2 核心 API

```typescript
interface WSOptions {
  /** 重连最大次数，默认 10 */
  maxRetries?: number;
  /** 初始重连延迟(ms)，默认 1000 */
  initialDelay?: number;
  /** 最大重连延迟(ms)，默认 30000 */
  maxDelay?: number;
  /** 离线队列最大容量，默认 100 */
  maxQueueSize?: number;
}

interface QueuedMessage {
  channel: string;
  data: unknown;
  timestamp: number;
}

type MessageHandler = (data: unknown) => void;

class WebSocketManager {
  private static instance: WebSocketManager;
  private ws: WebSocket | null = null;
  private _state: WSState = 'disconnected';
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandlers: Map<string, Set<MessageHandler>>;
  private pendingMessages: QueuedMessage[];
  private options: Required<WSOptions>;

  static getInstance(): WebSocketManager;

  /** 建立 WebSocket 连接 */
  connect(url: string, options?: WSOptions): void;

  /** 断开连接并清理 */
  disconnect(): void;

  /**
   * 发送消息到指定频道
   * 如果当前未连接，消息会加入离线队列，重连后自动发送
   */
  send(channel: string, data: unknown): void;

  /**
   * 订阅频道消息
   * @returns 取消订阅函数
   */
  subscribe(channel: string, handler: MessageHandler): Unsubscribe;

  /** 取消频道订阅 */
  unsubscribe(channel: string, handler: MessageHandler): void;

  /** 获取当前连接状态 */
  get state(): WSState;
}
```

#### 3.2.3 自动重连（指数退避）

```typescript
private scheduleReconnect(): void {
  if (this.reconnectAttempts >= this.options.maxRetries) {
    this._state = 'disconnected';
    this.emit('ws:disconnected', { reason: 'max_retries_exceeded' });
    return;
  }

  this._state = 'reconnecting';
  const delay = Math.min(
    this.options.initialDelay * Math.pow(2, this.reconnectAttempts),
    this.options.maxDelay
  );

  this.reconnectTimer = setTimeout(() => {
    this.reconnectAttempts++;
    this.doConnect();
  }, delay);
}
```

#### 3.2.4 离线消息队列

```typescript
send(channel: string, data: unknown): void {
  const message = { channel, data, timestamp: Date.now() };

  if (this._state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify(message));
  } else {
    // 加入离线队列
    if (this.pendingMessages.length >= this.options.maxQueueSize) {
      // 队列满时丢弃最早的消息
      this.pendingMessages.shift();
    }
    this.pendingMessages.push(message);
  }
}

private flushPendingMessages(): void {
  while (this.pendingMessages.length > 0) {
    const msg = this.pendingMessages.shift()!;
    this.ws!.send(JSON.stringify(msg));
  }
}
```

#### 3.2.5 频道分发

```typescript
private handleIncomingMessage(raw: MessageEvent): void {
  try {
    const { channel, data } = JSON.parse(raw.data) as {
      channel: string;
      data: unknown;
    };

    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[ReUI:WS] Handler error on channel "${channel}":`, err);
        }
      }
    }
  } catch (err) {
    console.error('[ReUI:WS] Failed to parse message:', err);
  }
}
```

---

### 3.3 HTTP Client

基于 Axios 的 HTTP 客户端单例，为所有插件提供统一的 HTTP 请求能力。

#### 3.3.1 核心 API

```typescript
interface HttpClientConfig {
  baseURL: string;
  timeout?: number;            // 默认 30000ms
  headers?: Record<string, string>;
  retryConfig?: RetryConfig;
}

interface RetryConfig {
  maxRetries: number;          // 默认 3
  retryDelay: number;          // 默认 1000ms
  retryOn: number[];           // 默认 [408, 429, 500, 502, 503, 504]
}

interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  timeout?: number;
  signal?: AbortSignal;
}

class HttpClient {
  private static instance: HttpClient;
  private axiosInstance: AxiosInstance;
  private authService: AuthService;

  static getInstance(): HttpClient;

  /** 配置 HTTP 客户端 */
  configure(config: HttpClientConfig): void;

  /** GET 请求 */
  get<T>(url: string, config?: RequestConfig): Promise<T>;

  /** POST 请求 */
  post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;

  /** PUT 请求 */
  put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;

  /** DELETE 请求 */
  delete<T>(url: string, config?: RequestConfig): Promise<T>;

  /** PATCH 请求 */
  patch<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;
}
```

#### 3.3.2 拦截器链

```typescript
private setupInterceptors(): void {
  // ── 请求拦截器：自动附加 Auth Token ──
  this.axiosInstance.interceptors.request.use((config) => {
    const token = this.authService.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // ── 响应拦截器：统一错误处理 ──
  this.axiosInstance.interceptors.response.use(
    (response) => response.data,
    async (error: AxiosError) => {
      // 重试逻辑
      if (this.shouldRetry(error)) {
        return this.retryRequest(error.config!);
      }

      // 标准化错误
      throw this.normalizeError(error);
    }
  );

  // ── 开发模式日志 ──
  if (__DEV__) {
    this.axiosInstance.interceptors.request.use((config) => {
      console.log(`[ReUI:HTTP] → ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.axiosInstance.interceptors.response.use(
      (response) => {
        console.log(`[ReUI:HTTP] ← ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error(`[ReUI:HTTP] ✗ ${error.response?.status} ${error.config?.url}`);
        return Promise.reject(error);
      }
    );
  }
}
```

#### 3.3.3 错误标准化

```typescript
interface HttpError {
  code: string;
  status: number;
  message: string;
  url: string;
  method: string;
}

private normalizeError(error: AxiosError): HttpError {
  return {
    code: error.code ?? 'UNKNOWN_ERROR',
    status: error.response?.status ?? 0,
    message: error.message,
    url: error.config?.url ?? '',
    method: error.config?.method?.toUpperCase() ?? '',
  };
}
```

---

### 3.4 Auth Service（被动模式 + 角色管理）

Auth Service 采用被动模式：认证由 FiveM 游戏服务器驱动（Steam/Discord/License），Runtime 仅接收认证状态并将查询 API 暴露给插件。

#### 3.4.1 数据类型

```typescript
interface UserInfo {
  id: string;                    // 玩家唯一标识
  name: string;                  // 显示名称
  identifiers: string[];         // FiveM identifiers (steam:xxx, discord:xxx)
  avatar?: string;               // 头像 URL
  [key: string]: unknown;        // 扩展字段
}

interface AuthState {
  user: UserInfo | null;
  permissions: Set<string>;
  roles: Set<string>;
  token: string | null;
}
```

#### 3.4.2 核心 API

```typescript
class AuthService {
  private static instance: AuthService;
  private currentUser: UserInfo | null = null;
  private permissions: Set<string> = new Set();
  private roles: Set<string> = new Set();
  private token: string | null = null;

  // 变更通知
  private userChangeHandlers: Set<(user: UserInfo | null) => void>;
  private permissionChangeHandlers: Set<(permissions: string[]) => void>;
  private tokenChangeHandlers: Set<(token: string | null) => void>;

  static getInstance(): AuthService;

  // ═══════════════════════════════════════════════
  // 游戏端推送接口（由 NUI Bridge 调用）
  // ═══════════════════════════════════════════════

  /**
   * 接收游戏端下发的用户信息
   * 触发 onUserChange 通知所有订阅者
   */
  updateUser(user: UserInfo | null): void;

  /**
   * 接收游戏端下发的权限列表
   * 触发 onPermissionChange 通知 + PluginManager 权限重评估
   */
  updatePermissions(permissions: string[]): void;

  /**
   * 接收游戏端下发的角色列表
   * 用于 plugin.json 中 roleRestriction 的评估
   */
  updateRoles(roles: string[]): void;

  /**
   * 接收游戏端下发的 Token
   * 仅 Runtime 内部使用（HttpClient 拦截器读取）
   */
  updateToken(token: string | null): void;

  // ═══════════════════════════════════════════════
  // 子页面查询接口（通过 PostMessageRouter 暴露）
  // ═══════════════════════════════════════════════

  /** 获取当前用户 */
  getUser(): UserInfo | null;

  /** 单权限检查 */
  hasPermission(permission: string): boolean;

  /** 是否拥有任一权限 */
  hasAnyPermission(permissions: string[]): boolean;

  /** 是否拥有全部权限 */
  hasAllPermissions(permissions: string[]): boolean;

  /** 获取所有已授予权限 */
  getPermissions(): string[];

  /** 获取当前角色列表 */
  getRoles(): string[];

  /** 检查是否拥有指定角色 */
  hasRole(role: string): boolean;

  // ═══════════════════════════════════════════════
  // Token 管理（仅 Runtime 内部）
  // ═══════════════════════════════════════════════

  /** 获取 Token — 仅 Runtime 内部使用，不暴露给子页面 */
  getToken(): string | null;

  // ═══════════════════════════════════════════════
  // 事件通知
  // ═══════════════════════════════════════════════

  /** 用户变更通知 */
  onUserChange(handler: (user: UserInfo | null) => void): Unsubscribe;

  /** 权限变更通知 */
  onPermissionChange(handler: (permissions: string[]) => void): Unsubscribe;

  /** Token 变更通知（仅 Runtime 内部使用） */
  onTokenChange(handler: (token: string | null) => void): Unsubscribe;
}
```

#### 3.4.3 被动模式工作流

```
Game Server                  Client (Lua)              Runtime (AuthService)
    │                            │                            │
    │  TriggerClientEvent        │                            │
    │  (reui:auth:update)        │                            │
    │───────────────────────────→│                            │
    │                            │  SendNUIMessage            │
    │                            │  (reui:auth-update)        │
    │                            │───────────────────────────→│
    │                            │                            │  updateUser()
    │                            │                            │  updatePermissions()
    │                            │                            │  updateRoles()
    │                            │                            │  updateToken()
    │                            │                            │
    │                            │                            │  通知所有子页面
    │                            │                            │  (auth:userChanged push)
```

#### 3.4.4 Token 安全策略

- Token 仅存储在 Runtime 的 AuthService 实例内存中
- 子页面 **无法** 通过任何 API 获取 Token 原文
- HttpClient 通过拦截器自动附加 Token，子页面只能间接使用
- Token 变更时 HttpClient 自动更新，无需子页面干预

---

### 3.5 事件订阅路由（event:subscribe 命名空间分流）

当 PostMessageRouter 收到子页面的 `event:subscribe` 请求时，根据事件名的命名空间前缀将订阅路由到不同的内部服务。

#### 3.5.1 命名空间定义

| 前缀      | 路由目标             | 说明                         |
| --------- | -------------------- | ---------------------------- |
| `event:`  | EventBus             | 业务事件（插件间通讯）       |
| `nui:`    | NuiBridge            | 游戏端 NUI 事件转发         |
| `ws:`     | WebSocketManager     | WebSocket 频道消息           |
| `auth:`   | SystemEventRegistry  | 认证状态变更事件             |
| `plugin:` | SystemEventRegistry  | 插件自身生命周期事件         |

#### 3.5.2 路由实现

```typescript
private handleEventSubscribe(
  plugin: PluginInstance,
  params: { event: string; id: string }
): void {
  const { event, id } = params;
  const colonIdx = event.indexOf(':');

  if (colonIdx === -1) {
    this.sendError(plugin, id, {
      code: 'INVALID_PARAMS',
      message: `Event name must contain namespace prefix: "${event}"`,
    });
    return;
  }

  const namespace = event.slice(0, colonIdx);
  const eventName = event.slice(colonIdx + 1);

  switch (namespace) {
    case 'event':
      // EventBus 业务事件 — 注册到 EventBus，触发时推送给该插件
      this.eventBus.subscribeForPlugin(plugin.id, eventName, (payload) => {
        plugin.postMessage({
          type: 'reui:push',
          version: 1,
          event,
          payload,
        });
      });
      this.sendSuccess(plugin, id);
      break;

    case 'nui':
      // NUI 游戏事件 — 在 NuiBridge 中注册转发
      this.nuiBridge.onGameEvent(eventName, (payload) => {
        plugin.postMessage({
          type: 'reui:push',
          version: 1,
          event,
          payload,
        });
      });
      this.sendSuccess(plugin, id);
      break;

    case 'ws':
      // WebSocket 频道 — 在 WebSocketManager 中订阅
      this.wsManager.subscribe(eventName, (payload) => {
        plugin.postMessage({
          type: 'reui:push',
          version: 1,
          event,
          payload,
        });
      });
      this.sendSuccess(plugin, id);
      break;

    case 'auth':
    case 'plugin':
      // 系统事件 — 由对应服务直接管理
      this.systemEventRegistry.register(plugin.id, event);
      this.sendSuccess(plugin, id);
      break;

    default:
      this.sendError(plugin, id, {
        code: 'INVALID_PARAMS',
        message: `Unknown event namespace: "${namespace}"`,
      });
  }
}
```

#### 3.5.3 取消订阅路由

```typescript
private handleEventUnsubscribe(
  plugin: PluginInstance,
  params: { event: string; id: string }
): void {
  const { event, id } = params;
  const colonIdx = event.indexOf(':');
  const namespace = event.slice(0, colonIdx);

  switch (namespace) {
    case 'event':
      // 从 EventBus 移除该插件对此事件的订阅
      this.eventBus.unsubscribePluginEvent(plugin.id, event.slice(colonIdx + 1));
      break;
    case 'nui':
    case 'ws':
    case 'auth':
    case 'plugin':
      this.systemEventRegistry.unregister(plugin.id, event);
      break;
  }

  this.sendSuccess(plugin, id);
}
```

---

## 4. Core SDK 模块 API

以下为 `@reui/core` 包暴露给子页面开发者的公开 API。所有模块内部通过 `Client` 的 `request()` 和 `onPush()` 方法与 Runtime 通讯。

### 4.1 event 模块

```typescript
// @reui/core/src/event.ts

export class ReUIEvent {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * 订阅业务事件
   * 支持通配符模式（如 "player:*"）
   *
   * @param eventName - 事件名称（不含 "event:" 前缀，SDK 自动添加）
   * @param handler - 事件处理函数
   * @returns 取消订阅函数
   *
   * @example
   * event.on('player:health-changed', (data) => { ... });
   * event.on('player:*', (data) => { ... }); // 通配符
   */
  on(eventName: string, handler: EventHandler): Unsubscribe {
    return this.client.onPush(`event:${eventName}`, handler);
  }

  /**
   * 发布事件
   * 事件会广播到 Runtime 的 EventBus，其他订阅的插件可收到
   *
   * @param eventName - 事件名称
   * @param payload - 事件数据（必须可序列化）
   *
   * @example
   * await event.emit('inventory:item-used', { itemId: 'medkit' });
   */
  async emit(eventName: string, payload?: unknown): Promise<void> {
    await this.client.request('event:emit', { event: eventName, payload });
  }

  /**
   * 单次订阅，触发一次后自动取消
   *
   * @example
   * event.once('game:round-start', (data) => { ... });
   */
  once(eventName: string, handler: EventHandler): Unsubscribe {
    const unsub = this.on(eventName, (payload) => {
      unsub();
      handler(payload);
    });
    return unsub;
  }
}
```

### 4.2 http 模块

```typescript
// @reui/core/src/http.ts

export interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  timeout?: number;
}

export class ReUIHttp {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * GET 请求
   * 由 Runtime 的 HttpClient 代理执行，自动附加 Auth Token
   *
   * @example
   * const players = await http.get<Player[]>('/api/players');
   */
  async get<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return this.client.request<T>('http:request', {
      method: 'GET',
      url,
      ...config,
    });
  }

  /**
   * POST 请求
   *
   * @example
   * const result = await http.post('/api/inventory/use', { itemId: 'medkit' });
   */
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<T> {
    return this.client.request<T>('http:request', {
      method: 'POST',
      url,
      data,
      ...config,
    });
  }

  /**
   * PUT 请求
   */
  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<T> {
    return this.client.request<T>('http:request', {
      method: 'PUT',
      url,
      data,
      ...config,
    });
  }

  /**
   * DELETE 请求
   */
  async delete<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return this.client.request<T>('http:request', {
      method: 'DELETE',
      url,
      ...config,
    });
  }

  /**
   * PATCH 请求
   */
  async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<T> {
    return this.client.request<T>('http:request', {
      method: 'PATCH',
      url,
      data,
      ...config,
    });
  }
}
```

### 4.3 ws 模块

```typescript
// @reui/core/src/ws.ts

export type WSState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
export type MessageHandler = (data: unknown) => void;

export class ReUIWebSocket {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * 订阅 WebSocket 频道消息
   * 实际 WS 连接由 Runtime 维护，子页面仅接收消息推送
   *
   * @param channel - 频道名称
   * @param handler - 消息处理函数
   * @returns 取消订阅函数
   *
   * @example
   * const unsub = ws.subscribe('chat:message', (msg) => {
   *   appendMessage(msg.sender, msg.text);
   * });
   */
  subscribe(channel: string, handler: MessageHandler): Unsubscribe {
    return this.client.onPush(`ws:${channel}`, handler);
  }

  /**
   * 通过 Runtime 的 WS 连接发送消息
   * 如果当前 WS 未连接，消息会进入 Runtime 的离线队列
   *
   * @param channel - 目标频道
   * @param data - 消息数据（必须可序列化）
   *
   * @example
   * await ws.send('chat:message', { text: 'Hello world' });
   */
  async send(channel: string, data: unknown): Promise<void> {
    await this.client.request('ws:send', { channel, data });
  }

  /**
   * 查询 WebSocket 连接状态
   *
   * @example
   * const state = await ws.getState(); // 'connected' | 'disconnected' | ...
   */
  async getState(): Promise<WSState> {
    return this.client.request<WSState>('ws:state');
  }

  /**
   * 监听 WS 连接状态变化
   *
   * @example
   * ws.onStateChange((state) => {
   *   if (state === 'disconnected') showOfflineIndicator();
   * });
   */
  onStateChange(handler: (state: WSState) => void): Unsubscribe {
    return this.client.onPush('ws:stateChanged', handler);
  }
}
```

### 4.4 auth 模块

```typescript
// @reui/core/src/auth.ts

export interface UserInfo {
  id: string;
  name: string;
  identifiers: string[];
  avatar?: string;
  [key: string]: unknown;
}

export class ReUIAuth {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * 获取当前用户信息
   * 如果玩家尚未认证或已登出，返回 null
   *
   * @example
   * const user = await auth.getUser();
   * if (user) {
   *   showWelcome(user.name);
   * }
   */
  async getUser(): Promise<UserInfo | null> {
    return this.client.request<UserInfo | null>('auth:getUser');
  }

  /**
   * 检查单个权限
   *
   * @example
   * const canUse = await auth.hasPermission('inventory.use');
   */
  async hasPermission(permission: string): Promise<boolean> {
    return this.client.request<boolean>('auth:hasPermission', { permission });
  }

  /**
   * 批量检查权限
   * 返回每个权限的检查结果映射
   *
   * @example
   * const result = await auth.checkPermissions(['admin.ban', 'admin.kick']);
   * // { 'admin.ban': true, 'admin.kick': false }
   */
  async checkPermissions(
    permissions: string[]
  ): Promise<Record<string, boolean>> {
    return this.client.request<Record<string, boolean>>(
      'auth:checkPermissions',
      { permissions }
    );
  }

  /**
   * 获取当前角色列表
   *
   * @example
   * const roles = await auth.getRoles(); // ['admin', 'moderator']
   */
  async getRoles(): Promise<string[]> {
    return this.client.request<string[]>('auth:getRoles');
  }

  /**
   * 监听用户状态变化
   * 当游戏端推送新的用户信息时触发
   *
   * @example
   * auth.onUserChange((user) => {
   *   if (user) updateAvatar(user.avatar);
   *   else showLoginPrompt();
   * });
   */
  onUserChange(handler: (user: UserInfo | null) => void): Unsubscribe {
    return this.client.onPush('auth:userChanged', handler);
  }

  /**
   * 监听权限变化
   * 当角色切换或权限更新时触发
   *
   * @example
   * auth.onPermissionChange((permissions) => {
   *   refreshPermissionDependentUI(permissions);
   * });
   */
  onPermissionChange(handler: (permissions: string[]) => void): Unsubscribe {
    return this.client.onPush('auth:permissionsChanged', handler);
  }
}
```

### 4.5 nui 模块

```typescript
// @reui/core/src/nui.ts

export class ReUINui {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * 监听来自游戏的 NUI 事件
   * Runtime 通过 NuiBridge 接收游戏消息后转发给订阅的插件
   *
   * @param eventName - NUI 事件名（不含 "nui:" 前缀）
   * @param handler - 事件处理函数
   * @returns 取消订阅函数
   *
   * @example
   * nui.onGameEvent('inventory:open', (data) => {
   *   showInventoryUI();
   * });
   *
   * nui.onGameEvent('player:health-changed', (data) => {
   *   updateHealthBar(data.health, data.maxHealth);
   * });
   */
  onGameEvent(eventName: string, handler: (data: unknown) => void): Unsubscribe {
    return this.client.onPush(`nui:${eventName}`, handler);
  }

  /**
   * 向游戏端发送 NUI Callback
   * 通过 Runtime 的 NuiBridge 代理，使用 fetch(https://resourceName/event) 方式
   *
   * @param eventName - NUI Callback 事件名
   * @param data - 发送的数据
   * @returns 游戏端返回的响应数据
   *
   * @example
   * const result = await nui.sendToGame('useItem', { itemId: 'medkit' });
   * if (result.success) { ... }
   */
  async sendToGame(eventName: string, data?: unknown): Promise<unknown> {
    return this.client.request('nui:send', { event: eventName, data });
  }
}
```

### 4.6 plugin 模块

```typescript
// @reui/core/src/plugin.ts

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  layer: 'hud' | 'panel' | 'overlay';
  capabilities: string[];
  [key: string]: unknown;
}

export class ReUIPlugin {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * 获取插件自身配置（来自 plugin.json manifest）
   *
   * @example
   * const config = await plugin.getConfig();
   * console.log(`Running as ${config.name} v${config.version}`);
   */
  async getConfig(): Promise<PluginConfig> {
    return this.client.request<PluginConfig>('plugin:getConfig');
  }

  /**
   * 请求显示自身
   * Panel 层插件调用后会通过 PluginManager 的 activatePanel 显示
   *
   * @example
   * await plugin.requestShow();
   */
  async requestShow(): Promise<void> {
    await this.client.request('plugin:show');
  }

  /**
   * 请求隐藏自身
   *
   * @example
   * await plugin.requestHide();
   */
  async requestHide(): Promise<void> {
    await this.client.request('plugin:hide');
  }

  /**
   * 监听自身可见性变化
   * 由 Runtime 的 LayerSystem / PluginManager 触发
   *
   * @example
   * plugin.onVisibilityChange((visible) => {
   *   if (visible) startAnimations();
   *   else pauseAnimations();
   * });
   */
  onVisibilityChange(handler: (visible: boolean) => void): Unsubscribe {
    return this.client.onPush('plugin:visibilityChanged', handler);
  }

  /**
   * 监听插件即将卸载
   * 用于热重载场景：在卸载前保存状态
   * Runtime 等待最多 5 秒后强制卸载
   *
   * @param handler - 接收卸载原因（'reload' | 'unload' | 'permission-revoked'）
   *
   * @example
   * plugin.onBeforeUnload(async (reason) => {
   *   if (reason === 'reload') {
   *     await plugin.saveState({ scrollPos: window.scrollY });
   *   }
   * });
   */
  onBeforeUnload(
    handler: (reason: string) => void | Promise<void>
  ): Unsubscribe {
    return this.client.onPush(
      'plugin:beforeUnload',
      (data: { reason: string }) => {
        handler(data.reason);
      }
    );
  }

  /**
   * 保存插件状态到 Runtime 临时存储
   * 数据在插件下次加载时可用（热重载保持状态）
   * 最大存储 1MB，超出会抛出 PAYLOAD_TOO_LARGE 错误
   *
   * @example
   * await plugin.saveState({ selectedTab: 'inventory', scrollY: 120 });
   */
  async saveState<T = unknown>(state: T): Promise<void> {
    await this.client.request('plugin:saveState', { state });
  }

  /**
   * 恢复上次保存的插件状态
   * 如果没有已保存的状态，返回 null
   *
   * @example
   * const saved = await plugin.restoreState<{ selectedTab: string }>();
   * if (saved) setActiveTab(saved.selectedTab);
   */
  async restoreState<T = unknown>(): Promise<T | null> {
    return this.client.request<T | null>('plugin:restoreState');
  }
}
```

---

## 5. 统一导出与初始化

### 5.1 导出结构

```typescript
// @reui/core/src/index.ts

import { Client } from './client';
import { ReUIEvent } from './event';
import { ReUIHttp } from './http';
import { ReUIWebSocket } from './ws';
import { ReUIAuth } from './auth';
import { ReUINui } from './nui';
import { ReUIPlugin } from './plugin';

// ── 单例实例（模块级单例，ESM 保证唯一性） ──
const client = Client.getInstance();

export const event = new ReUIEvent(client);
export const http = new ReUIHttp(client);
export const ws = new ReUIWebSocket(client);
export const auth = new ReUIAuth(client);
export const nui = new ReUINui(client);
export const plugin = new ReUIPlugin(client);

// ── 初始化函数 ──
export interface InitOptions {
  /** 手动指定 pluginId（通常自动从 URL 获取） */
  pluginId?: string;
  /** 请求超时时间(ms)，默认 10000 */
  timeout?: number;
}

/**
 * 初始化 SDK，与 Runtime 建立连接
 * pluginId 默认从 iframe URL 的 ?__reui_id= 参数自动获取
 *
 * @example
 * import { init, event, http } from '@reui/core';
 * await init();
 * // 现在可以使用所有模块
 */
export async function init(options?: InitOptions): Promise<void> {
  await client.init(options);
}

// ── 类导出（高级用户自定义场景） ──
export { Client, ReUIEvent, ReUIHttp, ReUIWebSocket, ReUIAuth, ReUINui, ReUIPlugin };

// ── 类型导出 ──
export type { UserInfo, PluginConfig, RequestConfig, WSState, MessageHandler };
export type { EventHandler, Unsubscribe };
export { ReUIError, ErrorCode } from './errors';
```

### 5.2 初始化时序

```
1. import { init, event, http, ... } from '@reui/core'
   └─ 创建 Client 单例 + 各模块实例（轻量，无副作用）

2. await init()
   ├─ 从 URL ?__reui_id= 解析 pluginId
   ├─ 注册 message 事件监听器
   ├─ 发送 reui:handshake 到 parent
   └─ 等待 reui:handshake-ack（超时 → reject）

3. 使用模块 API
   ├─ event.on(...)     → client.onPush('event:...')
   ├─ http.get(...)     → client.request('http:request', ...)
   ├─ ws.subscribe(...) → client.onPush('ws:...')
   └─ auth.getUser()    → client.request('auth:getUser')
```

### 5.3 init 之前调用 API 的行为

| 场景                      | 行为                                                 |
| ------------------------- | ---------------------------------------------------- |
| init 前调用 `event.on()`  | handler 注册到本地 Map，`event:subscribe` 等待 ready |
| init 前调用 `http.get()`  | Promise 会等待 ready 后再发出请求                    |
| init 失败后调用任何 API   | 立即 reject，错误码 `NOT_READY`                      |

---

## 6. 错误处理

### 6.1 ReUIError 类

```typescript
// @reui/core/src/errors.ts

export enum ErrorCode {
  /** 请求超时（默认 10s） */
  TIMEOUT = 'TIMEOUT',
  /** SDK 未初始化或初始化失败 */
  NOT_READY = 'NOT_READY',
  /** 插件无此操作的权限 */
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  /** 插件未声明所需的 capability */
  CAPABILITY_DENIED = 'CAPABILITY_DENIED',
  /** 请求的方法不存在 */
  METHOD_NOT_FOUND = 'METHOD_NOT_FOUND',
  /** Runtime 内部错误 */
  RUNTIME_ERROR = 'RUNTIME_ERROR',
  /** HTTP / WebSocket 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 协议版本不匹配 */
  VERSION_MISMATCH = 'VERSION_MISMATCH',
  /** 参数不合法 */
  INVALID_PARAMS = 'INVALID_PARAMS',
  /** 数据超过大小限制 */
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
}

export class ReUIError extends Error {
  /** 错误码 */
  readonly code: ErrorCode;
  /** 触发错误的方法 */
  readonly method: string;
  /** 额外信息 */
  readonly details?: unknown;

  constructor(code: ErrorCode, method: string, message?: string, details?: unknown) {
    super(message ?? `[ReUI] ${code} in ${method}`);
    this.name = 'ReUIError';
    this.code = code;
    this.method = method;
    this.details = details;
  }
}
```

### 6.2 Runtime 侧错误响应格式

```typescript
// Runtime → iframe 的错误响应
interface ErrorResponse {
  type: 'reui:response';
  version: 1;
  id: string;          // 对应请求的 id
  success: false;
  error: {
    code: string;      // ErrorCode 枚举值
    message: string;   // 人类可读描述
    details?: unknown; // 可选的额外信息
  };
}
```

### 6.3 错误传播链

```
Plugin Code → SDK Module → Client.request() → PostMessageRouter
                                                     │
                                            capability check fail?
                                            method not found?
                                            runtime internal error?
                                                     │
                                                     ▼
                              ErrorResponse (reui:response, success: false)
                                                     │
                                                     ▼
                              Client.handleResponse() → reject(new ReUIError(...))
                                                     │
                                                     ▼
                              Plugin Code catches error
```

### 6.4 使用示例

```typescript
import { http, auth, ReUIError, ErrorCode } from '@reui/core';

try {
  const data = await http.get('/api/admin/users');
} catch (err) {
  if (err instanceof ReUIError) {
    switch (err.code) {
      case ErrorCode.CAPABILITY_DENIED:
        showToast('此插件无权访问该接口');
        break;
      case ErrorCode.NETWORK_ERROR:
        showToast('网络连接失败，请重试');
        break;
      case ErrorCode.TIMEOUT:
        showToast('请求超时');
        break;
      default:
        console.error('Unexpected error:', err);
    }
  }
}
```

---

## 7. 测试计划

### 7.1 EventBus 单元测试

| 测试用例                                     | 预期结果                           |
| -------------------------------------------- | ---------------------------------- |
| `on('a', handler)` → `emit('a', data)`       | handler 被调用，收到 data          |
| `on('player:*', handler)` → `emit('player:died', data)` | handler 被调用         |
| `on('*', handler)` → `emit('any:event', data)` | handler 被调用                   |
| `on('a:*', handler)` → `emit('b:test', data)` | handler 不被调用                  |
| `subscribeForPlugin('p1', ...)` → `unsubscribePlugin('p1')` | 所有 p1 订阅清除 |
| `once()` 订阅                                | 仅触发一次后自动移除               |
| handler 抛出异常                             | 不影响其他 handler 执行            |

### 7.2 WebSocket Manager 单元测试

| 测试用例                                     | 预期结果                           |
| -------------------------------------------- | ---------------------------------- |
| 连接成功                                     | state = 'connected'                |
| 连接断开 → 自动重连                          | state 经历 reconnecting → connected |
| 离线时 send()                                | 消息入队，重连后自动发送           |
| 超过 maxRetries                              | state = 'disconnected'，不再重试   |
| subscribe/unsubscribe                        | 正确添加/移除频道 handler          |
| 队列溢出                                     | 丢弃最早的消息                     |

### 7.3 HTTP Client 单元测试

| 测试用例                                     | 预期结果                           |
| -------------------------------------------- | ---------------------------------- |
| GET 请求成功                                 | 返回响应数据                       |
| POST 请求携带 body                           | 正确序列化发送                     |
| Auth Token 自动附加                          | 请求头包含 Authorization           |
| Token 为 null 时                             | 不附加 Authorization 头            |
| 5xx 错误自动重试                             | 重试指定次数后返回错误             |
| 请求超时                                     | 抛出 TIMEOUT 错误                  |

### 7.4 Auth Service 单元测试

| 测试用例                                     | 预期结果                           |
| -------------------------------------------- | ---------------------------------- |
| updateUser() 后 getUser()                    | 返回更新后的用户信息               |
| updatePermissions() 后 hasPermission()       | 正确判断权限                       |
| updateRoles() 后 getRoles()                  | 返回更新后的角色列表               |
| updateUser() 触发 onUserChange               | 所有注册的 handler 收到通知        |
| updateToken() 后 getToken()                  | 返回新 Token                       |
| Token 不暴露给子页面                         | 子页面的 auth:getToken 请求被拒绝  |

### 7.5 集成测试

| 测试场景                                     | 验证点                             |
| -------------------------------------------- | ---------------------------------- |
| 子页面 `event.on()` → 另一子页面 `event.emit()` | 事件正确跨插件传递              |
| 子页面 `http.get()` → Runtime 代理           | Token 正确附加，响应正确返回       |
| 子页面 `ws.subscribe()` → WS 消息到达        | 消息正确推送到订阅的子页面         |
| 插件卸载 → 订阅自动清理                     | 不再收到事件推送                   |
| 权限变更 → 插件重评估                        | 无权限的插件被卸载                 |

---

## 8. 验收标准

### 8.1 功能验收

- [ ] EventBus 支持精确匹配和通配符匹配（`prefix:*` 和 `*`）
- [ ] EventBus 的 `subscribeForPlugin` / `unsubscribePlugin` 正确追踪和清理
- [ ] WebSocket Manager 实现指数退避自动重连（初始 1s，最大 30s）
- [ ] WebSocket Manager 离线消息队列最大容量 100，溢出时 FIFO 丢弃
- [ ] HTTP Client 自动附加 Auth Token
- [ ] HTTP Client 在 5xx/408/429 错误时自动重试（最多 3 次）
- [ ] Auth Service 被动模式：无 login/logout API
- [ ] Auth Service Token 不暴露给子页面（`auth:getToken` 方法不注册）
- [ ] `event:subscribe` 路由正确分流到 EventBus/NuiBridge/WS/System
- [ ] Core SDK 所有模块 API 类型安全，无 `any` 泄漏

### 8.2 性能验收

- [ ] EventBus emit 在 1000 个精确订阅时延迟 < 1ms
- [ ] 通配符订阅数量 ≤ 50 时 emit 性能无明显退化
- [ ] WebSocket 离线队列 flush 在 100 条消息时 < 50ms
- [ ] HTTP Client 拦截器链执行 < 1ms
- [ ] Core SDK 包体积 < 10KB gzipped

### 8.3 安全验收

- [ ] Token 仅存在于 Runtime 内存，子页面无法通过任何 API 获取
- [ ] PostMessageRouter 对每个请求检查 capability
- [ ] 插件只能订阅其 manifest 中声明的事件命名空间
- [ ] HTTP 请求 URL 经过 Runtime 白名单过滤（如已配置）
- [ ] 未知命名空间的 event:subscribe 返回 INVALID_PARAMS 错误

---

## 9. 依赖关系

### 9.1 前置依赖

| RFC     | 依赖内容                                                     |
| ------- | ------------------------------------------------------------ |
| RFC-001 | postMessage 协议格式、消息类型（request/response/push）、握手流程 |
| RFC-002 | PluginManager 生命周期、PluginInstance 接口、capability 声明机制 |

### 9.2 本 RFC 对其他组件的影响

| 组件             | 影响                                                         |
| ---------------- | ------------------------------------------------------------ |
| PostMessageRouter | 需要注册本 RFC 定义的所有 method handler                    |
| PluginManager    | 插件卸载时需调用 EventBus.unsubscribePlugin()                |
| NuiBridge        | 需要暴露 onGameEvent() 供 PostMessageRouter 注册转发         |
| LayerSystem      | plugin:show / plugin:hide 需联动 LayerSystem 的显示控制      |

### 9.3 实现顺序

```
1. EventBus（无外部依赖，最先实现）
2. Auth Service（依赖 EventBus 用于变更通知）
3. HTTP Client（依赖 Auth Service 获取 Token）
4. WebSocket Manager（独立，可与 HTTP Client 并行实现）
5. PostMessageRouter handler 注册（依赖上述所有服务）
6. Core SDK 模块（依赖 PostMessageRouter 已就绪）
7. 集成测试（依赖所有组件）
```

---

## 附录 A：PostMessageRouter 注册的 method 清单

| method                | 对应 Runtime 服务       | capability 要求      |
| --------------------- | ----------------------- | -------------------- |
| `event:subscribe`     | EventBus / NuiBridge / WS | `events` 白名单   |
| `event:unsubscribe`   | EventBus / NuiBridge / WS | 无（仅取消自身订阅）|
| `event:emit`          | EventBus                | `events` 白名单      |
| `http:request`        | HttpClient              | `http` capability    |
| `ws:send`             | WebSocketManager        | `websocket` capability |
| `ws:state`            | WebSocketManager        | `websocket` capability |
| `auth:getUser`        | AuthService             | 无（基础查询）       |
| `auth:hasPermission`  | AuthService             | 无（基础查询）       |
| `auth:checkPermissions` | AuthService           | 无（基础查询）       |
| `auth:getRoles`       | AuthService             | 无（基础查询）       |
| `nui:send`            | NuiBridge               | `nui` capability     |
| `plugin:getConfig`    | PluginManager           | 无（查询自身）       |
| `plugin:show`         | PluginManager           | 无（控制自身）       |
| `plugin:hide`         | PluginManager           | 无（控制自身）       |
| `plugin:saveState`    | PluginManager           | 无（保存自身状态）   |
| `plugin:restoreState` | PluginManager           | 无（恢复自身状态）   |

## 附录 B：事件命名空间速查表

| SDK API 调用                          | 实际 event:subscribe 的 event 值 | Runtime 路由目标     |
| ------------------------------------- | -------------------------------- | -------------------- |
| `event.on('player:died', ...)`        | `event:player:died`              | EventBus             |
| `nui.onGameEvent('inventory:open', ...)` | `nui:inventory:open`          | NuiBridge            |
| `ws.subscribe('chat:msg', ...)`       | `ws:chat:msg`                    | WebSocketManager     |
| `auth.onUserChange(...)`              | `auth:userChanged`               | SystemEventRegistry  |
| `plugin.onVisibilityChange(...)`      | `plugin:visibilityChanged`       | SystemEventRegistry  |
