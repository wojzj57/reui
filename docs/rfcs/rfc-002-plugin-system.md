# RFC-002: Phase 2 — 插件系统

| 字段 | 值 |
|------|-----|
| **RFC 编号** | 002 |
| **标题** | Phase 2: 插件系统 |
| **状态** | Draft |
| **作者** | ReUI Team |
| **创建日期** | 2026-05-27 |
| **更新日期** | 2026-05-28 |
| **依赖** | RFC-001 (通讯层) |

---

## 1. 背景与动机

ReUI 是一个 FiveM NUI 插件框架，其核心架构为：单一 Runtime 宿主页面管理多个子插件（iframe）。RFC-001 已定义了 Runtime 与子页面之间的 postMessage 通讯协议（握手、请求/响应、推送、心跳）。

本 RFC 解决的核心问题是：**如何安全、可靠地发现、验证、加载、显示和管理这些子插件？**

具体挑战包括：

1. **插件发现**：Runtime 运行在 CEF 浏览器环境中，不具备文件系统访问能力，需要游戏端 Lua 层驱动插件发现
2. **配置安全**：plugin.json 存放在客户端本地，理论上可被玩家篡改以获取未授权功能
3. **层级管理**：HUD（始终可见）、Panel（互斥切换）、Overlay（栈式弹出）三种显示模式需要不同的生命周期管理
4. **权限隔离**：不同插件应获得最小权限，防止恶意/有缺陷的插件影响整个系统
5. **热重载**：开发体验要求在不重启整个 Runtime 的情况下刷新单个插件

---

## 2. 目标与非目标

### 2.1 目标

- 定义 `plugin.json` 完整配置规范（插件描述文件的 single source of truth）
- 设计从 Server Lua 扫描到 Runtime iframe 创建的完整下发链路
- 实现基于角色（`roleRestriction`）的加载控制和基于权限（`permissions`）的运行时 API 访问控制
- 设计三层安全机制：Schema 校验 → 服务端签名验证 → 运行时权限强制执行
- 定义 Plugin Manager 的完整 API 和 Layer System 的行为规范
- 定义插件状态机及各状态间的转换规则
- 支持开发模式下的热重载和生产模式下的安全签名

### 2.2 非目标

- 不定义具体 UI 组件库（由 `@reui/framework` 负责）
- 不定义 postMessage 协议细节（由 RFC-001 负责）
- 不定义跨插件 RPC 的具体业务协议（本 RFC 仅定义权限检查机制）
- 不实现插件市场/远程安装（本期仅支持本地部署）
- 不处理插件间依赖关系（插件相互独立，不存在加载顺序依赖）
- 不定义插件持久化存储方案（超出本阶段范围）

---

## 3. 详细设计

### 3.1 plugin.json 配置规范

每个插件必须包含一个 `plugin.json` 描述文件，定义插件的身份、入口、层级、权限等信息。

#### 3.1.1 完整 Schema

```typescript
interface PluginManifest {
  // ─── 身份标识 ───
  /** 唯一标识，用于通讯和管理（a-z0-9 + 连字符） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 版本号（semver 格式） */
  version: string;

  // ─── 入口配置 ───
  /** HTML 入口路径（相对于插件目录） */
  entry: string;
  /**
   * 开发模式入口（可选）
   * 指向 Vite dev server 等本地开发服务器，支持 HMR
   * 必须为 localhost 地址（localhost / 127.0.0.1 / ::1）
   * 仅在 Runtime 开发模式下生效
   */
  devEntry?: string;

  // ─── 层级与显示 ───
  /** 所属显示层级 */
  layer: "hud" | "panel" | "overlay";
  /** 显示尺寸/位置配置 */
  display?: {
    width?: string;              // CSS 值，默认 "100%"
    height?: string;             // CSS 值，默认 "100%"
    position?: "center" | "left" | "right" | "top" | "bottom";
    modal?: boolean;             // 仅 overlay 层：为 true 时先关闭栈内所有 Overlay
    zOffset?: number;            // 层内 z-index 偏移 0-99，默认 0
  };

  // ─── 权限要求 ───
  /**
   * 运行时 API 访问权限列表（AND 逻辑）
   *
   * Runtime 模块权限：
   *   "runtime.all"        — 所有模块
   *   "runtime.network"    — HTTP 请求
   *   "runtime.websocket"  — WebSocket
   *   "runtime.message"    — 插件间消息 / NUI 消息
   *   "runtime.dialog"     — 对话框 / Overlay
   *
   * 跨插件访问权限：
   *   "plugins.all"        — 访问任意其他插件
   *   "plugins.<id>"       — 仅访问指定插件
   */
  permissions?: string[];
  /**
   * 角色访问限制（OR 逻辑）
   * 非空时，用户必须至少拥有其中一个角色才能加载该插件
   * 空数组或未设置 = 不限制
   */
  roleRestriction?: string[];

  // ─── 生命周期 ───
  /** 是否默认启用，默认 true */
  enabled?: boolean;
  /** 默认快捷键绑定（最长 32 字符） */
  defaultHotkey?: string;

  // ─── 签名（部署时由 CLI 写入） ───
  _lock?: {
    version: 1;
    signedAt: string;            // ISO 8601
    algorithm: "hmac-sha256";
    signature: string;           // hex 编码的 HMAC-SHA256
  };
}
```

#### 3.1.2 双层权限模型

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: 角色访问限制（roleRestriction）                      │
│  决定插件能否被加载                                            │
│                                                              │
│  用户角色: ["police"]                                         │
│  hud         → roleRestriction: []          ✅ 加载          │
│  police-mdt  → roleRestriction: ["police"]  ✅ 加载          │
│  admin-panel → roleRestriction: ["admin"]   ❌ 不加载        │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: 权限（permissions）                                 │
│  决定已加载插件能调用什么（运行时检查，不影响加载/卸载）        │
│                                                              │
│  inventory → permissions: ["runtime.network"]                │
│             → http:request ✅ | ws:send ❌ PERMISSION_DENIED  │
└──────────────────────────────────────────────────────────────┘
```

两者完全独立：`permissions` 不影响插件的加载/卸载；`roleRestriction` 不影响已加载插件的 API 访问。

#### 3.1.3 最小配置示例

```json
{
  "id": "my-hud",
  "name": "My HUD",
  "version": "1.0.0",
  "entry": "index.html",
  "layer": "hud"
}
```

#### 3.1.4 完整配置示例

```json
{
  "id": "inventory",
  "name": "Inventory System",
  "version": "2.1.0",
  "entry": "dist/index.html",
  "devEntry": "http://localhost:3001",
  "layer": "panel",
  "display": {
    "width": "600px",
    "height": "450px",
    "position": "center",
    "zOffset": 10
  },
  "permissions": [
    "runtime.network",
    "runtime.message",
    "plugins.hud"
  ],
  "roleRestriction": [],
  "enabled": true,
  "defaultHotkey": "F2"
}
```

#### 3.1.5 高权限 + 角色限制示例

```json
{
  "id": "admin-panel",
  "name": "Admin Panel",
  "version": "1.0.0",
  "entry": "dist/index.html",
  "devEntry": "http://localhost:3010",
  "layer": "overlay",
  "display": {
    "width": "80vw",
    "height": "80vh",
    "position": "center"
  },
  "roleRestriction": ["admin"],
  "permissions": ["runtime.all", "plugins.all"],
  "defaultHotkey": "F10"
}
```

---

### 3.2 插件发现与下发 (Server → Client → CEF)

Runtime 运行在 CEF 浏览器环境中，**不具备文件系统访问能力**。插件发现由游戏端 Lua 驱动，经过三跳到达 Runtime。

#### 3.2.1 消息流架构

```
┌─────────────────────┐     TriggerClientEvent      ┌─────────────────┐
│   Server Script      │ ────────────────────────→   │  Client Script   │
│   (server.lua)       │  已验签的插件列表           │  (client.lua)    │
│                      │                             │                  │
│  • 扫描 plugins/     │                             │  • 转发给 CEF    │
│  • 读取 plugin.json  │                             │  • SendNUIMessage│
│  • 签名验证（生产）  │                             │                  │
│  • 过滤无效插件      │                             │                  │
└─────────────────────┘                             └────────┬─────────┘
                                                             │ NUI
                                                             ▼
                                                    ┌─────────────────┐
                                                    │    Runtime       │
                                                    │    (CEF/NUI)     │
                                                    │                  │
                                                    │  • Schema 校验   │
                                                    │  • 配置覆盖      │
                                                    │  • 角色检查      │
                                                    │  • 创建 iframe   │
                                                    └─────────────────┘
```

**安全设计原则：**
- 签名密钥 (`reui_sign_key`) 仅配置在 `server.cfg` 中，仅服务端代码可读
- 签名验证在服务端完成，客户端和 CEF 永远不接触密钥
- 客户端和 CEF 信任来自服务端的已验证数据

#### 3.2.2 Server 端实现

```lua
-- server.lua：扫描插件目录、签名验证、下发给客户端
-- 签名密钥仅存在于服务端，客户端不可访问

local signKey = GetConvar('reui_sign_key', '')   -- 仅服务端可读
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
            print('[ReUI] REJECTED: ' .. (manifest.id or dir) .. ' - signature invalid')
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

#### 3.2.3 Client 端中转

```lua
-- client.lua：接收服务端下发的已验证插件列表，转发给 CEF (Runtime)

local resourceName = GetCurrentResourceName()

-- 玩家加载完毕后请求初始化
AddEventHandler('playerSpawned', function()
  -- 先通知 Runtime 资源名称（NUI Bridge 初始化需要）
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

---

### 3.3 Runtime 加载流程

Runtime 收到 `reui:plugin-registry` 消息后，按以下管道顺序处理：

```
接收插件清单列表（已通过服务端验签）
        │
        ▼
┌─────────────────────────────┐
│ 1. Zod Schema 校验           │  ← 格式不合规立即跳过，不影响其他插件
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 2. 应用 Runtime 主配置覆盖   │  ← runtime.config.json overrides
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 3. 过滤 enabled === false   │
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 4. 角色访问限制检查          │  ← roleRestriction vs 当前用户角色
│    不匹配 → 标记 role_denied │     OR 逻辑：至少拥有一个角色
│    不创建 iframe              │
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 5. 逐个创建 iframe 并加载    │  ← 进入 loading 状态
│    加载顺序不保证             │     插件不应依赖加载顺序
└─────────────────────────────┘
```

#### Runtime 主配置覆盖

Runtime 可通过自己的配置文件覆盖插件设置，优先级：`runtime.config.json` > `plugin.json`

```json
// runtime.config.json
{
  "plugins": {
    "overrides": {
      "inventory": {
        "enabled": true,
        "defaultHotkey": "F3"
      },
      "admin-panel": {
        "enabled": false
      }
    },
    "disableAll": false
  }
}
```

#### 加载入口代码

```typescript
nuiBridge.onGameEvent('reui:plugin-registry', async (data) => {
  const { plugins, mode } = data as {
    plugins: Array<{ manifest: PluginManifest; basePath: string }>;
    mode: 'development' | 'production';
  };

  pluginLoader.init(mode);

  for (const { manifest, basePath } of plugins) {
    // 1. Schema 校验
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      console.error(`[ReUI] Invalid: ${manifest.id}`, validation.errors);
      continue;
    }

    // 2. 应用覆盖
    const resolved = applyOverrides(manifest);

    // 3. 过滤 disabled
    if (resolved.enabled === false) continue;

    // 4. 角色检查
    if (!checkRoleAccess(resolved, authService.getRoles())) {
      pluginManager.markDenied(resolved.id, 'role_denied');
      continue;
    }

    // 5. 加载
    await pluginManager.loadPlugin(resolved, basePath);
  }
});
```

---

### 3.4 Plugin Manager

Plugin Manager 是 Runtime 中管理所有插件实例的核心服务。

#### 3.4.1 PluginInstance 接口

```typescript
interface PluginInstance {
  id: string;
  config: PluginManifest;
  iframe: HTMLIFrameElement;
  state: PluginState;   // 'loading' | 'ready' | 'active' | 'hidden' | 'error'
  origin: string;

  /** 向插件发送消息 */
  postMessage(message: RuntimeMessage): void;

  /** 销毁实例（移除 DOM、清理事件订阅、停止心跳） */
  destroy(): void;
}
```

#### 3.4.2 PluginManager API

```typescript
class PluginManager {
  private plugins: Map<string, PluginInstance>;
  private registeredPlugins: Map<string, PluginManifest>;
  private layerSystem: LayerSystem;

  // ─── 生命周期 ───
  async loadPlugin(manifest: PluginManifest, basePath: string): Promise<void>;
  async unloadPlugin(pluginId: string, reason?: string): Promise<void>;
  async reloadPlugin(pluginId: string): Promise<void>;
  async reloadAll(): Promise<void>;

  // ─── 显示控制 ───
  showPlugin(pluginId: string): void;
  hidePlugin(pluginId: string): void;
  activatePanel(pluginId: string): void;   // Panel 层互斥激活
  togglePanel(pluginId: string): void;

  // ─── 查询 ───
  getPlugin(pluginId: string): PluginInstance | undefined;
  getActivePlugins(): PluginInstance[];
  findBySource(source: MessageEventSource): PluginInstance | undefined;

  // ─── 角色管理 ───
  reevaluateRoles(): void;
  markDenied(pluginId: string, reason: string): void;
}
```

#### 3.4.3 activatePanel 互斥逻辑

Panel 层同一时间只允许一个面板处于 `active` 状态：

```typescript
activatePanel(pluginId: string): void {
  const target = this.plugins.get(pluginId);
  if (!target || target.config.layer !== 'panel') return;

  const currentActive = this.getActivePanelPlugin();

  // Toggle 语义：再次激活同一面板 = 关闭
  if (currentActive?.id === pluginId) {
    this.hidePlugin(pluginId);
    this.layerSystem.releaseFocus();
    return;
  }

  // 关闭当前活跃面板
  if (currentActive) {
    this.hidePlugin(currentActive.id);
  }

  // 激活目标面板
  this.showPlugin(pluginId);
  this.layerSystem.setFocusLayer('panel');
}
```

#### 3.4.4 角色变更时的重评估

当用户角色变更时（如换班、升级），Plugin Manager 重新评估所有插件：

```typescript
reevaluateRoles(): void {
  const userRoles = authService.getRoles();

  for (const [id, manifest] of this.registeredPlugins) {
    const allowed = checkRoleAccess(manifest, userRoles);
    const instance = this.activePlugins.get(id);

    if (allowed && !instance) {
      this.loadPlugin(manifest);              // 新获得角色 → 加载
    } else if (!allowed && instance) {
      this.unloadPlugin(id, 'role_revoked');   // 失去角色 → 卸载
    }
  }
}

function checkRoleAccess(manifest: PluginManifest, userRoles: string[]): boolean {
  // 无角色限制 → 任何人可加载
  if (!manifest.roleRestriction?.length) return true;
  // OR 逻辑：用户至少拥有一个匹配角色
  return manifest.roleRestriction.some(role => userRoles.includes(role));
}
```

角色来源通过 NUI 从游戏端推送：

```typescript
nuiBridge.onGameEvent('auth:setRoles', (data) => {
  const { roles, user } = data;
  authService.updateRoles(roles);
  authService.updateUser(user);
  pluginManager.reevaluateRoles();  // 触发重评估
});
```

#### 3.4.5 热重载流程

```typescript
async reloadPlugin(pluginId: string): Promise<void> {
  const manifest = this.registeredPlugins.get(pluginId);
  if (!manifest) throw new Error(`Plugin not found: ${pluginId}`);

  const instance = this.activePlugins.get(pluginId);
  if (instance) {
    // 1. 通知插件即将卸载（让插件保存状态）
    instance.postMessage({
      type: 'reui:push',
      event: 'plugin:beforeUnload',
      payload: { reason: 'reload' },
    });

    // 2. 等待插件响应（最多 5s，超时强制继续）
    await this.waitForPluginAck(pluginId, 'unload-ready', 5000).catch(() => {});
  }

  // 3. 销毁旧实例
  await this.destroyPluginInstance(pluginId);

  // 4. 通过 NUI 请求游戏端重新读取 plugin.json
  const freshManifest = await this.requestManifestFromGame(pluginId);
  if (freshManifest) {
    this.registeredPlugins.set(pluginId, freshManifest);
  }

  // 5. 角色检查
  const targetManifest = freshManifest ?? manifest;
  if (!checkRoleAccess(targetManifest, authService.getRoles())) {
    console.warn(`[ReUI] Reload blocked: role restriction not met`);
    return;
  }

  // 6. 创建新实例
  await this.loadPlugin(targetManifest);
}
```

热重载触发方式：

| 触发方式 | 场景 |
|----------|------|
| 游戏端命令 | `/reui reload <pluginId>` |
| 开发快捷键 | Ctrl+Shift+R（开发模式） |
| 管理面板 API | 需 `plugins.<pluginId>` 权限 |
| 文件监听 | 开发模式下 plugin.json 变更自动重载 |

---

### 3.5 Layer System (HUD / Panel / Overlay)

#### 3.5.1 层级定义

| 层级 | z-index 范围 | 可见性 | 输入行为 | 管理模式 |
|------|-------------|--------|----------|----------|
| **HUD** | 100-199 | 始终可见 | `pointer-events: none`（鼠标穿透） | 独立并存 |
| **Panel** | 200-299 | 按需切换 | `SetNuiFocusInput(true)`（拦截键鼠） | **互斥** |
| **Overlay** | 300-399 | 栈式弹出 | 遮罩阻止下层交互 | **栈式管理** |

#### 3.5.2 LayerSystem API

```typescript
class LayerSystem {
  private layers: Map<LayerType, HTMLDivElement>;
  private overlayStack: OverlayStack;

  /** 将 iframe 放入指定层容器 */
  attachToLayer(iframe: HTMLIFrameElement, layer: LayerType): void;

  /** 控制层可见性 */
  showLayer(layer: LayerType): void;
  hideLayer(layer: LayerType): void;

  /** 输入焦点管理 */
  setFocusLayer(layer: LayerType): void;
  releaseFocus(): void;

  /** Cursor 控制（与 FiveM 输入系统联动） */
  setCursorVisible(visible: boolean): void;
}
```

#### 3.5.3 OverlayStack 栈式管理

Overlay 层支持多实例叠加，后入先出（LIFO）：

```typescript
class OverlayStack {
  private stack: PluginInstance[] = [];
  private onStackEmpty: () => void;

  constructor(onStackEmpty: () => void) {
    this.onStackEmpty = onStackEmpty;
  }

  /** 压入新 Overlay（显示在最顶层） */
  push(plugin: PluginInstance): void {
    // 隐藏当前栈顶（不销毁，只是不可见）
    const current = this.peek();
    if (current) current.iframe.style.visibility = 'hidden';

    this.stack.push(plugin);
    plugin.iframe.style.visibility = 'visible';
  }

  /** 弹出栈顶 Overlay（恢复前一个的可见性） */
  pop(): PluginInstance | undefined {
    const removed = this.stack.pop();
    if (removed) removed.iframe.style.visibility = 'hidden';

    // 恢复新栈顶
    const current = this.peek();
    if (current) current.iframe.style.visibility = 'visible';

    // 栈空时通知 LayerSystem 释放焦点
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

**modal 模式：** 当 Overlay 插件设置 `display.modal: true` 时，push 前会先 `clear()` 栈内所有现有 Overlay。

#### 3.5.4 输入控制规则

```
HUD 层活跃:      pointer-events: none → 鼠标穿透到游戏
Panel 层打开:     SetNuiFocusInput(true) → 拦截键鼠输入
Overlay 层打开:   遮罩覆盖 Panel 层 → 阻止下层交互
所有层关闭:       SetNuiFocusInput(false) → 输入归还游戏
```

---

### 3.6 iframe 沙箱与创建

#### 3.6.1 Sandbox 策略

| 模式 | sandbox 值 | 原因 |
|------|-----------|------|
| **生产** | `allow-scripts` | 最小权限，iframe origin 为 opaque `null` |
| **开发** | `allow-scripts allow-same-origin` | Vite HMR WebSocket 需要 same-origin |

**安全含义：**
- 移除 `allow-same-origin` → iframe origin 变为唯一 opaque origin (`null`)
- iframe 无法访问父页面的 DOM、localStorage、Cookie
- 消息验证使用 `event.source`（非 `event.origin`，因 origin 始终为 `null`）
- Sandbox 配置由 Runtime 统一控制，插件不能自行声明附加 token

#### 3.6.2 iframe 创建实现

```typescript
function createPluginIframe(
  manifest: PluginManifest,
  basePath: string
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');

  // 确定入口 URL
  const isDevMode = getRuntimeMode() === 'development';
  const baseUrl = isDevMode && manifest.devEntry
    ? manifest.devEntry
    : resolvePluginEntry(basePath, manifest.entry);

  // 追加 ?__reui_id=<pluginId>（SDK 通过此参数自动获取 pluginId）
  const url = new URL(baseUrl, location.href);
  url.searchParams.set('__reui_id', manifest.id);
  iframe.src = url.toString();

  // 标识
  iframe.id = `plugin-${manifest.id}`;
  iframe.dataset.layer = manifest.layer;

  // Sandbox 配置
  const sandboxTokens = ['allow-scripts'];
  if (isDevMode) {
    sandboxTokens.push('allow-same-origin');
  }
  iframe.sandbox.value = sandboxTokens.join(' ');

  // 样式（全部预加载但可能不可见）
  iframe.style.cssText = `
    border: none;
    position: absolute;
    top: 0; left: 0;
    width: ${manifest.display?.width ?? '100%'};
    height: ${manifest.display?.height ?? '100%'};
  `;

  return iframe;
}
```

#### 3.6.3 pluginId 传递机制

使用 URL 查询参数 `?__reui_id=<pluginId>` 而非 DOM 属性 `data-plugin-id`：
- 原因：sandbox 不含 `allow-same-origin` 时，`window.frameElement` 返回 `null`（浏览器安全策略），无法从父页面属性读取
- URL 查询参数在任何 sandbox 配置下都可靠读取

---

### 3.7 插件状态机

#### 3.7.1 状态定义

```typescript
type PluginState = 'loading' | 'ready' | 'active' | 'hidden' | 'error';
```

| 状态 | 含义 |
|------|------|
| `loading` | iframe 已创建，等待握手完成 |
| `ready` | 握手成功，初始不可见状态 |
| `active` | 可见且接收交互 |
| `hidden` | 不可见（仍在 DOM 中，保持 postMessage 连接） |
| `error` | 加载失败 / 握手超时 / 心跳超时 |

#### 3.7.2 状态转换图

```
                     ┌──────────────┐
                     │  (未加载)     │
                     └──────┬───────┘
                            │ 权限检查通过 + enabled + 创建 iframe
                            ▼
                     ┌──────────────┐
            ┌───────→│   loading    │←───────────┐
            │        └──────┬───────┘            │
            │               │ 握手成功            │ 热重载
            │               ▼                    │ (销毁旧 → 重建)
            │        ┌──────────────┐            │
            │        │    ready     │            │
            │        └───┬─────┬───┘            │
            │            │     │                 │
            │     show   │     │  初始 hidden    │
            │            ▼     ▼                 │
            │     ┌────────┐ ┌────────┐          │
            │     │ active │ │ hidden │          │
            │     └───┬────┘ └───┬────┘          │
            │         │  ←toggle→ │              │
            │         └─────┬─────┘              │
            │               │ reload             │
            │               └────────────────────┘
            │
            │        ┌──────────────┐
            │        │    error     │
            │        │(加载失败/    │
            │        │ 握手超时/    │
            │        │ 心跳超时)    │
            │        └──────┬───────┘
            │               │ 手动重载
            └───────────────┘
```

#### 3.7.3 转换规则

| 源状态 | 目标状态 | 触发条件 |
|--------|---------|----------|
| `loading` | `ready` | 握手成功（收到 `plugin:ready`） |
| `loading` | `error` | 握手超时（5s）/ iframe `onerror` |
| `ready` | `active` | 首次显示（HUD 自动激活，Panel/Overlay 用户触发） |
| `ready` | `hidden` | 初始不显示（Panel/Overlay 等待触发） |
| `active` | `hidden` | `hidePlugin` / `togglePanel` / 另一 Panel `activatePanel` |
| `hidden` | `active` | `showPlugin` / `activatePanel` / Overlay `push` |
| `active/hidden` | `loading` | 热重载（销毁旧 iframe → 创建新 iframe） |
| `active/hidden` | `error` | 心跳超时（连续 3 次 ping 无 pong 响应） |
| `error` | `loading` | 手动重载（`reloadPlugin`） |

**重要设计决策：**
- `error` 状态**不自动恢复**，避免无限重试循环
- `hidden` 状态**暂停心跳**监控，防止浏览器对不可见 iframe 节流 JS 执行导致误报
- 恢复方式：游戏端命令 (`/reui reload`)、开发快捷键、或管理面板触发

---

## 4. 安全机制

### 安全架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      安全防护三层模型                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: Schema 校验 (Zod)                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Zod Schema 验证 → 格式错误立即拒绝，不影响其他插件        │  │
│  │  （服务端 + Runtime 双重执行）                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 2: 服务端签名验证 (_lock 字段)                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  CLI 对安全字段计算 HMAC-SHA256 → 嵌入 _lock 字段         │  │
│  │  游戏服务端验证签名 → 仅下发通过验证的插件给客户端         │  │
│  │  密钥仅存于服务端，客户端/CEF 永远不接触密钥              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 3: 运行时权限强制执行                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PostMessageRouter 对每次 API 调用检查 permissions         │  │
│  │  跨插件消息检查 plugins.xxx 权限                           │  │
│  │  即使绕过前两层，运行时依然拦截越权调用                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 4.1 Schema 校验 (Zod)

Schema 定义在 `workspace/cli/src/schema/plugin-manifest.ts`，是所有校验的 single source of truth。Runtime 也引用 `@reui/cli` 包进行运行时校验。

```typescript
import { z } from 'zod';

// 权限字符串格式：点分层级 + 可选通配符后缀
const PermissionString = z.string().regex(
  /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/,
  'Permission must be dot-separated lowercase with optional .* suffix'
);

export const PluginManifestSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+/),  // semver
  entry: z.string().min(1).refine(
    (v) => !v.includes('..'),
    'Path traversal (..) not allowed'
  ),
  devEntry: z.string().url().refine(
    (v) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(v),
    'devEntry must point to localhost'
  ).optional(),
  layer: z.enum(['hud', 'panel', 'overlay']),
  display: z.object({
    width: z.string().optional(),
    height: z.string().optional(),
    position: z.enum(['center', 'left', 'right', 'top', 'bottom']).optional(),
    modal: z.boolean().optional(),
    zOffset: z.number().int().min(0).max(99).optional(),
  }).optional(),
  permissions: z.array(PermissionString).optional(),
  roleRestriction: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  defaultHotkey: z.string().max(32).optional(),
});

// 安全字段子集（用于签名）
export const SecuredFieldsSchema = z.object({
  id: z.string(),
  version: z.string(),
  entry: z.string(),
  layer: z.enum(['hud', 'panel', 'overlay']),
  permissions: z.array(z.string()),
  roleRestriction: z.array(z.string()),
  enabled: z.boolean(),
});

/** 从完整 manifest 提取安全字段 */
export function extractSecuredFields(manifest: PluginManifest): SecuredFields {
  return {
    id: manifest.id,
    version: manifest.version,
    entry: manifest.entry,
    layer: manifest.layer,
    permissions: (manifest.permissions ?? []).sort(),
    roleRestriction: (manifest.roleRestriction ?? []).sort(),
    enabled: manifest.enabled ?? true,
  };
}

/** 规范化为确定性结构（固定 key 顺序 + 值排序） */
export function normalizeForSigning(secured: SecuredFields): SecuredFields {
  return {
    id: secured.id,
    version: secured.version,
    entry: secured.entry,
    layer: secured.layer,
    permissions: [...secured.permissions].sort(),
    roleRestriction: [...secured.roleRestriction].sort(),
    enabled: secured.enabled,
  };
}
```

**校验能力：**
- 类型检查（string / number / array / boolean）
- 格式约束（regex、url、min/max length）
- 权限字符串格式验证（点分层级 + 可选通配符后缀）
- 路径穿越检测（entry 不允许 `..`）
- devEntry localhost 限制（防止意外加载远程资源）
- 未知字段被忽略不报错（前向兼容）

---

### 4.2 嵌入式签名 (_lock)

#### 4.2.1 签名覆盖的字段（SecuredFields）

| 字段 | 纳入签名 | 理由 |
|------|:--------:|------|
| `id` | ✅ | 防止冒充其他插件 |
| `version` | ✅ | 防止版本回退攻击 |
| `entry` | ✅ | 防止替换为恶意 HTML |
| `layer` | ✅ | 防止 HUD 伪装为 Overlay 获取模态控制 |
| `permissions` | ✅ | 防止自行添加高权限 |
| `roleRestriction` | ✅ | 防止清空角色限制 |
| `enabled` | ✅ | 防止启用未授权插件 |
| `name` | ❌ | 仅显示用途 |
| `display` | ❌ | 仅影响尺寸位置 |
| `defaultHotkey` | ❌ | 仅影响快捷键 |
| `devEntry` | ❌ | 生产模式下忽略 |

#### 4.2.2 签名算法

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

export interface SignResult {
  signature: string;
  signedAt: string;
}

/** 对 manifest 安全字段签名 */
export function signManifest(manifest: PluginManifest, secretKey: string): SignResult {
  const secured = extractSecuredFields(manifest);
  const normalized = normalizeForSigning(secured);
  const payload = JSON.stringify(normalized);
  const signature = createHmac('sha256', secretKey).update(payload).digest('hex');
  return { signature, signedAt: new Date().toISOString() };
}

/** 验证签名（timing-safe 防止时序攻击） */
export function verifyManifest(manifest: PluginManifest, secretKey: string): boolean {
  if (!manifest._lock?.signature) return false;
  const { signature } = signManifest(manifest, secretKey);
  const expected = Buffer.from(signature, 'hex');
  const actual = Buffer.from(manifest._lock.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

#### 4.2.3 密钥管理

```
┌──────────────────────────────────────────────────────────────────┐
│                     密钥仅存在于两个位置                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 构建/部署环境                    2. 游戏服务端                │
│  ┌───────────────────────┐           ┌──────────────────────┐    │
│  │ 环境变量 REUI_SIGN_KEY │           │ server.cfg convar    │    │
│  │ CLI: reui sign        │           │ reui_sign_key        │    │
│  │ Vite: build 时签名    │           │ server.lua 验签      │    │
│  └───────────────────────┘           └──────────────────────┘    │
│                                                                  │
│  ⚠ 客户端 (client.lua) 和 CEF (Runtime) 不使用也不传递密钥       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

```cfg
# server.cfg
set reui_sign_key "your-secret-signing-key-here"
set reui_mode "production"
```

#### 4.2.4 签名后的 plugin.json

```json
{
  "id": "inventory",
  "name": "Inventory System",
  "version": "2.1.0",
  "entry": "dist/index.html",
  "layer": "panel",
  "permissions": ["runtime.network", "runtime.message", "plugins.hud"],
  "enabled": true,
  "_lock": {
    "version": 1,
    "signedAt": "2026-05-28T10:00:00Z",
    "algorithm": "hmac-sha256",
    "signature": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
  }
}
```

#### 4.2.5 开发模式 vs 生产模式

| 行为 | 开发模式 | 生产模式 |
|------|----------|----------|
| Schema 校验 | ✅ 执行（Runtime） | ✅ 执行（Runtime） |
| `_lock` 签名验证 | ⏭️ 跳过（服务端） | ✅ 服务端必须通过 |
| 无 `_lock` 字段 | ✅ 允许加载 | ❌ 服务端拒绝下发 |
| `devEntry` | ✅ 生效 | ⏭️ 忽略 |
| `permissions` 强制执行 | ✅ 运行时检查 | ✅ 运行时检查 |
| iframe sandbox | `allow-scripts allow-same-origin` | `allow-scripts` |
| 热重载文件监听 | ✅ 开启 | ❌ 关闭 |

#### 4.2.6 篡改场景分析

| 攻击方式 | 结果 |
|----------|------|
| 客户端清空 `roleRestriction: []` | ❌ 服务端验签失败，不下发 |
| 客户端添加 `permissions: ["runtime.all"]` | ❌ 服务端验签失败，不下发 |
| 客户端删除 `_lock` 字段 | ❌ 服务端生产模式要求 _lock 存在 |
| 复制其他插件的 `_lock` | ❌ 签名基于全部安全字段，id 不匹配 |
| 替换 `entry` 指向恶意 HTML | ❌ entry 纳入签名，验签失败 |
| 修改 `name`/`display`/`defaultHotkey` | ✅ 允许，非安全字段 |
| 注入客户端脚本获取签名密钥 | ❌ 密钥不经过客户端传输 |

---

### 4.3 运行时权限强制执行

即使配置层被绕过（如开发模式下无签名验证），PostMessageRouter 依然在**每次 API 调用时**做实时权限检查。

#### 4.3.1 Method → Permission 映射

| Method | 所需权限 |
|--------|---------|
| `http:request` | `runtime.network` |
| `ws:send` / `ws:state` | `runtime.websocket` |
| `event:subscribe` / `event:unsubscribe` / `event:emit` | `runtime.message` |
| `nui:send` | `runtime.message` |
| `plugin:show` / `plugin:hide` / `plugin:ready` | 无（控制自身） |
| `plugin:getConfig` / `plugin:saveState` / `plugin:restoreState` | 无 |
| `plugin:message`（跨插件） | `plugins.all` 或 `plugins.<targetId>` |

#### 4.3.2 权限检查实现

```typescript
class PostMessageRouter {
  private pluginPermissions: Map<string, string[]>; // pluginId → granted

  handleRequest(plugin: PluginInstance, message: RequestMessage): void {
    // 1. 提取 method 所需的 permission
    const required = this.getRequiredPermission(message.method);

    // 2. 检查插件是否被授予
    if (required) {
      const granted = this.pluginPermissions.get(plugin.id) ?? [];
      if (!this.hasPermission(granted, required)) {
        this.sendError(plugin, message.id, {
          code: 'PERMISSION_DENIED',
          message: `Plugin "${plugin.id}" lacks permission "${required}"`,
          details: { method: message.method, required },
        });
        return;
      }
    }

    // 3. 跨插件消息额外检查
    if (message.method === 'plugin:message') {
      const targetId = message.params.targetPluginId;
      if (!this.canAccessPlugin(plugin.id, targetId)) {
        this.sendError(plugin, message.id, {
          code: 'PERMISSION_DENIED',
          message: `Plugin "${plugin.id}" cannot access plugin "${targetId}"`,
        });
        return;
      }
    }

    // 4. 通过检查，转发到对应 handler
    this.dispatch(plugin, message);
  }

  /** 支持通配符的权限匹配 */
  private hasPermission(granted: string[], required: string): boolean {
    if (granted.includes(required)) return true;
    if (granted.includes('runtime.all')) return true;

    // 通配符匹配：runtime.* → 匹配 runtime.network 等
    const parts = required.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const wildcard = parts.slice(0, i).join('.') + '.*';
      if (granted.includes(wildcard)) return true;
    }
    return false;
  }

  /** 跨插件访问检查 */
  private canAccessPlugin(sourceId: string, targetId: string): boolean {
    const granted = this.pluginPermissions.get(sourceId) ?? [];
    return granted.includes('plugins.all') || granted.includes(`plugins.${targetId}`);
  }
}
```

---

## 5. 测试计划

### 5.1 单元测试

| 测试模块 | 覆盖内容 | 工具 |
|----------|---------|------|
| Zod Schema | 合法/非法 manifest、边界值、路径穿越检测、devEntry localhost 限制 | Vitest |
| 签名算法 | `signManifest` / `verifyManifest`、字段排序确定性、篡改后验证失败 | Vitest |
| 角色检查 | 空 `roleRestriction`、OR 匹配逻辑、角色变更后重评估 | Vitest |
| 权限匹配 | 精确匹配、通配符（`runtime.*`）、`runtime.all`、跨插件权限 | Vitest |
| Plugin Manager | `loadPlugin` / `unloadPlugin` / `activatePanel` / `reevaluateRoles` | Vitest + jsdom |
| Layer System | 层级分配、z-index 正确性、Panel 互斥逻辑 | Vitest + jsdom |
| OverlayStack | `push` / `pop` / `clear`、栈空回调、visibility 切换 | Vitest |
| 状态机 | 所有合法转换通过、非法转换拒绝、error 不自动恢复 | Vitest |

### 5.2 集成测试

| 测试场景 | 验证点 |
|----------|--------|
| 完整加载链路 | Server 扫描 → Client 中转 → Runtime 加载 → iframe 创建 → 握手成功 |
| 签名验证拒绝 | 篡改 plugin.json 安全字段 → 服务端拒绝下发 |
| 权限拒绝 | 无 `runtime.network` 的插件调用 `http:request` → PERMISSION_DENIED |
| 角色动态变更 | 授予 admin 角色 → admin-panel 自动加载；撤销 → 自动卸载 |
| Panel 互斥 | 激活 Panel A → 激活 Panel B → A 被隐藏、B 显示 |
| Overlay 栈 | push A → push B → pop → B 隐藏、A 恢复可见 |
| 热重载 | reloadPlugin → 旧 iframe 销毁 → 新 iframe 创建 → 状态恢复 |
| 多插件并行 | 10+ 插件同时加载不冲突、不阻塞 |

### 5.3 安全测试

| 攻击向量 | 预期结果 |
|----------|---------|
| 客户端篡改 plugin.json 安全字段 | 服务端验签失败，插件不被下发 |
| iframe 尝试访问父页面 DOM | sandbox 阻止（生产模式无 `allow-same-origin`） |
| 伪造 postMessage 来源 | MessageDispatcher 通过 `event.source` 鉴别，未注册来源丢弃 |
| 超出声明权限的 API 调用 | PostMessageRouter 返回 `PERMISSION_DENIED` |
| 未经授权的跨插件消息 | 缺少 `plugins.<targetId>` 权限，拒绝 |
| 注入客户端脚本获取签名密钥 | 密钥不经过客户端传输，无法获取 |

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `plugin.json` 通过 Zod Schema 校验，非法配置被正确拒绝且不影响其他插件
- [ ] Server Lua 正确扫描 `plugins/` 目录，生产模式验签后下发
- [ ] 已验签的插件列表通过 Server → Client → CEF 三跳到达 Runtime
- [ ] Runtime 正确执行加载流水线（Schema → override → filter → role → iframe）
- [ ] Plugin Manager 实现 load / unload / show / hide / activatePanel / togglePanel
- [ ] HUD 层始终可见且鼠标穿透（`pointer-events: none`）
- [ ] Panel 层互斥切换，打开时接管输入（`SetNuiFocusInput(true)`）
- [ ] Overlay 层栈式管理，支持 push / pop / clear
- [ ] iframe sandbox 生产模式为 `allow-scripts`，开发模式追加 `allow-same-origin`
- [ ] 插件状态机正确流转，error 状态不自动恢复
- [ ] 角色变更时自动加载/卸载受影响插件
- [ ] Runtime 主配置可覆盖插件的 enabled / defaultHotkey 等字段
- [ ] 热重载完整流程（通知 → 保存状态 → 销毁 → 重建 → 恢复）

### 6.2 安全验收

- [ ] 生产模式下无 `_lock` 字段的插件被服务端拒绝下发
- [ ] 篡改安全字段后签名验证失败
- [ ] 密钥仅存在于服务端，客户端/CEF 不可获取
- [ ] iframe 内脚本无法访问父页面 DOM / localStorage
- [ ] 权限检查在每次 API 调用时执行，未授权调用返回 PERMISSION_DENIED
- [ ] 跨插件消息需要 `plugins.<targetId>` 或 `plugins.all` 权限
- [ ] 未知 postMessage 来源被静默丢弃

### 6.3 性能验收

- [ ] 20 个插件同时加载时 Runtime 启动时间 < 3s
- [ ] Plugin Manager 操作（show/hide/toggle）响应时间 < 16ms（一帧内）
- [ ] 心跳监控不显著增加 CPU 占用（< 1%）
- [ ] hidden 状态插件暂停心跳，不产生无效开销
- [ ] 热重载单个插件 < 1s（不计插件自身初始化时间）

### 6.4 开发体验验收

- [ ] `devEntry` 指向 Vite dev server 时 HMR 正常工作
- [ ] `reui validate` 命令正确报告 Schema 错误
- [ ] `reui sign` 命令正确签名并输出 dist/plugin.json
- [ ] Vite 插件（`vitePluginReUI()`）在 serve 模式下实时校验 plugin.json 变更

---

## 7. 依赖关系 (依赖 RFC-001)

### 7.1 依赖 RFC-001（通讯层）

本 RFC 依赖 RFC-001 定义的以下能力：

| RFC-001 提供的能力 | 本 RFC 使用场景 |
|-------------------|----------------|
| postMessage 请求/响应协议 | 插件 API 调用 + 权限检查 |
| 握手流程 (handshake) | 插件 `loading` → `ready` 状态转换 |
| 心跳机制 (ping/pong) | 插件崩溃检测 → `error` 状态 |
| 推送消息 (push) | 事件订阅转发、`plugin:beforeUnload` 通知 |
| MessageDispatcher | 统一消息入口，`event.source` 来源鉴别 |
| 错误码体系 | `PERMISSION_DENIED`、`METHOD_NOT_FOUND` 等 |

### 7.2 本 RFC 提供给后续模块的能力

| 下游模块 | 依赖本 RFC 的能力 |
|----------|------------------|
| `@reui/core` SDK | 通过 `?__reui_id` 获取身份，依赖握手后的通讯通道 |
| `@reui/cli` | Zod Schema 定义、签名/验签算法、CLI 命令实现 |
| `@reui/framework` | 依赖插件状态（`active`/`hidden`）驱动 UI 行为 |
| 游戏端 Lua | 遵循本 RFC 定义的扫描 → 验签 → 下发流程 |
| DevTools / 管理面板 | 依赖 Plugin Manager API 和状态机查询 |

### 7.3 相关源码路径

```
workspace/cli/src/schema/plugin-manifest.ts    ← Zod Schema (source of truth)
workspace/cli/src/core/validator.ts            ← 校验逻辑
workspace/cli/src/core/signer.ts               ← 签名/验签
workspace/cli/src/core/scanner.ts              ← 目录扫描
workspace/cli/src/vite-plugin/index.ts         ← Vite 集成
workspace/runtime/src/plugin-manager.ts        ← Plugin Manager
workspace/runtime/src/layer-system.ts          ← Layer System
workspace/runtime/src/post-message-router.ts   ← 权限检查
```

### 7.4 实现顺序建议

```
Phase 2.1: plugin.json Schema + Zod 校验          (@reui/cli)
Phase 2.2: Plugin Manager + Layer System           (Runtime)
Phase 2.3: iframe 创建 + 状态机                    (Runtime)
Phase 2.4: 签名机制                                (@reui/cli + server.lua)
Phase 2.5: 运行时权限强制执行                      (PostMessageRouter)
Phase 2.6: 热重载支持                              (Runtime + client.lua)
```

---

## 附录 A：完整签名流程图

```
开发阶段                       部署阶段                       运行阶段
─────────                     ─────────                     ─────────

plugin.json                   plugin.json                   dist/plugin.json
(无 _lock，源码)              (无 _lock，源码)              (含 _lock，产物)
    │                              │                              │
    │  ┌─── 两种方式 ────┐         │                              │
    │  ▼                 ▼         │                              │
 Vite serve          reui validate │  ┌─── 两种方式 ────┐         │
 (实时校验)          (CLI 校验)    │  ▼                 ▼         │
    │                    │         │ vite build       reui sign   │
    │                    │         │ (自动签名)       (CLI签名)   │
    ▼                    ▼         │  └────────┬────────┘         │
 开发模式直接加载                  │           ▼                  ▼
 (跳过签名验证)                    │   写入 _lock 到         游戏服务端:
                                   │   dist/plugin.json     1. 读取 plugin.json
                                   │   (源码不修改)          2. HMAC 验签(密钥仅在此)
                                   │           │             3. 通过→下发 / 失败→拒绝
                                   │           ▼                  │
                                   │    部署 dist/ 到              ▼
                                   │    服务端 (FiveM)       Runtime (CEF):
                                   │                         1. Zod Schema 校验
                                   │                         2. 配置覆盖 + 过滤
                                   │                         3. 角色/权限检查
                                   │                         4. 创建 iframe 加载
```

---

## 附录 B：插件目录结构

```
workspace/runtime/
├── plugins/                    # 插件根目录（游戏端扫描此目录）
│   ├── hud/
│   │   ├── plugin.json        # 必须
│   │   └── index.html         # 必须
│   ├── inventory/
│   │   ├── plugin.json        # 源码（无 _lock）
│   │   ├── src/
│   │   └── dist/
│   │       ├── index.html     # 构建产物
│   │       └── plugin.json    # 签名后产物（含 _lock）
│   └── admin-panel/
│       ├── plugin.json
│       └── dist/
│           └── plugin.json    # 签名后产物
└── src/
    └── ...
```

---

## 附录 C：CLI 命令速查

| 命令 | 说明 | 需要密钥 |
|------|------|:--------:|
| `reui validate` | Zod Schema 校验 | ❌ |
| `reui sign` | 对所有插件签名（输出到 dist/） | ✅ |
| `reui sign <id>` | 对单个插件签名 | ✅ |
| `reui verify` | 验证签名是否被篡改 | ✅ |
| `reui init <name>` | 创建插件脚手架 | ❌ |
| `reui list` | 列出所有插件及状态 | ❌ |

**典型工作流：**
- **开发时**：Vite 插件实时校验 + devEntry HMR
- **手动操作**：`reui init` 创建插件、`reui validate` 校验
- **部署/CI**：`reui sign` 或 `vite build` 自动签名

---

*本文档为 RFC-002 的完整设计。实现过程中如有技术细节调整，应同步更新本文档。*
