# 通讯协议设计文档

## 1. 概述

本文档定义 Runtime 与子页面（iframe）之间通过 `window.postMessage` 进行通讯的完整协议规范。

## 2. 消息格式

所有消息必须遵循以下基础结构：

```typescript
interface BaseMessage {
  /** 协议标识，固定前缀用于过滤非 ReUI 消息 */
  type: `reui:${string}`;
  /** 协议版本（当前为 1，未来可升级） */
  version: number;
}
```

## 3. 消息类型总览

| type | 方向 | 用途 |
|------|------|------|
| `reui:handshake` | iframe → Runtime | 子页面发起握手 |
| `reui:handshake-ack` | Runtime → iframe | 握手确认 |
| `reui:handshake-reject` | Runtime → iframe | 握手拒绝 |
| `reui:request` | iframe → Runtime | 请求调用服务 |
| `reui:response` | Runtime → iframe | 请求响应 |
| `reui:push` | Runtime → iframe | 事件推送 |
| `reui:notify` | iframe → Runtime | 无需响应的通知 |
| `reui:ping` | Runtime → iframe | 心跳探测 |
| `reui:pong` | iframe → Runtime | 心跳响应 |

## 4. 握手协议

### 4.1 握手请求 (iframe → Runtime)

```typescript
interface HandshakeMessage extends BaseMessage {
  type: 'reui:handshake';
  version: 1;
  payload: {
    pluginId: string;       // 插件声明的 ID（自动从 URL ?__reui_id= 获取）
    sdkVersion: string;     // @reui/core 版本号
    capabilities?: string[]; // 插件声明需要的能力
  };
}
```

### 4.2 握手确认 (Runtime → iframe)

```typescript
interface HandshakeAckMessage extends BaseMessage {
  type: 'reui:handshake-ack';
  version: 1;
  payload: {
    sessionId: string;      // Runtime 分配的会话ID
    pluginId: string;       // 确认的插件ID
    runtimeOrigin: string;  // Runtime 的 origin，SDK 后续消息发往此 origin
    permissions: string[];  // 该插件被授予的权限
    config: {               // Runtime 下发的配置
      layer: string;
      allowedEvents: string[];
    };
  };
}
```

### 4.3 握手拒绝 (Runtime → iframe)

```typescript
interface HandshakeRejectMessage extends BaseMessage {
  type: 'reui:handshake-reject';
  version: 1;
  payload: {
    reason: string;         // 拒绝原因
    code: 'UNKNOWN_PLUGIN' | 'VERSION_MISMATCH' | 'PERMISSION_DENIED';
  };
}
```

### 4.4 握手时序图

```
iframe(@reui/core)                    Runtime
  │                                      │
  │  [从 URL ?__reui_id= 读取 pluginId]  │
  │                                      │
  │  ─── reui:handshake ──────────────→  │
  │      {pluginId, sdkVersion}          │
  │                                      │
  │                                      │  ┌─ 验证 pluginId
  │                                      │  │  检查配置中是否注册
  │                                      │  │  验证 SDK 版本兼容性
  │                                      │  └─ 分配 sessionId
  │                                      │
  │  ←── reui:handshake-ack ───────────  │
  │      {sessionId, permissions,        │
  │       runtimeOrigin}                 │
  │                                      │
  │  [记录 runtimeOrigin]                │
  │  [SDK 标记为 ready]                  │
  │  [后续消息 targetOrigin =            │
  │   runtimeOrigin]                     │
```

### 4.5 握手超时

- 子页面发送握手后等待 **5秒**
- 超时后重试 3 次（间隔 1s, 2s, 4s 指数退避）
- 3 次均失败则抛出 `HandshakeTimeoutError`

## 5. 请求/响应协议

### 5.1 请求消息 (iframe → Runtime)

```typescript
interface RequestMessage extends BaseMessage {
  type: 'reui:request';
  version: 1;
  id: string;              // 唯一请求 ID（格式: `{pluginId}:{sequence}`）
  method: string;          // 调用的方法名
  params?: unknown;        // 方法参数
}
```

### 5.2 成功响应 (Runtime → iframe)

```typescript
interface ResponseMessage extends BaseMessage {
  type: 'reui:response';
  version: 1;
  id: string;              // 对应请求的 ID
  success: true;
  result: unknown;         // 返回值
}
```

### 5.3 错误响应 (Runtime → iframe)

```typescript
interface ErrorResponseMessage extends BaseMessage {
  type: 'reui:response';
  version: 1;
  id: string;
  success: false;
  error: {
    code: string;          // 错误码
    message: string;       // 人类可读的错误描述
    details?: unknown;     // 额外错误信息
  };
}
```

### 5.4 请求/响应时序

```
iframe(@reui/core)                 Runtime
  │                                   │
  │  ─── reui:request ─────────────→  │
  │  {id:"inv:1", method:"http:request", │
  │   params:{method:"GET",url:"/api"}}  │
  │                                   │
  │                                   │  ┌─ 解析 method
  │                                   │  │  capability 检查
  │                                   │  │  调用 HttpClient
  │                                   │  └─ 获取结果
  │                                   │
  │  ←── reui:response ──────────────│
  │  {id:"inv:1", success:true,       │
  │   result:{data:[...]}}            │
```

## 6. 推送协议

### 6.1 推送消息 (Runtime → iframe)

```typescript
interface PushMessage extends BaseMessage {
  type: 'reui:push';
  version: 1;
  event: string;           // 事件名（带命名空间前缀）
  payload: unknown;        // 事件数据
}
```

### 6.2 事件命名空间

Push 消息的 `event` 字段使用命名空间前缀区分事件来源：

| 前缀 | 来源 | 示例 |
|------|------|------|
| `event:` | EventBus 业务事件（插件间通讯、自定义事件） | `event:inventory:item-used` |
| `nui:` | 游戏端 NUI 事件 | `nui:player:health-changed` |
| `ws:` | WebSocket 频道消息 | `ws:chat:message` |
| `auth:` | 认证/权限状态变更 | `auth:userChanged` |
| `plugin:` | 插件生命周期事件 | `plugin:visibilityChanged` |

SDK 各模块在 API 层对开发者隐藏前缀细节：
- `event.on('inventory:item-used', ...)` → 内部订阅 `event:inventory:item-used`
- `nui.onGameEvent('player:health-changed', ...)` → 内部订阅 `nui:player:health-changed`
- `ws.subscribe('chat:message', ...)` → 内部订阅 `ws:chat:message`

### 6.3 事件订阅管理

子页面通过 Request 方式管理订阅：

```typescript
// 订阅（event 字段包含命名空间前缀）
{ method: 'event:subscribe', params: { event: 'event:player:health-changed' } }
{ method: 'event:subscribe', params: { event: 'nui:inventory:open' } }
{ method: 'event:subscribe', params: { event: 'ws:chat:message' } }

// 取消订阅（当最后一个 handler 被移除时 SDK 自动发送）
{ method: 'event:unsubscribe', params: { event: 'event:player:health-changed' } }
```

> **统一机制：** 所有类型的事件订阅（EventBus、NUI、WebSocket）都通过 `event:subscribe` / `event:unsubscribe` 方法管理。Runtime 根据事件名的命名空间前缀分流到对应的内部服务。

Runtime 收到订阅请求后，后续该事件触发时会向该 iframe 推送。收到取消订阅请求后停止推送，释放 Runtime 侧的资源。

### 6.4 推送示例

```
Runtime                              iframe
  │                                    │
  │  [游戏发送 player:health-changed]   │
  │                                    │
  │  ─── reui:push ─────────────────→  │
  │  {event:"nui:player:health-changed",│
  │   payload:{health:75, maxHealth:100}}│
```

## 7. 通知协议（Fire-and-Forget）

### 7.1 通知消息 (iframe → Runtime)

```typescript
interface NotifyMessage extends BaseMessage {
  type: 'reui:notify';
  version: 1;
  method: string;
  params?: unknown;
}
```

不需要响应，用于：
- 日志上报
- Telemetry
- 非关键状态同步

## 8. 心跳协议（Ping/Pong）

### 8.1 Ping 消息 (Runtime → iframe)

```typescript
interface PingMessage extends BaseMessage {
  type: 'reui:ping';
  version: 1;
  timestamp: number;       // Runtime 发送时的时间戳
}
```

### 8.2 Pong 消息 (iframe → Runtime)

```typescript
interface PongMessage extends BaseMessage {
  type: 'reui:pong';
  version: 1;
  pluginId: string;        // 响应的插件 ID
  timestamp: number;       // 原始 ping 的时间戳（用于计算 RTT）
}
```

### 8.3 心跳参数

| 参数 | 值 | 说明 |
|------|---|------|
| `PING_INTERVAL` | 10s | 每 10 秒发送一次 ping |
| `PONG_TIMEOUT` | 5s | 每次 ping 后等待 pong 的超时时间 |
| `MAX_MISSED` | 3 | 连续 3 次未响应视为崩溃 |

### 8.4 心跳行为

- Runtime 在插件握手成功后开始心跳监控
- SDK 自动响应 ping（无需开发者编写代码）
- 连续 `MAX_MISSED` 次未响应 → 插件标记为 `error` 状态
- 崩溃的插件不影响其他插件（每个 iframe 独立监控）
- 开发模式下心跳超时阈值可适当放宽

### 8.5 心跳时序

```
Runtime                              iframe
  │                                    │
  │  ─── reui:ping ─────────────────→  │
  │  {timestamp: 1716700000000}        │
  │                                    │
  │  ←── reui:pong ─────────────────   │
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

## 9. 方法注册表

### 9.1 事件相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `event:subscribe` | `{event: string}` | `void` | 订阅事件（event 含命名空间前缀） |
| `event:unsubscribe` | `{event: string}` | `void` | 取消订阅 |
| `event:emit` | `{event: string, payload?: any}` | `void` | 发布事件（广播给其他插件） |

> **注意：** `event:subscribe` 是统一的订阅机制，支持所有命名空间（`event:`、`nui:`、`ws:`）。无需单独的 `ws:subscribe` 或 `nui:subscribe` 方法。

### 9.2 HTTP 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `http:request` | `{method, url, data?, headers?, params?}` | `{status, data, headers}` | 发送 HTTP 请求 |

### 9.3 WebSocket 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `ws:send` | `{channel: string, data: any}` | `void` | 发送 WS 消息 |
| `ws:state` | - | `{state: string}` | 查询连接状态 |

> **订阅说明：** WebSocket 频道订阅通过 `event:subscribe` 统一处理（event 名为 `ws:<channel>`）。Runtime 内部根据 `ws:` 前缀将订阅转发给 WebSocket Manager。

### 9.4 Auth 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `auth:getUser` | - | `UserInfo \| null` | 获取当前用户 |
| `auth:hasPermission` | `{permission: string}` | `boolean` | 检查单个权限 |
| `auth:checkPermissions` | `{permissions: string[]}` | `Record<string,boolean>` | 批量检查权限 |

### 9.5 NUI 相关

| method | params | response | 说明 |
|--------|--------|----------|------|
| `nui:send` | `{event: string, data?: any}` | `any` | 发送 NUI Callback 到游戏 |

### 9.6 Plugin 自身

| method | params | response | 说明 |
|--------|--------|----------|------|
| `plugin:getConfig` | - | `PluginManifest` | 获取插件配置 |
| `plugin:show` | - | `void` | 请求显示自己 |
| `plugin:hide` | - | `void` | 请求隐藏自己 |
| `plugin:ready` | - | `void` | 通知 Runtime 插件渲染完成 |
| `plugin:saveState` | `{state: any}` | `void` | 保存插件状态到 Runtime 临时存储 |
| `plugin:restoreState` | - | `any \| null` | 恢复上次保存的状态 |

**状态存储说明：**
- `plugin:saveState` 将任意 JSON 数据保存在 Runtime 内存中，以 pluginId 为 key
- `plugin:restoreState` 返回该插件上次保存的状态，若无则返回 `null`
- 数据生命周期：Runtime 重启后丢失（仅用于热重载场景的跨 iframe 生命周期状态保持）
- 每个插件仅维护一份状态快照（后存覆盖先存）

## 10. 安全机制

### 10.1 来源验证

消息来源验证通过统一的 MessageDispatcher 完成（见 `02-runtime-design.md` §4）：

```typescript
// Runtime 侧 — MessageDispatcher 统一入口
dispatch(event: MessageEvent): void {
  // 1. 游戏端消息：source === null 或 window
  if (event.source === null || event.source === window) {
    this.nuiBridge.handleGameMessage(event.data);
    return;
  }

  // 2. 已注册 iframe：通过 event.source 匹配
  const plugin = this.pluginManager.findBySource(event.source);
  if (!plugin) return; // 未知来源，忽略

  // 3. 协议前缀快速过滤（非 reui: 消息直接丢弃）
  if (!event.data?.type?.startsWith('reui:')) return;

  // 4. 转交 PostMessageRouter（负责 version/capability 检查）
  this.router.handlePluginMessage(plugin, event.data);
}

// Runtime 侧 — PostMessageRouter 详细验证
handlePluginMessage(plugin: PluginInstance, data: CoreMessage): void {
  // 1. 验证协议版本
  if (data.version !== PROTOCOL_VERSION) {
    this.sendError(plugin, data.id, 'VERSION_MISMATCH');
    return;
  }

  // 2. Capability 检查 + 方法路由
  // ...
}
```

**职责分层：**
| 层级 | 组件 | 职责 |
|------|------|------|
| L1 | MessageDispatcher | 来源鉴别 + `reui:` 前缀快速过滤 |
| L2 | PostMessageRouter | 版本检查 + capability 权限 + 方法路由 |

**关键设计决策：**
- 使用 `event.source`（而非 `event.origin`）鉴别消息来源
- 因 iframe 使用 `sandbox="allow-scripts"`（无 `allow-same-origin`），其 origin 始终为 `null`
- `event.source` 是对 iframe contentWindow 的引用，无法伪造

### 10.2 Capability 访问控制

- 每次 request 检查插件是否具备调用该 method 所需的 capability
- 事件订阅检查 `events` 白名单
- Capability 未通过时返回 `CAPABILITY_DENIED` 错误
- 详见 `06-plugin-specification.md` §5.4 运行时强制执行

## 11. 错误码定义

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

## 12. 协议版本控制

- 当前协议版本: `1`
- 所有消息携带 `version` 字段（类型为 `number`，便于未来升级）
- Runtime 对 `version` 字段执行**严格相等匹配**（`message.version !== PROTOCOL_VERSION` 则拒绝）
- 不支持向下兼容旧版本协议 — 如需升级协议，所有插件必须同步更新 SDK
- SDK 版本不兼容时握手阶段拒绝并给出升级提示
- 版本升级策略：
  - 新增可选字段：不需要升级 version（向后兼容，旧版 SDK 忽略新字段）
  - 修改现有字段语义：必须升级 version
  - 移除字段：必须升级 version
  - Runtime 收到不匹配版本的消息时，返回 `VERSION_MISMATCH` 错误并附带当前支持的版本号
