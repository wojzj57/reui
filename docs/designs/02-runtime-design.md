# Runtime 设计文档

## 1. 概述

Runtime 是 ReUI 框架的宿主页面，作为 FiveM NUI 加载的唯一 HTML 入口。它承担：

- FiveM NUI 通讯桥接
- 核心服务单例管理
- 子页面(iframe)生命周期管理
- 层级显示系统
- 安全与权限管控

## 2. 启动流程

```
FiveM 加载 runtime/index.html
        │
        ▼
┌─────────────────────┐
│   初始化核心服务     │
│   (单例创建)        │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Message Dispatcher  │
│  统一消息入口        │
│  监听所有 postMessage│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   NUI Bridge 就绪   │
│   (通过 Dispatcher  │
│    接收 Game 消息)   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  PostMessage Router  │
│  (通过 Dispatcher   │
│   接收 iframe 消息)  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  等待游戏端 reui:init│
│  消息获取           │
│  resourceName       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  等待游戏端通过 NUI  │
│  下发插件列表后加载  │
└─────────────────────┘
```

## 3. 核心服务（单例）

### 3.1 EventBus

全局事件总线，负责 Runtime 内部和子页面之间的事件调度。

```typescript
type Unsubscribe = () => void;
type EventHandler = (payload: unknown) => void;

class EventBus {
  private static instance: EventBus;
  private listeners: Map<string, Set<EventHandler>>;
  private pluginSubscriptions: Map<string, Set<string>>; // pluginId → eventNames

  static getInstance(): EventBus;

  // 订阅事件，返回取消订阅函数
  on(event: string, handler: EventHandler): Unsubscribe;

  // 取消订阅
  off(event: string, handler: EventHandler): void;

  // 单次订阅，触发后自动取消
  once(event: string, handler: EventHandler): Unsubscribe;

  // 发布事件
  emit(event: string, payload: unknown): void;

  // 为特定插件订阅（便于清理）
  subscribeForPlugin(pluginId: string, event: string, handler: EventHandler): Unsubscribe;

  // 清理插件的所有订阅
  unsubscribePlugin(pluginId: string): void;
}
```

**设计决策：**
- 使用 Map + Set 存储，O(1) 查找
- 跟踪插件订阅关系，iframe 卸载时自动清理
- 支持通配符事件匹配（如 `player:*` 匹配 `player:health-changed`、`player:died` 等）
- `on` / `once` 均返回 `Unsubscribe` 函数，保持 API 一致性

**通配符匹配规则：**
- `prefix:*` — 匹配所有以 `prefix:` 开头的事件
- `*` — 匹配所有事件（仅限管理插件使用）
- 精确匹配优先于通配符匹配
- `emit` 时遍历已注册的通配符 pattern 进行匹配（通配符订阅数量有限，不影响性能）

```typescript
  emit(event: string, payload: unknown): void {
    // 1. 精确匹配
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(h => h(payload));
    }

    // 2. 通配符匹配
    for (const [pattern, patternHandlers] of this.wildcardListeners) {
      if (this.matchPattern(pattern, event)) {
        patternHandlers.forEach(h => h(payload));
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

### 3.2 WebSocket Manager

管理与后端服务器的 WebSocket 连接。

```typescript
class WebSocketManager {
  private static instance: WebSocketManager;
  private ws: WebSocket | null;
  private reconnectTimer: number;
  private messageHandlers: Map<string, Set<MessageHandler>>;
  private pendingMessages: Array<QueuedMessage>; // 离线消息队列

  static getInstance(): WebSocketManager;

  // 建立连接
  connect(url: string, options?: WSOptions): void;

  // 发送消息（自动排队如果未连接）
  send(channel: string, data: unknown): void;

  // 订阅频道消息
  subscribe(channel: string, handler: MessageHandler): Unsubscribe;

  // 连接状态
  get state(): 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
}
```

**设计决策：**
- 单一 WebSocket 连接，所有插件复用
- 内置自动重连（指数退避）
- 离线消息队列，重连后自动发送
- 基于 channel 的消息分发

### 3.3 HTTP Client

基于 Axios 的 HTTP 客户端单例。

```typescript
class HttpClient {
  private static instance: HttpClient;
  private axiosInstance: AxiosInstance;

  static getInstance(): HttpClient;

  // 配置默认 baseURL、headers、interceptors
  configure(config: HttpClientConfig): void;

  // 标准 HTTP 方法
  get<T>(url: string, config?: RequestConfig): Promise<T>;
  post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;
  put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;
  delete<T>(url: string, config?: RequestConfig): Promise<T>;
}
```

**设计决策：**
- 自动附加 Auth token（通过 interceptor）
- 统一错误处理和重试策略
- 请求/响应日志（开发模式）

### 3.4 Auth Service

认证和权限管理。FiveM 场景中，玩家认证由游戏服务器在连接时处理（Steam/Discord/License），Runtime 的 AuthService 是**被动接收**认证状态，不主动发起登录流程。

```typescript
class AuthService {
  private static instance: AuthService;
  private currentUser: UserInfo | null;
  private permissions: Set<string>;
  private token: string | null;

  static getInstance(): AuthService;

  // ── 游戏端推送接口（由 NUI Bridge 调用） ──

  /** 接收游戏端下发的用户信息 */
  updateUser(user: UserInfo | null): void;

  /** 接收游戏端下发的权限列表 */
  updatePermissions(permissions: string[]): void;

  /** 接收游戏端下发的 Token */
  updateToken(token: string | null): void;

  // ── 子页面查询接口 ──

  /** 获取当前用户 */
  getUser(): UserInfo | null;

  /** 权限检查 */
  hasPermission(permission: string): boolean;
  hasAnyPermission(permissions: string[]): boolean;

  /** 获取所有已授予权限（子页面不直接获取完整列表，通过 hasPermission 查询） */
  getPermissions(): Set<string>;

  // ── Token 管理 ──

  /** 获取 Token（仅 Runtime 内部使用，不暴露给子页面） */
  getToken(): string | null;
  onTokenChange(handler: (token: string | null) => void): Unsubscribe;

  // ── 事件通知 ──

  /** 用户/权限变更时通知所有子页面 */
  onUserChange(handler: (user: UserInfo | null) => void): Unsubscribe;
  onPermissionChange(handler: (permissions: string[]) => void): Unsubscribe;
}
```

**设计决策：**
- **被动模式**：AuthService 不提供 login/logout API，认证由游戏服务器驱动，通过 NUI 事件将用户状态推送到 Runtime
- Token 存储在 Runtime 内存中，不暴露给子页面
- 子页面通过 core SDK 查询权限，不直接访问 token
- 支持权限变更通知（如角色切换后通知所有子页面刷新权限依赖的 UI）
- 权限变更时自动触发 Plugin Manager 重新评估插件加载/卸载（见 `06-plugin-specification.md` §6.5）

## 4. Message Dispatcher（统一消息入口）

Runtime 使用**单一** `message` 事件监听器，根据消息来源 (`event.source`) 区分并分流处理。

```typescript
class MessageDispatcher {
  private static instance: MessageDispatcher;
  private nuiBridge: NuiBridge;
  private postMessageRouter: PostMessageRouter;
  private pluginManager: PluginManager;

  static getInstance(): MessageDispatcher;

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
    // 游戏端的 postMessage source 为 null 或 window 自身
    if (event.source === null || event.source === window) {
      this.nuiBridge.handleGameMessage(event.data);
      return;
    }

    // ── 情况2：来自已注册的 iframe ──
    const plugin = this.pluginManager.findBySource(event.source);
    if (plugin) {
      // 协议前缀检查（快速过滤非 ReUI 消息）
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

**设计决策：**
- 单一入口避免多个 listener 之间的竞争和遗漏
- 通过 `event.source` 做来源鉴别，而非 `event.origin`（因 iframe 移除了 `allow-same-origin` 后 origin 为 `null`）
- Dispatcher 仅做来源分流和协议前缀快速过滤
- 详细验证（版本检查、capability）下沉到 PostMessageRouter
- 游戏消息（FiveM SendNUIMessage）的 source 为 `null` 或 `window`，与 iframe 消息天然区分
- 未知来源直接丢弃，不做任何处理

## 5. NUI Bridge

负责 Runtime 与 FiveM 游戏端的通讯。不再自行监听 `message` 事件，改为由 MessageDispatcher 分发。

```typescript
class NuiBridge {
  private static instance: NuiBridge;
  private resourceName: string = '';
  private eventBus: EventBus;

  static getInstance(): NuiBridge;

  /**
   * 初始化：从游戏端初始 NUI 消息获取 resourceName
   * 游戏端 client.lua 启动时发送 reui:init 消息
   */
  init(resourceName: string): void {
    this.resourceName = resourceName;
  }

  /**
   * 处理来自游戏的 NUI 消息（由 MessageDispatcher 调用）
   */
  handleGameMessage(data: unknown): void {
    if (data && typeof data === 'object' && 'type' in data) {
      const msg = data as { type: string; payload?: unknown };

      // 特殊处理：初始化消息（获取 resourceName）
      if (msg.type === 'reui:init' && msg.payload) {
        const { resourceName } = msg.payload as { resourceName: string };
        this.init(resourceName);
        return;
      }

      this.eventBus.emit(`nui:${msg.type}`, msg.payload);
    }
  }

  /**
   * 向游戏端发送 NUI Callback
   * 使用标准 fetch('https://resourceName/eventName') 方式
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

**关键点：**
- NUI Bridge 不再自行 `addEventListener`，由 MessageDispatcher 统一分发
- `resourceName` 通过游戏端 client.lua 启动时发送的 `reui:init` 消息获取
- 所有来自游戏的消息通过 EventBus 分发
- NUI 事件名加 `nui:` 前缀，与普通事件区分
- 子页面不直接与游戏通讯，必须通过 Runtime 中转

## 6. Plugin Manager

管理所有子页面的注册、加载和生命周期。

### 6.1 插件配置

插件配置统一使用 `PluginManifest` 接口（定义在 `@reui/cli` 的 Zod Schema 中），详见 `06-plugin-specification.md`。Runtime 内部引用同一类型。

```typescript
// 从 @reui/cli 引入类型
import type { PluginManifest } from '@reui/cli';
```

配置来源：
- 由游戏端 (Lua) 扫描插件目录后，通过 NUI 消息将插件清单列表传递给 Runtime
- 签名验证在**服务端**完成，Runtime 仅接收已通过验证的插件列表

### 6.2 插件列表接收

Runtime 不具备文件系统访问能力（运行在 CEF 浏览器中），插件发现由游戏端驱动。

#### 消息流架构（Server → Client → CEF）

```
┌─────────────────┐        TriggerClientEvent        ┌────────────────┐
│  Server Script  │ ──────────────────────────────→   │ Client Script  │
│  (server.lua)   │  已验签的插件列表 + mode          │ (client.lua)   │
│                 │                                   │                │
│  • 扫描 plugins/│                                   │  • 接收插件列表│
│  • 读取 json    │                                   │  • SendNUIMessage
│  • 签名验证     │                                   │    到 CEF      │
└─────────────────┘                                   └───────┬────────┘
                                                              │
                                                              │ SendNUIMessage
                                                              ▼
                                                      ┌────────────────┐
                                                      │   Runtime      │
                                                      │   (CEF/NUI)    │
                                                      │                │
                                                      │  • Schema 校验 │
                                                      │  • 权限检查    │
                                                      │  • 加载插件    │
                                                      └────────────────┘
```

**关键安全设计：签名验证在服务端完成。** 签名密钥仅存在于服务端，客户端和 CEF 永远不接触密钥。服务端验签通过后才将插件清单下发，Runtime 信任来自游戏端的已验证数据。

```typescript
// Runtime 启动后等待游戏端下发插件列表
nuiBridge.onGameEvent('reui:plugin-registry', async (data) => {
  const { plugins, mode } = data as {
    plugins: Array<{ manifest: PluginManifest; basePath: string }>;
    mode: 'development' | 'production';
  };

  pluginLoader.init(mode);

  // 按 priority 排序后逐个加载
  const sorted = plugins.sort((a, b) => (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0));
  for (const { manifest, basePath } of sorted) {
    await pluginManager.loadPlugin(manifest, basePath);
  }
});
```

```lua
-- server.lua：扫描插件目录、签名验证、下发给客户端
-- 签名密钥仅存在于服务端，客户端不可访问

local signKey = GetConvar('reui_sign_key', '')  -- 仅服务端可读
local reuiMode = GetConvar('reui_mode', 'production')

RegisterNetEvent('reui:client:requestInit')
AddEventHandler('reui:client:requestInit', function()
  local src = source
  local plugins = {}
  local pluginDirs = scanDirectory('plugins/')

  for _, dir in ipairs(pluginDirs) do
    local manifestPath = dir .. '/plugin.json'
    if fileExists(manifestPath) then
      local raw = readFile(manifestPath)
      local manifest = json.decode(raw)
      if manifest then
        -- 生产模式下在服务端验证签名
        if reuiMode == 'production' then
          if not verifySignature(manifest, signKey) then
            print('[ReUI] REJECTED: ' .. manifest.id .. ' - signature invalid')
            goto continue
          end
        end
        table.insert(plugins, { manifest = manifest, basePath = dir })
      end
    end
    ::continue::
  end

  -- 将已验证的插件列表下发给客户端（不传递 signKey）
  TriggerClientEvent('reui:client:pluginRegistry', src, {
    plugins = plugins,
    mode = reuiMode,
  })
end)
```

```lua
-- client.lua：接收服务端下发的已验证插件列表，转发给 CEF (Runtime)

-- 资源名称，启动时通知 Runtime
local resourceName = GetCurrentResourceName()

-- 玩家加载完毕后请求初始化
AddEventHandler('playerSpawned', function()
  -- 先通知 Runtime 资源名称
  SendNUIMessage({
    type = 'reui:init',
    payload = { resourceName = resourceName }
  })

  -- 向服务端请求插件列表
  TriggerServerEvent('reui:client:requestInit')
end)

-- 接收服务端下发的已验证插件列表
RegisterNetEvent('reui:client:pluginRegistry')
AddEventHandler('reui:client:pluginRegistry', function(data)
  SendNUIMessage({
    type = 'reui:plugin-registry',
    payload = data
  })
end)
```

### 6.3 插件管理 API

```typescript
class PluginManager {
  private plugins: Map<string, PluginInstance>;
  private layerSystem: LayerSystem;

  // 加载插件
  async loadPlugin(manifest: PluginManifest, basePath: string): Promise<void>;

  // 卸载插件
  async unloadPlugin(pluginId: string): Promise<void>;

  // 显示/隐藏插件
  showPlugin(pluginId: string): void;
  hidePlugin(pluginId: string): void;

  // Panel 层专用：激活指定面板（自动关闭同层其他面板）
  activatePanel(pluginId: string): void;

  // 切换面板显示状态
  togglePanel(pluginId: string): void;

  // 获取插件实例
  getPlugin(pluginId: string): PluginInstance | undefined;

  // 获取活跃的插件列表
  getActivePlugins(): PluginInstance[];

  // 根据 message source 查找插件
  findBySource(source: MessageEventSource): PluginInstance | undefined;
}
```

**`activatePanel` 行为：**
- 仅对 `panel` 层插件生效
- 隐藏当前活跃的 Panel 层插件
- 显示目标插件
- 通知 FiveM 输入系统（cursor / focus）
- 如果目标插件已经是活跃的，则隐藏它（toggle 语义）

```typescript
activatePanel(pluginId: string): void {
  const target = this.plugins.get(pluginId);
  if (!target || target.config.layer !== 'panel') return;

  // 找到当前活跃的 panel
  const currentActive = this.getActivePanelPlugin();

  if (currentActive?.id === pluginId) {
    // 再次激活同一个 = toggle 关闭
    this.hidePlugin(pluginId);
    this.layerSystem.releaseFocus();
    return;
  }

  // 关闭当前活跃的 panel
  if (currentActive) {
    this.hidePlugin(currentActive.id);
  }

  // 激活目标 panel
  this.showPlugin(pluginId);
  this.layerSystem.setFocusLayer('panel');
}
```

### 6.4 PluginInstance

```typescript
interface PluginInstance {
  id: string;
  config: PluginManifest;
  iframe: HTMLIFrameElement;
  state: 'loading' | 'ready' | 'active' | 'hidden' | 'error';
  origin: string;

  // 向插件发送消息
  postMessage(message: RuntimeMessage): void;

  // 销毁
  destroy(): void;
}
```

## 7. Layer System（层级系统）

### 7.1 层级定义

| 层级 | z-index 范围 | 行为 | 典型场景 |
|------|-------------|------|----------|
| `hud` | 100-199 | 始终可见，不接收焦点，鼠标穿透 | 小地图、状态栏、通知 |
| `panel` | 200-299 | 按需切换显示，同层互斥（`activatePanel`），接收输入 | 背包、手机、商店 |
| `overlay` | 300-399 | 模态弹出，栈式管理，阻止下层交互 | 对话框、确认框 |

### 7.1.1 Overlay 层栈式管理

Overlay 层支持多实例同时存在，使用栈结构管理：

```typescript
class OverlayStack {
  private stack: PluginInstance[] = [];
  private onStackEmpty: () => void;  // 栈空时回调，通知 LayerSystem 释放焦点

  constructor(onStackEmpty: () => void) {
    this.onStackEmpty = onStackEmpty;
  }

  /** 压入新 Overlay（显示在最顶层） */
  push(plugin: PluginInstance): void {
    // 隐藏当前栈顶（不销毁）
    const current = this.peek();
    if (current) current.iframe.style.visibility = 'hidden';

    this.stack.push(plugin);
    plugin.iframe.style.visibility = 'visible';
  }

  /** 弹出栈顶 Overlay（恢复前一个的可见性） */
  pop(): PluginInstance | undefined {
    const removed = this.stack.pop();
    if (removed) removed.iframe.style.visibility = 'hidden';

    // 恢复新的栈顶
    const current = this.peek();
    if (current) current.iframe.style.visibility = 'visible';

    // 栈空时通过回调通知 LayerSystem 释放焦点
    if (this.stack.length === 0) {
      this.onStackEmpty();
    }

    return removed;
  }

  /** 清空所有 Overlay（ESC 键或游戏事件触发） */
  clear(): void {
    while (this.stack.length > 0) this.pop();
  }

  private peek(): PluginInstance | undefined {
    return this.stack[this.stack.length - 1];
  }
}
```

**初始化示例：**
```typescript
// LayerSystem 创建 OverlayStack 时注入回调
this.overlayStack = new OverlayStack(() => {
  this.releaseFocus();
});
```

### 7.2 LayerSystem API

```typescript
class LayerSystem {
  private layers: Map<LayerType, LayerContainer>;

  // 创建层容器
  private createLayerContainers(): void;

  // 将 iframe 放入指定层
  attachToLayer(iframe: HTMLIFrameElement, layer: LayerType): void;

  // 控制层可见性
  showLayer(layer: LayerType): void;
  hideLayer(layer: LayerType): void;

  // 输入焦点管理
  setFocusLayer(layer: LayerType): void;
  releaseFocus(): void;

  // Cursor 控制（与 FiveM 输入系统联动）
  setCursorVisible(visible: boolean): void;
}
```

### 7.3 输入控制

```
HUD 层: pointer-events: none (鼠标穿透到游戏)
Panel 层打开时: SetNuiFocusInput(true) → 拦截键鼠输入
Overlay 层打开时: 遮罩覆盖 Panel 层
所有层关闭时: SetNuiFocusInput(false) → 输入还给游戏
```

## 8. PostMessage Router

Runtime 侧的消息路由器，处理所有来自子页面的 postMessage。不再自行监听事件，由 MessageDispatcher 分发。

```typescript
class PostMessageRouter {
  private handlers: Map<string, RequestHandler>;
  private pluginManager: PluginManager;

  /**
   * 处理来自插件的消息（由 MessageDispatcher 调用）
   * 消息已通过来源验证和协议前缀过滤
   * 此处负责：版本检查、capability 检查、路由分发
   */
  handlePluginMessage(plugin: PluginInstance, data: unknown): void {
    const message = data as CoreMessage;

    // 1. 验证协议版本
    if (message.version !== PROTOCOL_VERSION) {
      this.sendError(plugin, message.id, 'VERSION_MISMATCH');
      return;
    }

    // 2. 权限检查（capability）
    if (!this.checkCapability(plugin, message)) {
      this.sendError(plugin, message.id, 'CAPABILITY_DENIED');
      return;
    }

    // 3. 路由到对应 handler
    const handler = this.handlers.get(message.method);
    if (handler) {
      handler(plugin, message);
    } else {
      this.sendError(plugin, message.id, 'METHOD_NOT_FOUND');
    }
  }

  // 注册消息处理器
  registerHandler(method: string, handler: RequestHandler): void;

  /**
   * event:subscribe 的分流逻辑
   * 根据事件名的命名空间前缀，将订阅转发到对应的内部服务
   */
  private handleEventSubscribe(plugin: PluginInstance, params: { event: string }): void {
    const { event } = params;
    const colonIdx = event.indexOf(':');
    const namespace = event.slice(0, colonIdx);  // "event" / "nui" / "ws"

    switch (namespace) {
      case 'event':
        // EventBus 业务事件 — 在 EventBus 中注册，触发时推送给该插件
        this.eventBus.subscribeForPlugin(plugin.id, event, (payload) => {
          plugin.postMessage({ type: 'reui:push', version: 1, event, payload });
        });
        break;

      case 'nui':
        // NUI 游戏事件 — 在 NuiBridge 中注册转发
        this.nuiBridge.onGameEvent(event.slice(colonIdx + 1), (payload) => {
          plugin.postMessage({ type: 'reui:push', version: 1, event, payload });
        });
        break;

      case 'ws':
        // WebSocket 频道 — 在 WebSocketManager 中订阅频道消息转发
        this.wsManager.subscribe(event.slice(colonIdx + 1), (payload) => {
          plugin.postMessage({ type: 'reui:push', version: 1, event, payload });
        });
        break;

      case 'auth':
      case 'plugin':
        // 系统事件 — 由对应服务直接管理
        this.systemEventRegistry.register(plugin.id, event);
        break;

      default:
        this.sendError(plugin, null, {
          code: 'INVALID_PARAMS',
          message: `Unknown event namespace: "${namespace}"`,
        });
    }
  }
}
```

**职责边界：**
- MessageDispatcher 负责：来源验证 + `reui:` 前缀快速过滤
- PostMessageRouter 负责：版本兼容检查、capability 权限检查、方法路由

## 9. 心跳机制（Heartbeat）

Runtime 通过 ping/pong 机制监控所有已加载 iframe 的健康状态。

```typescript
class HeartbeatMonitor {
  private static instance: HeartbeatMonitor;
  private intervals: Map<string, number>;  // pluginId → intervalId
  private lastPong: Map<string, number>;   // pluginId → timestamp
  private missedCounts: Map<string, number>; // pluginId → missed count

  private readonly PING_INTERVAL = 10_000;   // 每 10 秒 ping 一次
  private readonly PONG_TIMEOUT = 5_000;     // 5 秒内未收到 pong 视为超时
  private readonly MAX_MISSED = 3;           // 连续 3 次超时视为崩溃

  static getInstance(): HeartbeatMonitor;

  /**
   * 开始监控某个插件
   */
  startMonitoring(plugin: PluginInstance): void {
    // 初始化：将当前时间作为 lastPong 基准，避免首次误判
    this.lastPong.set(plugin.id, Date.now());
    this.missedCounts.set(plugin.id, 0);

    const intervalId = setInterval(() => {
      const pingTime = Date.now();

      // 发送 ping
      plugin.postMessage({ type: 'reui:ping', version: 1, timestamp: pingTime });

      // 在 PONG_TIMEOUT 后检查是否收到响应
      setTimeout(() => {
        const lastPong = this.lastPong.get(plugin.id) ?? 0;

        if (lastPong < pingTime) {
          // 本次 ping 发出后未收到新的 pong → 超时
          const missed = (this.missedCounts.get(plugin.id) ?? 0) + 1;
          this.missedCounts.set(plugin.id, missed);

          if (missed >= this.MAX_MISSED) {
            this.handlePluginCrash(plugin);
          }
        } else {
          // 收到了有效 pong → 重置计数
          this.missedCounts.set(plugin.id, 0);
        }
      }, this.PONG_TIMEOUT);
    }, this.PING_INTERVAL);

    this.intervals.set(plugin.id, intervalId);
  }

  /**
   * 收到 pong 响应
   */
  handlePong(pluginId: string): void {
    this.lastPong.set(pluginId, Date.now());
    // 收到 pong 立即重置 missed 计数
    this.missedCounts.set(pluginId, 0);
  }

  /**
   * 插件崩溃处理 — 不影响其他插件
   */
  private handlePluginCrash(plugin: PluginInstance): void {
    console.error(`[ReUI] Plugin "${plugin.id}" is not responding. Marking as error.`);

    // 停止监控
    this.stopMonitoring(plugin.id);

    // 标记为 error 状态（不影响其他 iframe）
    plugin.state = 'error';

    // 通知 EventBus（其他插件可监听）
    EventBus.getInstance().emit('plugin:crashed', { pluginId: plugin.id });

    // 可选：自动尝试回收并重载
    // pluginManager.reloadPlugin(plugin.id);
  }

  /**
   * 停止监控
   */
  stopMonitoring(pluginId: string): void {
    const intervalId = this.intervals.get(pluginId);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(pluginId);
    }
    this.lastPong.delete(pluginId);
    this.missedCounts.delete(pluginId);
  }
}
```

**设计决策：**
- 每个 iframe 独立监控，一个插件崩溃不影响其他插件
- 心跳超时后标记为 `error` 状态，由 Plugin Manager 决定是否自动重载
- iframe 之间完全隔离，单个崩溃仅影响自身
- **隐藏插件暂停心跳**：处于 `hidden` 状态的插件暂停心跳监控（浏览器会对不可见 iframe 节流 JS 执行，可能导致 pong 超时误报）。当插件重新变为 `active` 时恢复监控

```typescript
  /**
   * 暂停监控（插件隐藏时调用，避免浏览器节流导致误报）
   */
  pauseMonitoring(pluginId: string): void {
    const intervalId = this.intervals.get(pluginId);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(pluginId);
    }
    // 保留 lastPong 和 missedCounts，恢复时重置
  }

  /**
   * 恢复监控（插件重新可见时调用）
   */
  resumeMonitoring(plugin: PluginInstance): void {
    if (this.intervals.has(plugin.id)) return; // 已在监控中
    // 重置计数器，重新开始
    this.lastPong.set(plugin.id, Date.now());
    this.missedCounts.set(plugin.id, 0);
    this.startMonitoring(plugin);
  }
```

## 10. 安全模型

### 10.1 iframe 沙箱

```html
<iframe
  src="plugin/index.html"
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
></iframe>
```

**关键决策：不包含 `allow-same-origin`**
- 移除 `allow-same-origin` 使 iframe 的 origin 变为唯一的 opaque origin (`null`)
- 这确保 iframe 无法访问父页面（Runtime）的 DOM、localStorage、Cookie
- 消息验证改用 `event.source` 而非 `event.origin`（因为 origin 始终为 `null`）
- 这是对 iframe 安全隔离的关键保障

### 10.2 消息验证

- 通过 MessageDispatcher 统一入口，根据 `event.source` 鉴别消息来源
- `event.source === null/window` → 游戏端消息
- `event.source` 匹配已注册 iframe → 插件消息
- 消息 schema 验证（格式不合规则丢弃）

### 10.3 权限控制

- 插件 manifest 中声明所需 capabilities
- Runtime PostMessage Router 在每次 API 调用时检查 capability
- 事件订阅检查 `events` 白名单
- HTTP 请求通过 Runtime 代理，可实施 URL 白名单
- NUI 事件转发需经过 Runtime 过滤

## 11. 开发模式支持

```typescript
// runtime.config.json
{
  "mode": "development",  // development | production
  "devServer": {
    "enabled": true,
    "port": 3000,
    "hmr": true
  }
}
```

开发模式下：
- iframe src 指向 Vite dev server（如 `http://localhost:3001`）
- iframe sandbox 自动追加 `allow-same-origin`（HMR WebSocket 需要此权限建立连接）
- 支持 HMR（Vite dev server 的 WebSocket 热更新正常工作）
- 消息日志输出到 console
- 可通过快捷键打开 DevTools overlay
- 签名验证跳过（允许无 `_lock` 的 plugin.json）
- 心跳超时阈值放宽（避免调试时误报崩溃）

> **安全说明：** 开发模式下追加 `allow-same-origin` 意味着 iframe 可以访问父页面的 DOM/Storage，这仅在本地开发时可接受。生产模式**绝对不包含** `allow-same-origin`，确保插件沙箱隔离。
