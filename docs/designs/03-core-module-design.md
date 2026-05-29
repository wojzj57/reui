# Core Module 设计文档 (@reui/core)

## 1. 概述

`@reui/core` 是子页面（iframe）引入的 SDK 包。它对外暴露开发者友好的 API，内部通过 `postMessage` 协议与 Runtime 通讯，代理调用 Runtime 的单例服务。

**核心设计目标：**
- 子页面开发者无需了解 postMessage 细节
- 类型安全的 API
- 自动连接管理（握手、重连、超时）
- 轻量（< 10KB gzipped）

## 2. 包结构

```
workspace/core/
├── src/
│   ├── index.ts           # 统一导出
│   ├── client.ts          # PostMessage 通讯客户端（核心）
│   ├── event.ts           # EventBus API
│   ├── http.ts            # HTTP 请求代理 API
│   ├── ws.ts              # WebSocket 订阅 API
│   ├── auth.ts            # Auth 查询 API
│   ├── nui.ts             # NUI 事件 API
│   ├── plugin.ts          # 插件自身状态 API
│   └── types.ts           # 类型定义
├── package.json
├── tsconfig.json
└── vite.config.ts         # 打包配置（输出 ESM + CJS + UMD）
```

## 3. Client — 通讯核心

`Client` 是整个 core 库的底层，负责与 Runtime 的 postMessage 通讯。

```typescript
class Client {
  private static instance: Client;
  private requestId: number = 0;
  private pendingRequests: Map<string, PendingRequest>;
  private eventHandlers: Map<string, Set<Handler>>;
  private ready: boolean = false;
  private readyPromise: Promise<void>;
  private pluginId: string;
  private runtimeOrigin: string;   // 从握手中获得的 Runtime origin

  static getInstance(): Client;

  /**
   * 初始化客户端，发起握手
   * pluginId 自动从 iframe URL 的 __reui_id 查询参数获取
   */
  async init(options?: InitOptions): Promise<void> {
    // 1. 自动获取 pluginId
    this.pluginId = this.resolvePluginId(options);

    // 2. 发送握手消息到 parent（首次使用 '*'，后续用 runtimeOrigin）
    window.parent.postMessage({
      type: 'reui:handshake',
      version: 1,
      payload: {
        pluginId: this.pluginId,
        sdkVersion: SDK_VERSION,
      },
    }, '*');  // 握手阶段尚未获知 Runtime origin，使用 '*'

    // 3. 等待 Runtime 确认
    await this.readyPromise;
  }

  /**
   * 自动解析 pluginId
   * 从 iframe URL 的查询参数 `__reui_id` 获取（由 Runtime 创建 iframe 时追加）
   *
   * 注意：iframe 使用 sandbox="allow-scripts"（不含 allow-same-origin），
   * 因此 window.frameElement 不可用（跨域返回 null）。
   * 改用 URL 查询参数作为 pluginId 传递机制。
   */
  private resolvePluginId(options?: InitOptions): string {
    // 优先使用 options 中显式指定的（向后兼容、测试场景）
    if (options?.pluginId) return options.pluginId;

    // 从 URL 查询参数获取（Runtime 创建 iframe 时追加 ?__reui_id=xxx）
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
      }, this.runtimeOrigin);  // 使用已确认的 Runtime origin
    });
  }

  /**
   * 订阅 Runtime 下发的事件/推送
   *
   * **init 之前调用的行为：**
   * - 本地 handler 会立即注册（存入 eventHandlers Map）
   * - 向 Runtime 发送的 event:subscribe 请求会等待 init 完成后再发出
   * - 如果 init 最终失败（握手超时），订阅请求不会发出，
   *   本地 handler 保留但永远不会被触发（因为 Runtime 不知道该订阅）
   * - 建议：始终在 init() 成功后再调用 onPush / 各模块 API
   */
  onPush(event: string, handler: Handler): Unsubscribe {
    const isNew = !this.eventHandlers.has(event);

    if (isNew) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // 首次订阅时通知 Runtime（等待 ready 后发出）
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
   * 当某事件的最后一个 handler 被移除时，通知 Runtime 取消订阅
   */
  private offPush(event: string, handler: Handler): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;

    handlers.delete(handler);

    // 最后一个 handler 移除后，通知 Runtime 取消订阅
    if (handlers.size === 0) {
      this.eventHandlers.delete(event);
      this.request('event:unsubscribe', { event }).catch((err) => {
        console.warn(`[ReUI] Failed to unsubscribe from "${event}":`, err);
      });
    }
  }

  /**
   * 处理来自 Runtime 的消息
   */
  private handleMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    const msg = event.data;

    // 验证协议前缀
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
   * 处理握手确认：记录 Runtime origin 用于后续通讯
   */
  private handleHandshakeAck(msg: HandshakeAckMessage): void {
    this.runtimeOrigin = msg.payload.runtimeOrigin ?? '*';
    this.ready = true;
    // resolve readyPromise...
  }

  /**
   * 处理握手拒绝：立即 reject readyPromise 并携带拒绝原因
   */
  private handleHandshakeReject(msg: HandshakeRejectMessage): void {
    const { reason, code } = msg.payload;
    this.ready = false;
    // reject readyPromise with structured error
    // rejectReadyPromise(new ReUIError(code, 'handshake', reason));
  }

  /**
   * 响应 Runtime 的心跳 ping
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

### 3.1 通讯模式

| 模式 | 方向 | 场景 |
|------|------|------|
| Request/Response | iframe → Runtime → iframe | 子页面调用服务（如HTTP请求、查询权限） |
| Push | Runtime → iframe | 事件推送（如游戏事件、WS消息） |
| Fire-and-forget | iframe → Runtime | 无需响应的通知（如日志、telemetry） |
| Ping/Pong | Runtime ↔ iframe | 心跳保活，Runtime 定期 ping，iframe 自动 pong |

### 3.1.1 Push 事件命名规则

Runtime 向 iframe 推送事件时，`event` 字段使用**带命名空间前缀**的格式：

| 前缀 | 来源 | 示例 |
|------|------|------|
| `event:` | EventBus 业务事件（插件间通讯） | `event:inventory:item-used` |
| `nui:` | 游戏端 NUI 事件 | `nui:player:health-changed` |
| `ws:` | WebSocket 频道消息 | `ws:chat:message` |
| `auth:` | 认证状态变更 | `auth:userChanged` |
| `plugin:` | 插件自身生命周期 | `plugin:visibilityChanged` |

SDK 各模块在调用 `client.onPush(event, handler)` 时自动添加对应前缀，开发者 API 层不暴露前缀细节。

### 3.2 握手流程

```
iframe(@reui/core)                    Runtime
      │                                   │
      │  [从 URL ?__reui_id= 读取 pluginId]│
      │                                   │
      │── reui:handshake ────────────────→│
      │   {pluginId, sdkVersion}          │
      │                                   │  验证 pluginId
      │                                   │  分配 session
      │←─── reui:handshake-ack ──────────│
      │   {sessionId, config,             │
      │    runtimeOrigin}                 │
      │                                   │
      │   [记录 runtimeOrigin]            │
      │   [SDK 标记为 ready]              │
      │   [后续消息使用 runtimeOrigin]     │
```

### 3.3 pluginId 自动解析

Runtime 创建 iframe 时将 pluginId 追加到 URL 查询参数：

```typescript
// Runtime 侧（Plugin Manager 创建 iframe 时）
// 追加 ?__reui_id=<pluginId> 到 iframe src
const url = new URL(entryUrl, location.href);
url.searchParams.set('__reui_id', manifest.id);
iframe.src = url.toString();
```

> **为什么不用 `data-plugin-id` 属性？**
>
> iframe 使用 `sandbox="allow-scripts"`（不含 `allow-same-origin`），此时 `window.frameElement` 始终返回 `null`（浏览器安全策略禁止跨域 iframe 访问父页面 DOM 元素引用）。因此改用 URL 查询参数传递 pluginId，这在任何 sandbox 配置下都可靠。

SDK 初始化时自动读取：

```typescript
// 子页面侧（自动获取，无需开发者手动指定）
await init();  // pluginId 自动从 URL ?__reui_id= 获取

// 仍支持手动指定（测试、非标准环境等场景）
await init({ pluginId: 'my-plugin' });
```

## 4. 公开 API

### 4.1 事件系统 (event.ts)

```typescript
import { Client } from './client';

export class ReUIEvent {
  private client: Client;

  /**
   * 订阅事件（可以是业务事件或 NUI 事件）
   */
  on(eventName: string, handler: EventHandler): Unsubscribe {
    return this.client.onPush(`event:${eventName}`, handler);
  }

  /**
   * 发布事件（广播到 Runtime，其他插件可收到）
   */
  async emit(eventName: string, payload?: unknown): Promise<void> {
    await this.client.request('event:emit', { event: eventName, payload });
  }

  /**
   * 单次订阅
   */
  once(eventName: string, handler: EventHandler): Unsubscribe;
}
```

**使用示例：**
```typescript
import { event } from '@reui/core';

// 订阅游戏事件
event.on('player:health-changed', (data) => {
  console.log('Health:', data.health);
});

// 发布事件给其他插件
event.emit('inventory:item-used', { itemId: 'medkit' });
```

### 4.2 HTTP 请求 (http.ts)

```typescript
export class ReUIHttp {
  private client: Client;

  async get<T>(url: string, config?: RequestConfig): Promise<T> {
    return this.client.request('http:request', {
      method: 'GET', url, ...config,
    });
  }

  async post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.client.request('http:request', {
      method: 'POST', url, data, ...config,
    });
  }

  async put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;
  async delete<T>(url: string, config?: RequestConfig): Promise<T>;
}
```

**使用示例：**
```typescript
import { http } from '@reui/core';

const players = await http.get<Player[]>('/api/players');
await http.post('/api/inventory/use', { itemId: 'medkit' });
```

### 4.3 WebSocket (ws.ts)

```typescript
export class ReUIWebSocket {
  private client: Client;

  /**
   * 订阅 WS 频道消息
   * 实际连接由 Runtime 维护，这里只是订阅消息转发
   * 内部通过 client.onPush 注册，首次订阅某频道时自动向 Runtime 发送
   * event:subscribe 请求（event 名为 "ws:<channel>"）
   */
  subscribe(channel: string, handler: MessageHandler): Unsubscribe {
    return this.client.onPush(`ws:${channel}`, handler);
  }

  /**
   * 通过 Runtime 的 WS 连接发送消息
   */
  async send(channel: string, data: unknown): Promise<void> {
    await this.client.request('ws:send', { channel, data });
  }

  /**
   * 查询 WS 连接状态
   */
  async getState(): Promise<WSState> {
    return this.client.request('ws:state');
  }
}
```

**使用示例：**
```typescript
import { ws } from '@reui/core';

ws.subscribe('chat:message', (msg) => {
  appendMessage(msg.sender, msg.text);
});

ws.send('chat:message', { text: 'Hello world' });
```

### 4.4 权限认证 (auth.ts)

```typescript
export class ReUIAuth {
  private client: Client;

  /**
   * 获取当前用户信息
   */
  async getUser(): Promise<UserInfo | null> {
    return this.client.request('auth:getUser');
  }

  /**
   * 检查权限
   */
  async hasPermission(permission: string): Promise<boolean> {
    return this.client.request('auth:hasPermission', { permission });
  }

  /**
   * 批量检查权限
   */
  async checkPermissions(permissions: string[]): Promise<Record<string, boolean>> {
    return this.client.request('auth:checkPermissions', { permissions });
  }

  /**
   * 监听用户状态变化
   */
  onUserChange(handler: (user: UserInfo | null) => void): Unsubscribe {
    return this.client.onPush('auth:userChanged', handler);
  }

  /**
   * 监听权限变化
   */
  onPermissionChange(handler: (permissions: string[]) => void): Unsubscribe {
    return this.client.onPush('auth:permissionsChanged', handler);
  }
}
```

### 4.5 NUI 事件 (nui.ts)

```typescript
export class ReUINui {
  private client: Client;

  /**
   * 监听来自游戏的 NUI 事件
   */
  onGameEvent(eventName: string, handler: (data: unknown) => void): Unsubscribe {
    return this.client.onPush(`nui:${eventName}`, handler);
  }

  /**
   * 向游戏端发送 NUI Callback
   */
  async sendToGame(eventName: string, data?: unknown): Promise<unknown> {
    return this.client.request('nui:send', { event: eventName, data });
  }
}
```

### 4.6 插件自身 API (plugin.ts)

```typescript
export class ReUIPlugin {
  private client: Client;

  /**
   * 获取插件自身配置
   */
  async getConfig(): Promise<PluginConfig> {
    return this.client.request('plugin:getConfig');
  }

  /**
   * 请求显示自己
   */
  async requestShow(): Promise<void> {
    await this.client.request('plugin:show');
  }

  /**
   * 请求隐藏自己
   */
  async requestHide(): Promise<void> {
    await this.client.request('plugin:hide');
  }

  /**
   * 监听自身可见性变化
   */
  onVisibilityChange(handler: (visible: boolean) => void): Unsubscribe {
    return this.client.onPush('plugin:visibilityChanged', handler);
  }

  /**
   * 监听插件即将卸载（热重载前触发）
   * 可在此回调中保存状态。Runtime 会等待最多 5 秒后强制卸载。
   */
  onBeforeUnload(handler: (reason: string) => void | Promise<void>): Unsubscribe {
    return this.client.onPush('plugin:beforeUnload', (data: { reason: string }) => {
      handler(data.reason);
    });
  }

  /**
   * 保存插件状态到 Runtime 临时存储
   * 用于热重载时保持状态。数据会在插件下次加载时可用。
   */
  async saveState<T = unknown>(state: T): Promise<void> {
    await this.client.request('plugin:saveState', { state });
  }

  /**
   * 恢复上次保存的插件状态
   * 如果没有已保存的状态，返回 null
   */
  async restoreState<T = unknown>(): Promise<T | null> {
    return this.client.request('plugin:restoreState');
  }
}
```

## 5. 统一导出 (index.ts)

```typescript
import { Client } from './client';
import { ReUIEvent } from './event';
import { ReUIHttp } from './http';
import { ReUIWebSocket } from './ws';
import { ReUIAuth } from './auth';
import { ReUINui } from './nui';
import { ReUIPlugin } from './plugin';

// 单例导出，子页面 import 后直接使用
const client = Client.getInstance();

export const event = new ReUIEvent(client);
export const http = new ReUIHttp(client);
export const ws = new ReUIWebSocket(client);
export const auth = new ReUIAuth(client);
export const nui = new ReUINui(client);
export const plugin = new ReUIPlugin(client);

// 初始化函数（pluginId 自动从 URL ?__reui_id= 查询参数获取）
export async function init(options?: InitOptions): Promise<void> {
  await client.init(options);
}

// 也导出类，供高级用户自定义
export { Client, ReUIEvent, ReUIHttp, ReUIWebSocket, ReUIAuth, ReUINui, ReUIPlugin };
export * from './types';
```

## 6. 子页面使用示例

```typescript
import { init, event, http, nui, auth, plugin } from '@reui/core';

// 初始化 SDK（pluginId 自动从 URL ?__reui_id= 获取）
await init();

// 检查权限
const canUseItem = await auth.hasPermission('inventory.use');

// 监听游戏事件
nui.onGameEvent('inventory:open', () => {
  showInventoryUI();
});

// 发送 HTTP 请求（通过 Runtime 代理）
const items = await http.get('/api/inventory/items');

// 监听其他插件的事件
event.on('shop:item-purchased', (data) => {
  refreshInventory();
});

// 热重载状态恢复
const savedState = await plugin.restoreState<{ scrollPos: number }>();
if (savedState) {
  window.scrollTo(0, savedState.scrollPos);
}

// 监听卸载事件，保存状态（用于热重载）
plugin.onBeforeUnload(async (reason) => {
  if (reason === 'reload') {
    await plugin.saveState({ scrollPos: window.scrollY });
  }
});
```

## 7. 打包输出

```javascript
// vite.config.ts
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ReUICore',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) => `reui-core.${format}.js`,
    },
  },
});
```

输出格式：
- **ESM** — `import { event } from '@reui/core'`（推荐，支持 tree-shaking）
- **CJS** — `const { event } = require('@reui/core')`
- **UMD** — `<script src="reui-core.umd.js">` → `window.ReUICore`（无构建工具场景）

## 8. 错误处理

```typescript
// 所有 request 调用可能抛出的错误
export class ReUIError extends Error {
  code: string;           // 错误码
  method: string;         // 调用的方法
  details?: unknown;      // 额外信息
}

// 错误码
export enum ErrorCode {
  TIMEOUT = 'TIMEOUT',                     // 请求超时
  NOT_READY = 'NOT_READY',                 // SDK 未初始化
  PERMISSION_DENIED = 'PERMISSION_DENIED', // 无权限
  CAPABILITY_DENIED = 'CAPABILITY_DENIED', // 能力未授予
  METHOD_NOT_FOUND = 'METHOD_NOT_FOUND',   // 方法不存在
  RUNTIME_ERROR = 'RUNTIME_ERROR',         // Runtime 内部错误
  NETWORK_ERROR = 'NETWORK_ERROR',         // HTTP/WS 网络错误
}
```

## 9. 单例保证

`@reui/core` 在子页面中是 **模块级单例**：

- ES Module 天然保证同一模块只会执行一次
- `Client.getInstance()` 使用经典单例模式作为额外保障
- 即使被多个组件 import，共享同一个 Client 实例和 postMessage 连接

```typescript
// 无论多少组件 import，都是同一个实例
// ComponentA.tsx
import { event } from '@reui/core'; // → 单例A

// ComponentB.tsx
import { event } from '@reui/core'; // → 同一个单例A
```
