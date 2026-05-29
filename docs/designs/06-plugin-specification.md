# 子插件工程规范与配置设计

## 1. 概述

本文档定义子插件（Plugin）的工程结构规范、plugin.json 配置规范、配置安全机制、Runtime 加载机制、权限系统设计以及热重载支持。

> **权限模型概述：**
> - **角色访问限制 (`roleRestriction`)**：决定用户**能否加载**该插件。
> - **权限 (`permissions`)**：决定插件**能调用哪些 Runtime 模块**与**能访问哪些其他插件**。
>
> 两者完全独立：`permissions` 不会影响插件的加载/卸载。

## 2. 插件目录结构

### 2.1 插件存放位置

游戏端 (Lua) 启动时扫描 `plugins/` 目录，每个子目录视为一个独立插件，将清单通过 NUI 传递给 Runtime：

```
workspace/runtime/
├── plugins/                    # 插件根目录（游戏端扫描此目录）
│   ├── hud/                   # 插件: HUD
│   │   ├── plugin.json        # 插件描述文件（必须）
│   │   ├── index.html         # 入口 HTML（必须）
│   │   └── ...                # 其他资源
│   ├── inventory/             # 插件: 背包
│   │   ├── plugin.json
│   │   ├── index.html
│   │   ├── assets/
│   │   └── ...
│   └── admin-panel/           # 插件: 管理面板
│       ├── plugin.json
│       └── index.html
└── src/
    └── ...
```

### 2.2 插件工程结构（推荐）

使用 `@reui/core` + `@reui/framework` 的 React 插件推荐结构：

```
my-plugin/
├── plugin.json             # 插件描述（必须）
├── index.html              # 入口 HTML（必须，构建产物或手写）
├── src/                    # 源码目录
│   ├── main.tsx            # 应用入口
│   ├── App.tsx
│   └── components/
├── package.json            # 依赖管理
├── vite.config.ts          # 构建配置
└── dist/                   # 构建产物（生产模式下 index.html 在此）
```

非 React 插件（原生 HTML/Vue/其他）只需满足两个必要文件：`plugin.json` + `index.html`。

## 3. plugin.json 配置规范

### 3.1 完整 Schema

```typescript
interface PluginManifest {
  /** 插件唯一标识（必须，用于通讯和管理） */
  id: string;

  /** 插件显示名称 */
  name: string;

  /** 插件版本号（semver） */
  version: string;

  /** ─── 入口配置 ─── */

  /**
   * HTML 入口路径（相对于插件目录）
   * 生产环境使用本地文件
   */
  entry: string;

  /**
   * 开发模式入口（可选）
   * 指向 Vite dev server 等本地地址，支持 HMR
   * 仅在 Runtime 开发模式下生效
   * 必须指向 localhost（localhost / 127.0.0.1 / ::1），防止意外加载远程资源
   */
  devEntry?: string;

  /** ─── 层级与显示 ─── */

  /** 所属显示层级 */
  layer: "hud" | "panel" | "overlay";

  /** 显示尺寸/位置配置 */
  display?: {
    /** 宽度（CSS 值），默认 "100%" */
    width?: string;
    /** 高度（CSS 值），默认 "100%" */
    height?: string;
    /** 位置锚点（仅 panel/overlay 生效） */
    position?: "center" | "left" | "right" | "top" | "bottom";
    /** 模态模式（仅 overlay 层生效）：为 true 时新 Overlay 会先关闭栈内所有现有 Overlay */
    modal?: boolean;
    /** 层内 z-index 偏移（0-99），默认 0 */
    zOffset?: number;
  };

  /** ─── 权限要求 ─── */

  /**
   * 插件运行所需的权限列表（AND 逻辑）。
   *
   * 权限分为两类，命名空间区分：
   *
   * 1. Runtime 模块使用权限 — 控制插件能调用哪些 Runtime API：
   *    - "runtime.all"             所有 Runtime 模块
   *    - "runtime.websocket"       WebSocket 模块
   *    - "runtime.network"         HTTP / 网络模块
   *    - "runtime.message"         插件间消息 / NUI 消息
   *    - "runtime.dialog"          对话框 / Overlay 模块
   *
   * 2. 其他插件的访问权限 — 控制插件能访问哪些其他插件：
   *    - "plugins.all"             访问任意其他插件
   *    - "plugins.<plugin-id>"     仅访问指定插件，例如 "plugins.inventory-ui"
   *      （拥有此权限可调用其方法、向其直接发送消息）
   *
   * 通配符 .* 后缀允许，如 "runtime.*"。
   * Runtime 在每次 API 调用时强制检查；权限不影响插件加载/卸载。
   */
  permissions?: string[];

  /**
   * 角色访问限制（决定能否加载此插件）。
   *
   * - 未设置 / 空数组：任何用户都可以加载。
   * - 非空数组：用户必须至少拥有列表中的一个角色，否则该插件不会被加载。
   *
   * 例如：["police"]、["police", "firerescue"]
   */
  roleRestriction?: string[];

  /** ─── 生命周期 ─── */

  /**
   * 是否默认启用
   * false 表示已安装但不会被加载（可被 Runtime 主配置覆盖）
   */
  enabled?: boolean;

  /** ─── 元信息 ─── */

  /** 默认快捷键绑定（按下后 toggle 显示此插件，最长 32 字符） */
  defaultHotkey?: string;
}
```

### 3.2 最小配置示例

```json
{
  "id": "my-hud",
  "name": "My HUD",
  "version": "1.0.0",
  "entry": "index.html",
  "layer": "hud"
}
```

### 3.3 完整配置示例

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

  "enabled": true,
  "defaultHotkey": "F2"
}
```

### 3.4 管理面板示例（高权限需求 + 角色限制）

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
  "permissions": [
    "runtime.all",
    "plugins.all"
  ],

  "defaultHotkey": "F10"
}
```

## 4. Runtime 插件扫描与加载

### 4.1 插件发现机制

Runtime 运行在 CEF 浏览器环境中，不具备文件系统访问能力。插件发现由**游戏端 (Lua)** 驱动：

1. 游戏端 Server 脚本扫描 `plugins/` 目录
2. 读取每个子目录的 `plugin.json`
3. **服务端验证签名**（生产模式下，密钥仅存于服务端）
4. 将已验证的插件清单通过 Server→Client 事件传递给客户端
5. 客户端通过 NUI 消息传递给 Runtime
6. Runtime 收到后执行 Schema 校验、权限检查和加载

#### 消息流：Server → Client → CEF

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
                                                    │  • 权限检查      │
                                                    │  • priority 排序 │
                                                    │  • 创建 iframe   │
                                                    └─────────────────┘
```

**安全设计原则：**
- 签名密钥 (`reui_sign_key`) 仅配置在 `server.cfg` 中，仅服务端代码可读
- 签名验证在服务端完成，客户端和 CEF 永远不接触密钥
- 客户端和 CEF 信任来自服务端的已验证数据

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

```lua
-- client.lua：接收服务端下发的已验证插件列表，转发给 CEF (Runtime)

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

### 4.2 Runtime 加载流程

```
游戏端 Server 扫描 plugins/ 目录
读取 plugin.json + 签名验证（生产模式）
        │
        │  Server → Client → NUI: reui:plugin-registry
        ▼
┌─────────────────────────────┐
│ 1. 接收插件清单列表          │
│    (从游戏端 NUI 消息获取，  │
│     生产模式已通过服务端验签)│
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 2. Schema 校验（Zod）        │
│    跳过无效/损坏的配置       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 3. 应用 Runtime 主配置覆盖   │
│    (启用/禁用/属性覆盖)      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 4. 过滤 enabled === false   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 5. 角色访问限制检查        │
│    对比 manifest.roleRestriction │
│    与当前用户角色            │
│    不匹配 → 标记为            │
│    "role_denied"                 │
│    不创建 iframe               │
└─────────────┬─────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 6. 逐个创建 iframe 并加载   │
│    （不保证加载顺序，插件   │
│    不应依赖加载顺序）         │
└─────────────────────────────┘
```

> **注意：** 子插件之间相互独立，不存在依赖关系。**加载顺序不保证**，插件不应依赖其他插件的加载顺序；跨插件调用需要在调用点作可用性检查。每个插件可独立加载和卸载，不影响其他插件。
### 4.3 Runtime 主配置覆盖

Runtime 可通过自己的配置文件覆盖插件设置：

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

覆盖优先级：`runtime.config.json` > `plugin.json`

### 4.4 iframe 创建

```typescript
function createPluginIframe(manifest: PluginManifest, basePath: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');

  // 确定入口URL
  const isDevMode = getRuntimeMode() === 'development';
  const baseUrl = isDevMode && manifest.devEntry
    ? manifest.devEntry
    : resolvePluginEntry(basePath, manifest.entry);

  // 追加 ?__reui_id=<pluginId>（SDK 通过此参数自动获取 pluginId）
  const url = new URL(baseUrl, location.href);
  url.searchParams.set('__reui_id', manifest.id);
  iframe.src = url.toString();

  iframe.id = `plugin-${manifest.id}`;
  iframe.dataset.layer = manifest.layer;

  // Sandbox 配置
  // 生产模式仅使用 "allow-scripts"（不含 allow-same-origin 以确保安全隔离）
  // 开发模式追加 allow-same-origin（Vite HMR WebSocket 需要此权限）
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

**pluginId 传递机制：**
- 使用 URL 查询参数 `?__reui_id=<pluginId>` 传递（而非 `data-plugin-id` 属性）
- 原因：iframe 使用 `sandbox="allow-scripts"` 不含 `allow-same-origin` 时，`window.frameElement` 返回 `null`（浏览器安全策略），无法从属性读取
- URL 查询参数在任何 sandbox 配置下都可靠读取

**Sandbox 设计决策：**
- 生产模式仅使用 `allow-scripts`（不包含 `allow-same-origin`）
- 移除 `allow-same-origin` 使 iframe origin 变为唯一的 opaque origin (`null`)
- 这防止了 iframe 内脚本访问父页面或移除自身 sandbox 属性
- **开发模式**追加 `allow-same-origin`：Vite HMR 需要 WebSocket 连接到 dev server，sandbox 不含此权限时无法建立连接
- 消息验证使用 `event.source` 而非 `event.origin`（因为生产模式 origin 始终为 `null`）
- Sandbox 配置由 Runtime 统一控制，插件不能自行声明附加 sandbox token

## 5. 配置安全机制

本节解决三类安全问题：**格式校验**（防止错误配置导致崩溃）、**权限提升防护**（防止插件自行声明高权限）、**运行时防篡改**（防止客户端修改配置文件获取额外功能）。

### 5.1 安全架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      安全防护三层模型                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: Schema 校验                                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Zod Schema 验证 → 格式错误立即拒绝，不影响其他插件        │  │
│  │  （服务端 + Runtime 双重执行）                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 2: 服务端签名验证 (_lock 字段)                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  CLI 对 plugin.json 的安全字段签名 → 嵌入 _lock 字段      │  │
│  │  游戏服务端验证签名 → 仅下发通过验证的插件给客户端         │  │
│  │  密钥仅存于服务端，客户端/CEF 永远不接触密钥              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 3: 运行时强制执行                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PostMessage Router 对每次 API 调用检查 permissions         │  │
│  │  跨插件消息检查 plugins.xxx 权限                           │  │
│  │  即使绕过前两层，运行时依然拦截越权调用                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Layer 1：JSON Schema 格式校验（Zod）

Runtime 和 CLI/Vite 插件使用同一套 Zod Schema 校验 plugin.json。Schema 定义在 `@reui/cli` 中，Runtime 也引用此包进行运行时校验。

```typescript
import { validateManifest } from '@reui/cli';

// 扫描时对每个 plugin.json 执行校验
const result = validateManifest(rawJson);
if (!result.valid) {
  // result.errors: [{ path: "permissions.0", message: "Permission must be dot-separated..." }]
  console.error(`[ReUI] Invalid plugin.json:`, result.errors);
}
```

Zod 提供的校验能力：
- 类型检查（string/number/array/boolean）
- 格式约束（regex、url、min/max length）
- 权限字符串格式验证（点分层级 + 可选通配符后缀）
- 自定义 refine（路径穿越检测、devEntry localhost 限制等）
- 未知字段会被忽略但不报错（前向兼容，允许新版字段通过旧版校验）

详细 Schema 定义见 `workspace/cli/src/schema/plugin-manifest.ts`。

### 5.3 Layer 2：嵌入式签名（_lock 字段）— 防篡改 + 防权限提升

#### 5.3.1 设计思路

核心问题：plugin.json 存放在客户端本地，理论上可以被修改。如果玩家清空 `roleRestriction` 绕过角色限制加载不该看到的插件，或修改 `permissions` 获取额外 Runtime 模块访问怎么办？

**解决方案：对安全字段签名，嵌入 `_lock` 字段**

- CLI 工具 (`@reui/cli`) 在部署前对 plugin.json 中的安全敏感字段计算签名
- 签名结果写入同一文件的 `_lock` 字段
- 游戏服务端生产模式下验证 `_lock` 签名，不通过则拒绝下发
- 篡改者修改了安全字段后签名失效，而没有密钥无法重新生成有效签名

#### 5.3.2 签名后的 plugin.json 格式

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
  "permissions": ["runtime.network", "runtime.message", "plugins.hud"],
  "roleRestriction": [],
  "enabled": true,
  "defaultHotkey": "F2",

  "_lock": {
    "version": 1,
    "signedAt": "2026-05-28T10:00:00Z",
    "algorithm": "hmac-sha256",
    "signature": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
  }
}
```

#### 5.3.3 签名覆盖的字段（安全字段）

签名仅针对安全敏感字段计算，非安全字段修改不影响签名有效性：

| 字段 | 纳入签名 | 理由 |
|------|---------|------|
| `id` | ✅ | 防止冒充其他插件 |
| `version` | ✅ | 防止版本回退攻击 |
| `entry` | ✅ | 防止替换为恶意 HTML |
| `layer` | ✅ | 防止 HUD 伪装为 Overlay 获取模态控制 |
| `permissions` | ✅ | 防止自行添加高权限 Runtime 模块或跨插件访问权限 |
| `roleRestriction` | ✅ | 防止清空角色限制使所有人可加载 |
| `enabled` | ✅ | 防止启用未授权插件 |
| `name` | ❌ | 仅显示用途 |
| `display` | ❌ | 仅影响尺寸位置 |
| `defaultHotkey` | ❌ | 仅影响快捷键 |
| `devEntry` | ❌ | 生产模式下忽略 |

#### 5.3.4 签名算法

```typescript
/**
 * 提取安全字段，规范化为确定性 JSON 字符串，计算 HMAC-SHA256
 */
function signManifest(manifest: PluginManifest, secretKey: string): string {
  // 1. 提取安全字段（按固定顺序）
  const securedPayload = {
    id: manifest.id,
    version: manifest.version,
    entry: manifest.entry,
    layer: manifest.layer,
    permissions: (manifest.permissions ?? []).sort(),
    roleRestriction: (manifest.roleRestriction ?? []).sort(),
    enabled: manifest.enabled ?? true,
  };

  // 2. 确定性序列化（key 已固定顺序，值排序后序列化）
  const payload = JSON.stringify(securedPayload);

  // 3. HMAC-SHA256
  return hmacSha256(payload, secretKey);
}

/**
 * 验证签名
 */
function verifyManifestSignature(manifest: PluginManifest, secretKey: string): boolean {
  if (!manifest._lock?.signature) return false;

  const expectedSig = signManifest(manifest, secretKey);
  return timingSafeEqual(manifest._lock.signature, expectedSig);
}
```

#### 5.3.5 密钥管理

签名密钥用于 CLI/Vite 签名和**服务端**验签，**客户端和 CEF 永远不接触密钥**。

**密钥流转：**

```
┌──────────────────────────────────────────────────────────────────┐
│                     密钥仅存在于两个位置                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 构建/部署环境                    2. 游戏服务端                │
│  ┌───────────────────────┐           ┌──────────────────────┐    │
│  │ 环境变量 REUI_SIGN_KEY │           │ server.cfg convar    │    │
│  │                       │           │ reui_sign_key        │    │
│  │ CLI: reui sign        │           │                      │    │
│  │ Vite: build 时签名    │           │ server.lua 验签      │    │
│  └───────────────────────┘           └──────────────────────┘    │
│                                                                  │
│  ⚠ 客户端 (client.lua) 和 CEF (Runtime) 不使用也不传递密钥       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**配置方式：**

- 部署时：CLI/Vite 通过环境变量 `REUI_SIGN_KEY` 获取密钥进行签名
- 运行时：游戏**服务端**通过 convar `reui_sign_key` 配置相同密钥，在服务端完成验签
- 客户端仅接收已通过验证的插件列表，不接触密钥

```lua
-- server.cfg
set reui_sign_key "your-secret-signing-key-here"
set reui_mode "production"
```

```lua
-- server.lua：在服务端验证签名后，仅将通过的插件下发给客户端
-- signKey 通过 GetConvar 在服务端读取，不传递给客户端

local signKey = GetConvar('reui_sign_key', '')

-- 验签逻辑（在服务端执行）
function verifySignature(manifest, key)
  if not manifest._lock or not manifest._lock.signature then
    return false
  end
  local expected = computeHmacSha256(manifest, key)
  return expected == manifest._lock.signature
end

-- 验证通过后，下发给客户端时不携带 signKey
TriggerClientEvent('reui:client:pluginRegistry', src, {
  plugins = verifiedPlugins,  -- 仅包含验签通过的插件
  mode = reuiMode,            -- 不传递 signKey
})
```

> **安全优势：** 即使玩家修改了客户端文件或注入恶意客户端脚本，也无法获取签名密钥。密钥仅存在于服务端内存中，恶意客户端无法重新签名被篡改的 plugin.json。

#### 5.3.6 Runtime 加载逻辑

由于签名验证已在服务端完成，Runtime 仅需做 Schema 校验即可：

```typescript
class PluginLoader {
  private mode: 'development' | 'production' = 'production';

  init(mode: RuntimeMode): void {
    this.mode = mode;
  }

  async loadPlugin(manifest: PluginManifest): Promise<LoadResult> {
    // ── Schema 校验（开发/生产都执行） ──
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return { status: 'rejected', reason: 'schema_invalid', errors: validation.errors };
    }

    // ── 通过，注册插件 ──
    // 签名验证已由游戏服务端完成（见 server.lua），
    // Runtime 信任来自游戏端的已验证数据
    return { status: 'accepted' };
  }
}
```

> **为什么 Runtime 不再做签名验证？**
>
> 签名验证需要密钥，而密钥不应暴露给客户端（CEF 环境）。将验证前移到服务端后：
> - 密钥永远不离开服务端
> - 客户端无法通过任何方式获取密钥来伪造签名
> - Runtime 收到的数据已经过服务端认证，可以信任

#### 5.3.7 开发模式 vs 生产模式

| 行为 | 开发模式 | 生产模式 |
|------|----------|----------|
| Schema 校验 | ✅ 执行（Runtime） | ✅ 执行（Runtime） |
| _lock 签名验证 | ⏭️ 跳过（服务端） | ✅ 服务端必须通过 |
| 无 _lock 字段 | ✅ 允许加载 | ❌ 服务端拒绝下发 |
| devEntry | ✅ 生效 | ⏭️ 忽略 |
| permissions 强制执行 | ✅ 运行时检查 | ✅ 运行时检查 |
| iframe sandbox | `allow-scripts allow-same-origin` | `allow-scripts` |
| 热重载文件监听 | ✅ 开启 | ❌ 关闭 |

#### 5.3.8 篡改场景分析

| 攻击方式 | 结果 |
|----------|------|
| 客户端清空 `roleRestriction: []` 绕过角色限制 | ❌ 服务端验签失败，不下发 |
| 客户端添加 `permissions: ["runtime.all"]` 获取全权限 | ❌ 服务端验签失败，不下发 |
| 客户端删除 `_lock` 字段 | ❌ 服务端生产模式要求 _lock 必须存在 |
| 复制其他插件的 `_lock` | ❌ 签名基于整体安全字段，id 不匹配 |
| 修改 `name`/`display`/`defaultHotkey` 等非安全字段 | ✅ 允许，不影响签名 |
| 替换 `entry` 指向恶意 HTML | ❌ entry 纳入签名，服务端验签失败 |
| 读取客户端密钥伪造签名 | ❌ 密钥仅存于服务端，客户端不可获取 |
| 注入恶意客户端脚本获取密钥 | ❌ 密钥不经过客户端传输 |
| 拦截服务端→客户端传输篡改数据 | ⚠️ FiveM 内部通讯可信（同进程 IPC） |

### 5.4 Layer 3：运行时强制执行

即使配置层被绕过（如开发模式下），Runtime 的 PostMessage Router 依然在每次 API 调用时做实时强制检查：

```typescript
class PostMessageRouter {
  private pluginPermissions: Map<string, string[]>; // pluginId → granted permissions

  handleRequest(plugin: PluginInstance, message: RequestMessage): void {
    // 1. 提取 method 所需的 permission
    const requiredPermission = this.getRequiredPermission(message.method);

    // 2. 检查插件是否被授予此 permission
    if (requiredPermission) {
      const granted = this.pluginPermissions.get(plugin.id) ?? [];
      if (!this.hasPermission(granted, requiredPermission)) {
        this.sendError(plugin, message.id, {
          code: 'PERMISSION_DENIED',
          message: `Plugin "${plugin.id}" lacks permission "${requiredPermission}"`,
          details: { method: message.method, required: requiredPermission },
        });
        return;
      }
    }

    // 3. 跨插件消息检查
    if (message.method === 'plugin:message') {
      const targetPluginId = message.params.targetPluginId;
      if (!this.canAccessPlugin(plugin.id, targetPluginId)) {
        this.sendError(plugin, message.id, {
          code: 'PERMISSION_DENIED',
          message: `Plugin "${plugin.id}" cannot access plugin "${targetPluginId}"`,
        });
        return;
      }
    }

    // 4. 通过检查，转发到对应 handler
    this.dispatch(plugin, message);
  }

  /**
   * method → permission 映射
   *
   * 权限命名空间：
   * - runtime.network   → HTTP 请求
   * - runtime.websocket → WebSocket 操作
   * - runtime.message   → 插件间消息 / NUI 消息
   * - runtime.dialog    → 对话框 / Overlay 模块
   * - runtime.all       → 匹配所有 runtime.* 权限
   */
  private getRequiredPermission(method: string): string | null {
    const mapping: Record<string, string> = {
      'http:request': 'runtime.network',
      'ws:send': 'runtime.websocket',
      'ws:state': 'runtime.websocket',
      'event:subscribe': 'runtime.message',
      'event:unsubscribe': 'runtime.message',
      'event:emit': 'runtime.message',
      'nui:send': 'runtime.message',
      'plugin:show': null,       // 控制自身，无需额外权限
      'plugin:hide': null,
      'plugin:getConfig': null,
      'plugin:ready': null,
      'plugin:saveState': null,
      'plugin:restoreState': null,
    };
    return mapping[method] ?? null;
  }

  /**
   * 检查权限（支持通配符）
   * "runtime.all" 匹配所有 runtime.* 权限
   * "runtime.*" 匹配所有 runtime.* 权限
   */
  private hasPermission(granted: string[], required: string): boolean {
    if (granted.includes(required)) return true;
    if (granted.includes('runtime.all')) return true;

    // 检查通配符
    const parts = required.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const wildcard = parts.slice(0, i).join('.') + '.*';
      if (granted.includes(wildcard)) return true;
    }
    return false;
  }

  /**
   * 检查插件是否有权访问目标插件
   * 需要 "plugins.all" 或 "plugins.<targetId>" 权限
   */
  private canAccessPlugin(sourceId: string, targetId: string): boolean {
    const granted = this.pluginPermissions.get(sourceId) ?? [];
    return (
      granted.includes('plugins.all') ||
      granted.includes(`plugins.${targetId}`)
    );
  }
}
```

### 5.5 @reui/cli 工具设计

`@reui/cli` 是一个双模式包：既提供独立的 CLI 命令行工具，也导出 Vite 插件供构建集成。内部使用 **Zod** 进行 Schema 校验。

#### 5.5.1 包结构

```
workspace/cli/
├── src/
│   ├── index.ts              # 库入口（导出 Vite 插件 + 核心 API）
│   ├── cli.ts                # CLI 入口（bin 命令）
│   ├── schema/
│   │   ├── plugin-manifest.ts  # Zod Schema 定义（source of truth）
│   │   └── plugin-manifest.d.ts # 纯类型声明（供下游包引用）
│   ├── core/
│   │   ├── validator.ts      # 校验逻辑（基于 Zod）
│   │   ├── signer.ts         # 签名逻辑
│   │   ├── scanner.ts        # 目录扫描
│   │   └── scaffold.ts       # 插件脚手架生成
│   ├── vite-plugin/
│   │   └── index.ts          # Vite 插件实现
│   └── commands/
│       ├── sign.ts
│       ├── verify.ts
│       ├── validate.ts
│       ├── init.ts
│       └── list.ts
├── package.json
└── tsconfig.json
```

#### 5.5.2 package.json

```json
{
  "name": "@reui/cli",
  "version": "1.0.0",
  "bin": {
    "reui": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./vite": {
      "import": "./dist/vite-plugin/index.mjs",
      "require": "./dist/vite-plugin/index.js",
      "types": "./dist/vite-plugin/index.d.ts"
    }
  },
  "dependencies": {
    "zod": "^3.23.0",
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "glob": "^10.0.0"
  },
  "peerDependencies": {
    "vite": "^5.0.0 || ^6.0.0"
  },
  "peerDependenciesMeta": {
    "vite": { "optional": true }
  }
}
```

#### 5.5.3 Zod Schema 定义

Schema 定义位于 `workspace/cli/src/schema/plugin-manifest.ts`，是 plugin.json 校验的 single source of truth。

关键设计要点：
- `PermissionString` 使用 regex `/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/`，支持点分层级 + 可选通配符后缀
- `devEntry` 通过 refine 限制为 localhost 地址
- `SecuredFieldsSchema` 包含 `id`, `version`, `entry`, `layer`, `permissions`, `roleRestriction`, `enabled`
- 不使用 `.strict()`，允许未知字段通过（前向兼容）

详见源码文件：[`workspace/cli/src/schema/plugin-manifest.ts`](../../workspace/cli/src/schema/plugin-manifest.ts)

#### 5.5.4 核心 API（库导出）

```typescript
// src/index.ts — 库入口
export { PluginManifestSchema, SecuredFieldsSchema, extractSecuredFields, normalizeForSigning } from './schema/plugin-manifest';
export type { PluginManifest, SecuredFields, DisplayType, Layer, Display, Lock } from './schema/plugin-manifest';

export { validateManifest, validateManifestFile } from './core/validator';
export { signManifest, verifyManifest } from './core/signer';
export { scanPlugins } from './core/scanner';
export { reui as vitePluginReUI } from './vite-plugin';
```

```typescript
// src/core/signer.ts
import { extractSecuredFields, normalizeForSigning } from '../schema/plugin-manifest';
import { createHmac, timingSafeEqual } from 'crypto';

export interface SignResult {
  signature: string;
  signedAt: string;
}

/**
 * 对 manifest 安全字段签名
 */
export function signManifest(manifest: PluginManifest, secretKey: string): SignResult {
  const secured = extractSecuredFields(manifest);
  const normalized = normalizeForSigning(secured);

  const payload = JSON.stringify(normalized);
  const signature = createHmac('sha256', secretKey).update(payload).digest('hex');
  const signedAt = new Date().toISOString();

  return { signature, signedAt };
}

/**
 * 验证 manifest 签名
 */
export function verifyManifest(manifest: PluginManifest, secretKey: string): boolean {
  if (!manifest._lock?.signature) return false;

  const { signature } = signManifest(manifest, secretKey);
  const expected = Buffer.from(signature, 'hex');
  const actual = Buffer.from(manifest._lock.signature, 'hex');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

#### 5.5.5 Vite 插件

```typescript
// src/vite-plugin/index.ts
import type { Plugin, ResolvedConfig } from 'vite';
import { validateManifest, validateManifestFile } from '../core/validator';
import { signManifest } from '../core/signer';
import { scanPlugins } from '../core/scanner';
import path from 'path';
import fs from 'fs/promises';

export interface ReUIVitePluginOptions {
  /** 插件目录路径（相对于项目根目录），默认 "plugins/" */
  pluginsDir?: string;

  /** 签名密钥（build 时必须提供，serve 时可选） */
  signKey?: string;

  /** 是否在 serve 模式下实时校验 plugin.json，默认 true */
  validateOnServe?: boolean;

  /** 是否在 build 时自动签名，默认 true */
  signOnBuild?: boolean;

  /** 高权限 permissions，build 签名时会输出警告 */
  highPrivilegePermissions?: string[];
}

export function reui(options: ReUIVitePluginOptions = {}): Plugin {
  const {
    pluginsDir = 'plugins/',
    signKey,
    validateOnServe = true,
    signOnBuild = true,
    highPrivilegePermissions = ['runtime.all', 'plugins.all'],
  } = options;

  let config: ResolvedConfig;
  let resolvedPluginsDir: string;

  return {
    name: 'vite-plugin-reui',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      resolvedPluginsDir = path.resolve(config.root, pluginsDir);
    },

    // ── Serve 模式：实时校验 ──
    async configureServer(server) {
      if (!validateOnServe) return;

      // 初始校验
      await validateAllPlugins(resolvedPluginsDir);

      // 监听 plugin.json 变更
      server.watcher.add(path.join(resolvedPluginsDir, '**/plugin.json'));
      server.watcher.on('change', async (filePath) => {
        if (filePath.endsWith('plugin.json')) {
          const result = await validateManifestFile(filePath);
          const pluginName = path.basename(path.dirname(filePath));

          if (!result.valid) {
            server.config.logger.error(
              `[ReUI] ❌ ${pluginName}/plugin.json validation failed:\n` +
              result.errors.map(e => `  • ${e.path}: ${e.message}`).join('\n')
            );
          } else {
            server.config.logger.info(`[ReUI] ✓ ${pluginName}/plugin.json valid`);
          }

          // 通知 Runtime HMR
          server.ws.send({
            type: 'custom',
            event: 'reui:plugin-config-changed',
            data: { pluginId: pluginName, valid: result.valid },
          });
        }
      });
    },

    // ── Build 模式：校验 + 签名 ──
    async buildStart() {
      if (config.command !== 'build') return;

      const plugins = await scanPlugins(resolvedPluginsDir);

      for (const { manifest, filePath } of plugins) {
        // 1. 校验
        const validation = validateManifest(manifest);
        if (!validation.valid) {
          this.error(
            `[ReUI] Plugin "${manifest.id}" validation failed:\n` +
            validation.errors.map(e => `  • ${e.path}: ${e.message}`).join('\n')
          );
          return;
        }

        // 2. 高权限警告
        const highPriv = (manifest.permissions ?? []).filter(p =>
          highPrivilegePermissions.includes(p)
        );
        if (highPriv.length > 0) {
          this.warn(
            `[ReUI] ⚠ Plugin "${manifest.id}" has high-privilege permissions: [${highPriv.join(', ')}]`
          );
        }

        // 3. 签名（写入 dist/ 目录，源文件保持不变）
        if (signOnBuild) {
          if (!signKey) {
            this.error('[ReUI] signKey is required for production build. Set via plugin options or REUI_SIGN_KEY env.');
            return;
          }

          const { signature, signedAt } = signManifest(manifest, signKey);
          const signed = {
            ...manifest,
            _lock: {
              version: 1 as const,
              signedAt,
              algorithm: 'hmac-sha256' as const,
              signature,
            },
          };

          // 写入 dist/ 目录（不修改源码）
          const pluginDir = path.dirname(filePath);
          const distDir = path.join(pluginDir, 'dist');
          await fs.mkdir(distDir, { recursive: true });
          const outputPath = path.join(distDir, 'plugin.json');
          await fs.writeFile(outputPath, JSON.stringify(signed, null, 2), 'utf-8');
          this.info(`[ReUI] ✓ Signed: ${manifest.id} → dist/plugin.json`);
        }
      }
    },
  };
}

async function validateAllPlugins(dir: string): Promise<void> {
  const plugins = await scanPlugins(dir);
  for (const { manifest, filePath } of plugins) {
    const result = validateManifest(manifest);
    if (!result.valid) {
      console.error(`[ReUI] ❌ ${manifest.id}: ${result.errors.map(e => e.message).join(', ')}`);
    }
  }
}
```

#### 5.5.6 Vite 插件使用方式

```typescript
// vite.config.ts (Runtime 项目)
import { defineConfig } from 'vite';
import { reui } from '@reui/cli/vite';

export default defineConfig({
  plugins: [
    reui({
      pluginsDir: 'plugins/',
      signKey: process.env.REUI_SIGN_KEY,     // 从环境变量读取
      validateOnServe: true,                   // 开发时实时校验
      signOnBuild: true,                       // 构建时自动签名
      highPrivilegePermissions: ['runtime.all', 'plugins.all'],
    }),
  ],
});
```

**开发模式下的行为：**
```
$ pnpm dev

  [ReUI] ✓ hud/plugin.json valid
  [ReUI] ✓ inventory/plugin.json valid
  [ReUI] ✓ admin-panel/plugin.json valid

  VITE v6.x  ready in 320ms

  ... 修改 inventory/plugin.json ...

  [ReUI] ✓ inventory/plugin.json valid        ← 实时反馈
  [HMR] reui:plugin-config-changed            ← 通知 Runtime 热重载配置
```

**构建模式下的行为：**
```
$ REUI_SIGN_KEY=secret pnpm build

  [ReUI] ✓ Signed: hud → dist/plugin.json
  [ReUI] ✓ Signed: inventory → dist/plugin.json
  [ReUI] ⚠ Plugin "admin-panel" has high-privilege permissions: [runtime.all, plugins.all]
  [ReUI] ✓ Signed: admin-panel → dist/plugin.json

  ✓ built in 1.2s
```

> **注意：** 签名后的 `plugin.json`（含 `_lock` 字段）写入各插件的 `dist/` 目录，源码中的 `plugin.json` 保持无签名状态。部署时应使用 `dist/plugin.json`。

#### 5.5.7 CLI 命令（独立使用）

安装：

```bash
npm install -g @reui/cli
# 或项目内
pnpm add -D @reui/cli
```

命令列表：

| 命令 | 说明 |
|------|------|
| `reui sign` | 对所有插件的 plugin.json 签名（写入 _lock） |
| `reui sign <pluginId>` | 对单个插件签名 |
| `reui verify` | 验证所有插件签名是否有效 |
| `reui validate` | 仅做 Zod Schema 校验（不需要密钥） |
| `reui init <name>` | 创建新插件脚手架 |
| `reui list` | 列出所有已扫描到的插件及其状态 |

#### 5.5.8 reui sign

```bash
# 对所有插件签名（输出到 dist/plugin.json，交互式确认高权限插件和 allow-same-origin）
reui sign --key <secret>

# 通过环境变量传递密钥（推荐，CI/CD 场景）
REUI_SIGN_KEY=mysecret reui sign

# 非交互模式（CI/CD）
reui sign --key <secret> --yes

# 对单个插件签名
reui sign inventory --key <secret>

# 指定输出目录（默认为各插件的 dist/）
reui sign --key <secret> --outDir dist/
```

**输出示例：**
```
[ReUI] Scanning plugins/ ...
  ✓ hud (v1.0.0)
      permissions: []
      roleRestriction: []
      → signed → dist/plugin.json ✓

  ✓ inventory (v2.1.0)
      permissions: [runtime.network, runtime.message, plugins.hud]
      roleRestriction: []
      → signed → dist/plugin.json ✓

  ⚠ admin-panel (v1.0.0)
      permissions: [runtime.all, plugins.all]
      roleRestriction: [admin]
      ⚠ HIGH PRIVILEGE: runtime.all, plugins.all
      Confirm signing? (Y/n) y
      → signed → dist/plugin.json ✓

[ReUI] 3 plugins signed successfully (output: dist/plugin.json).
```

#### 5.5.9 reui validate

无需密钥，使用 Zod Schema 做格式校验（CLI 校验可选启用 strict 模式检查未知字段，运行时不使用 strict）：

```bash
reui validate

# 输出
[ReUI] Validating plugins...
  ✓ hud - valid
  ✓ inventory - valid
  ✗ broken-plugin - INVALID
      • entry: Path traversal (..) not allowed
      • permissions.0: Permission must be dot-separated lowercase
      • version: Must be semver format
  ✓ admin-panel - valid

[ReUI] 3/4 plugins valid. 1 error(s).
```

#### 5.5.10 reui verify

验证已签名的 plugin.json 是否被篡改：

```bash
reui verify --key <secret>

# 输出
[ReUI] Verifying plugin signatures...
  ✓ hud - signature valid
  ✓ inventory - signature valid
  ✗ admin-panel - SIGNATURE MISMATCH
      The file has been modified after signing.
      Modified fields detected: permissions (added "plugins.all")
      Run `reui sign admin-panel` to re-sign.

[ReUI] 2/3 plugins verified. 1 tampered.
```

#### 5.5.11 reui init

快速创建新插件项目：

```bash
reui init my-shop --layer panel --template react

# 输出
[ReUI] Creating plugin: my-shop
  → plugins/my-shop/plugin.json
  → plugins/my-shop/index.html
  → plugins/my-shop/src/main.tsx
  → plugins/my-shop/src/App.tsx
  → plugins/my-shop/package.json
  → plugins/my-shop/vite.config.ts
  → plugins/my-shop/tsconfig.json

[ReUI] Done! Next steps:
  cd plugins/my-shop
  pnpm install
  pnpm dev
```

#### 5.5.12 CLI 配置文件

CLI 和 Vite 插件共享项目根目录的 `reui.config.json`：

```json
{
  "pluginsDir": "plugins/",
  "sign": {
    "keyEnv": "REUI_SIGN_KEY",
    "confirmHighPrivilege": true,
    "highPrivilegePermissions": ["runtime.all", "plugins.all"]
  },
  "validate": {
    "strictMode": true
  },
  "templates": {
    "default": "react"
  }
}
```

#### 5.5.13 CLI vs Vite 插件对比

| 功能 | CLI (`reui xxx`) | Vite 插件 (`vitePluginReUI()`) |
|------|-----------------|-------------------------------|
| Schema 校验 | `reui validate` | serve 时实时校验 + build 时批量校验 |
| 签名 | `reui sign` | build 时自动签名 |
| 验证签名 | `reui verify` | — (运行时由 Runtime 验证) |
| 创建插件 | `reui init` | — (手动创建或用 CLI) |
| 列出插件 | `reui list` | — |
| HMR 联动 | — | ✅ plugin.json 变更通知 Runtime |
| CI/CD | ✅ 适合 | ✅ 集成到 vite build |
| 需要 Vite | ❌ 不需要 | ✅ 需要 |

**典型工作流：**
- **开发时**：Vite 插件实时校验，改了 plugin.json 立即看到错误
- **手动操作**：CLI 创建插件 (`reui init`)、独立校验 (`reui validate`)
- **部署/CI**：CLI 签名 (`reui sign`) 或 Vite build 自动签名

### 5.6 完整签名流程图

```
开发阶段                       部署阶段                       运行阶段
─────────                     ─────────                     ─────────

plugin.json                   plugin.json                   dist/plugin.json
(无 _lock，源码)              (无 _lock，源码)              (含 _lock，产物)
    │                              │                              │
    │  ┌─── 两种方式 ────┐         │                              │
    │  │                 │         │                              │
    │  ▼                 ▼         │                              │
 Vite serve          reui validate │  ┌─── 两种方式 ────┐         │
 (实时校验)          (CLI 校验)    │  │                 │         │
    │                    │         │  ▼                 ▼         │
    │                    │         │ vite build       reui sign   │  游戏服务端启动
    │                    │         │ (自动签名)       (CLI签名)   │
    │                    │         │  │                 │         │
    │                    │         │  └────────┬────────┘         │
    ▼                    ▼         │           │                  ▼
 开发模式直接加载                  │           ▼             ┌─────────────────┐
 (跳过签名验证)                    │   写入 _lock 到        │ 服务端 (Lua):    │
                                   │   dist/plugin.json    │ 1. 读取 plugin   │
                                   │   (源码不修改)         │ 2. HMAC 验签     │
                                   │           │            │    (密钥仅在此)  │
                                   │           ▼            │ 3. 通过→下发     │
                                   │    部署 dist/ 到       │    失败→拒绝     │
                                   │   服务端 (FiveM)      └────────┬────────┘
                                   │   (仅部署 dist/ 产物)          │
                                   │                                ▼
                                   │                        ┌─────────────────┐
                                   │                        │ Runtime (CEF):   │
                                   │                        │ 1. Zod Schema    │
                                   │                        │    校验          │
                                   │                        │ 2. 权限检查      │
                                   │                        │ 3. 加载插件      │
                                   │                        └─────────────────┘
```

## 6. 角色与权限系统

### 6.1 双层模型

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: 角色访问限制（roleRestriction）              │
│  决定插件能否被加载                                    │
│                                                      │
│  用户角色: ["police"]                                 │
│                                                      │
│  hud         → roleRestriction: []          ✅ 加载  │
│  inventory   → roleRestriction: []          ✅ 加载  │
│  police-mdt  → roleRestriction: ["police"]  ✅ 加载  │
│  admin-panel → roleRestriction: ["admin"]   ❌ 不加载│
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Layer 2: 权限（permissions）                         │
│  决定已加载插件能调用什么                              │
│  运行时每次 API 调用时检查，不影响加载/卸载            │
│                                                      │
│  inventory   → permissions: ["runtime.network"]      │
│               → 可调用 HTTP 模块 ✅                   │
│               → 调用 WebSocket 模块 ❌ PERMISSION_DENIED│
└──────────────────────────────────────────────────────┘
```

### 6.2 权限格式

采用点分层级命名，分两大命名空间：

```
─── Runtime 模块权限 ───
runtime.all              # 所有 Runtime 模块
runtime.network          # HTTP 请求
runtime.websocket        # WebSocket
runtime.message          # 插件间消息 / NUI 消息
runtime.dialog           # 对话框 / Overlay

─── 跨插件访问权限 ───
plugins.all              # 访问任意其他插件
plugins.<plugin-id>      # 仅访问指定插件（如 plugins.inventory-ui）
```

### 6.3 角色限制检查逻辑

```typescript
/**
 * 检查用户角色是否满足插件的 roleRestriction
 * 决定插件能否被加载
 */
function checkRoleAccess(manifest: PluginManifest, userRoles: string[]): boolean {
  // 无角色限制 → 任何人可加载
  if (!manifest.roleRestriction?.length) {
    return true;
  }

  // 用户至少拥有一个匹配的角色（OR 逻辑）
  return manifest.roleRestriction.some(role => userRoles.includes(role));
}
```

### 6.4 角色来源

用户角色从游戏端 (Lua) 通过 NUI 传递到 Runtime：

```
游戏端(Lua)                        Runtime
    │                                 │
    │  SendNUIMessage({               │
    │    type: "auth:setRoles",       │
    │    payload: {                   │
    │      roles: ["police"],         │
    │      user: { ... }             │
    │    }                            │
    │  })                             │
    │─────────────────────────────→   │
    │                                 │  更新 AuthService
    │                                 │  触发角色重评估
    │                                 │  加载/卸载受影响插件
```

```typescript
// Runtime 侧处理
nuiBridge.onGameEvent('auth:setRoles', (data) => {
  const { roles, user } = data;
  authService.updateRoles(roles);
  authService.updateUser(user);

  // 触发角色重评估（仅影响加载/卸载）
  pluginManager.reevaluateRoles();
});
```

### 6.5 角色变更时的行为

```typescript
class PluginManager {
  /**
   * 角色变更后重新评估所有插件的加载状态
   * 仅 roleRestriction 影响加载/卸载
   */
  reevaluateRoles(): void {
    const userRoles = authService.getRoles();

    for (const [id, manifest] of this.registeredPlugins) {
      const allowed = checkRoleAccess(manifest, userRoles);
      const instance = this.activePlugins.get(id);

      if (allowed && !instance) {
        // 新获得角色 → 加载插件
        this.loadPlugin(manifest);
      } else if (!allowed && instance) {
        // 失去角色 → 卸载插件
        this.unloadPlugin(id, 'role_revoked');
      }
    }
  }
}
```

## 7. 热重载设计

### 7.1 开发时热重载（HMR）

利用 `devEntry` 指向 Vite dev server，iframe 内部自动获得 HMR 能力：

```json
{
  "entry": "dist/index.html",
  "devEntry": "http://localhost:3001"
}
```

- 开发时 iframe.src = devEntry → Vite HMR 自动工作
- 修改代码后 iframe 内页面局部更新，无需重建 iframe

### 7.2 插件热重载

Runtime 支持在不重启的情况下重新加载单个插件：

```typescript
class PluginManager {
  /**
   * 热重载插件
   * 销毁旧 iframe → 清理状态 → 创建新 iframe → 重新握手
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    const manifest = this.registeredPlugins.get(pluginId);
    if (!manifest) throw new Error(`Plugin not found: ${pluginId}`);

    // 1. 通知插件即将卸载（让插件保存状态）
    const instance = this.activePlugins.get(pluginId);
    if (instance) {
      instance.postMessage({
        type: 'reui:push',
        event: 'plugin:beforeUnload',
        payload: { reason: 'reload' },
      });

      // 等待插件响应（最多 5s）
      await this.waitForPluginAck(pluginId, 'unload-ready', 5000).catch(() => {});
    }

    // 2. 销毁旧实例
    await this.destroyPluginInstance(pluginId);

    // 3. 通过 NUI 请求游戏端重新读取 plugin.json
    // Runtime 无法直接访问文件系统，需通过游戏端代理
    const freshManifest = await this.requestManifestFromGame(pluginId);
    if (freshManifest) {
      this.registeredPlugins.set(pluginId, freshManifest);
    }

    // 4. 角色检查
    const targetManifest = freshManifest ?? manifest;
    if (!checkRoleAccess(targetManifest, authService.getRoles())) {
      console.warn(`[ReUI] Plugin ${pluginId} reload blocked: role restriction not met`);
      return;
    }

    // 5. 创建新实例
    await this.loadPlugin(targetManifest);
  }

  /**
   * 请求游戏端重新读取指定插件的 plugin.json
   * 通过 NUI Callback 与游戏端 Lua 交互
   */
  private async requestManifestFromGame(pluginId: string): Promise<PluginManifest | null> {
    try {
      const result = await nuiBridge.sendToGame('reui:readManifest', { pluginId });
      return result as PluginManifest;
    } catch {
      console.warn(`[ReUI] Failed to re-read manifest for ${pluginId}, using cached version`);
      return null;
    }
  }

  /**
   * 重载所有插件（全量刷新）
   */
  async reloadAll(): Promise<void> {
    const pluginIds = [...this.activePlugins.keys()];
    for (const id of pluginIds) {
      await this.reloadPlugin(id);
    }
  }

  /**
   * 重新扫描插件目录（发现新插件/移除已删除插件）
   * 开发模式：通过 NUI Callback 请求客户端 Lua 直接扫描
   * 生产模式：通过 NUI Callback 请求客户端发起服务端验签流程
   */
  async rescanPlugins(): Promise<void> {
    let freshPlugins: Array<{ manifest: PluginManifest }>;

    if (this.mode === 'development') {
      // 开发模式：客户端直接扫描（跳过签名）
      const result = await nuiBridge.sendToGame('reui:rescanPlugins', {});
      freshPlugins = (result as any).plugins;
    } else {
      // 生产模式：请求服务端重新扫描并验签，通过客户端中转返回
      // 客户端发 TriggerServerEvent → 服务端验签 → TriggerClientEvent 回传
      const result = await nuiBridge.sendToGame('reui:rescanPluginsSecure', {});
      freshPlugins = (result as any).plugins;
    }

    const freshManifests = new Map<string, PluginManifest>();
    for (const { manifest } of freshPlugins) {
      freshManifests.set(manifest.id, manifest);
    }

    // 发现新增插件
    for (const [id, manifest] of freshManifests) {
      if (!this.registeredPlugins.has(id)) {
        this.registeredPlugins.set(id, manifest);
        const allowed = checkRoleAccess(manifest, authService.getRoles());
        if (allowed && manifest.enabled !== false) {
          await this.loadPlugin(manifest);
        }
      }
    }

    // 发现移除的插件
    for (const [id] of this.registeredPlugins) {
      if (!freshManifests.has(id)) {
        await this.unloadPlugin(id, 'removed');
        this.registeredPlugins.delete(id);
      }
    }
  }
}
```

### 7.3 热重载触发方式

| 触发方式 | 场景 |
|----------|------|
| 游戏端命令 | `/reui reload <pluginId>` 从Lua发NUI消息 |
| 开发快捷键 | Runtime 开发模式下按 `Ctrl+Shift+R` |
| API 调用 | 管理面板插件通过 `plugins.<pluginId>` 权限触发 |
| 文件监听 | 开发模式下监听 plugin.json 变更自动重载 |

### 7.3.1 游戏端 NUI Callback 支持

Runtime 热重载需要游戏端提供以下 NUI Callback 接口（客户端 Lua 处理）：

```lua
-- client.lua：NUI Callback 接口

-- 重新读取单个插件的 plugin.json（开发模式使用）
RegisterNUICallback('reui:readManifest', function(data, cb)
  local pluginId = data.pluginId
  local manifestPath = 'plugins/' .. pluginId .. '/plugin.json'

  if fileExists(manifestPath) then
    local raw = readFile(manifestPath)
    local manifest = json.decode(raw)
    cb(manifest)
  else
    cb(nil)
  end
end)

-- 重新扫描 plugins/ 目录（开发模式使用）
-- 生产模式下应通过服务端验证后再下发
RegisterNUICallback('reui:rescanPlugins', function(data, cb)
  local plugins = {}
  local pluginDirs = scanDirectory('plugins/')

  for _, dir in ipairs(pluginDirs) do
    local manifestPath = dir .. '/plugin.json'
    if fileExists(manifestPath) then
      local raw = readFile(manifestPath)
      local manifest = json.decode(raw)
      if manifest then
        table.insert(plugins, { manifest = manifest, basePath = dir })
      end
    end
  end

  cb({ plugins = plugins })
end)
```

> **注意：** 上述 NUI Callback 仅在开发模式下使用（跳过签名验证）。生产模式下的热重载应通过服务端命令触发，由服务端重新验签后下发更新。

### 7.4 热重载时的状态保持

插件可以利用 `plugin.onBeforeUnload` 回调保存状态：

```typescript
// 子页面侧（使用 @reui/core）
import { plugin } from '@reui/core';

// 监听即将卸载通知（使用 plugin 模块的专用 API）
plugin.onBeforeUnload(async (reason) => {
  if (reason === 'reload') {
    // 保存状态到 Runtime 临时存储
    await plugin.saveState({ scrollPosition: 100, selectedTab: 'weapons' });
  }
});

// 插件启动时恢复状态
const savedState = await plugin.restoreState();
if (savedState) {
  applyState(savedState);
}
```

> **注意：** Runtime 在发送 `plugin:beforeUnload` 后等待最多 **5 秒**。插件应在此时间内完成状态保存。超时后 Runtime 会强制继续卸载流程。

## 8. 插件状态机

### 8.1 状态定义

```typescript
type PluginState = 'loading' | 'ready' | 'active' | 'hidden' | 'error';
```

| 状态 | 说明 |
|------|------|
| `loading` | iframe 已创建，等待握手完成 |
| `ready` | 握手成功，初始不可见状态 |
| `active` | 可见且接收交互 |
| `hidden` | 不可见（仍在 DOM 中，保持连接） |
| `error` | 加载失败/握手超时/心跳超时 |

### 8.2 状态转换图

```
                          ┌──────────────────┐
                          │   (未注册/未加载) │
                          └────────┬─────────┘
                                   │ 权限检查通过 + enabled
                                   │ + 创建 iframe
                                   ▼
                          ┌──────────────────┐
                 ┌───────→│    loading       │←──────────┐
                 │        │  (iframe创建中)   │           │
                 │        └────────┬─────────┘           │
                 │                 │ 握手成功              │
                 │                 ▼                      │
                 │        ┌──────────────────┐           │
                 │        │     ready        │           │
                 │        │  (已就绪,初始态)  │           │
                 │        └────────┬─────────┘           │
                 │                 │                      │
                 │          ┌──────┴──────┐              │
                 │          ▼             ▼              │
                 │   ┌─────────────┐ ┌──────────┐       │
                 │   │   active    │ │  hidden  │       │
                 │   │  (用户可见)  │ │(不可见)  │       │
                 │   └──────┬──────┘ └────┬─────┘       │
                 │          │             │             │
                 │          └──────┬──────┘             │
                 │                 │                     │
                 │                 │ 热重载              │
                 │                 │ (销毁旧iframe      │
                 │                 │  → 重新加载)        │
                 │                 └─────────────────────┘
                 │
                 │        ┌──────────────────┐
                 │        │     error        │
                 │        │(加载失败/握手超时/ │
                 │        │ 心跳超时)         │
                 │        └────────┬─────────┘
                 │                 │
                 │                 │ 手动重载 (reloadPlugin)
                 └─────────────────┘
```

**状态转换规则：**
- `loading` → `ready`：握手成功
- `loading` → `error`：握手超时（5s）或 iframe 加载失败
- `ready` → `active`：首次显示（如 HUD 层自动激活）
- `ready` → `hidden`：初始不显示（如 Panel 层等待用户触发）
- `active` ↔ `hidden`：用户交互触发显示/隐藏
- `active/hidden` → `loading`：热重载（销毁旧实例，重新创建）
- `active/hidden` → `error`：心跳超时（连续 3 次无响应）
- `error` → `loading`：手动重载

**error 状态说明：**
- 插件进入 `error` 状态的原因：iframe 加载失败、握手超时、心跳超时（崩溃检测）
- `error` 状态的插件不会被自动恢复（避免无限重试循环）
- 恢复方式为**手动重载**：通过游戏端命令 (`/reui reload <pluginId>`)、开发快捷键、或管理面板触发
- 手动重载时回到 `loading` → `ready` → ... 正常流程

## 9. 错误处理

### 9.1 plugin.json 校验失败

```typescript
// 扫描时校验
const errors = validateManifest(rawJson);
if (errors.length > 0) {
  console.error(`[ReUI] Invalid plugin.json in ${dirName}:`, errors);
  // 跳过此插件，不影响其他插件加载
  continue;
}
```

### 9.2 iframe 加载失败

```typescript
iframe.onerror = () => {
  plugin.state = 'error';
  console.error(`[ReUI] Failed to load plugin: ${manifest.id}`);
};

// 握手超时（5s 内未收到握手）
setTimeout(() => {
  if (plugin.state === 'loading') {
    plugin.state = 'error';
    console.warn(`[ReUI] Plugin ${manifest.id} handshake timeout`);
  }
}, 5000);
```

### 9.3 心跳超时（插件崩溃）

```typescript
// 由 HeartbeatMonitor 检测（见 02-runtime-design.md §9）
// 连续 3 次 ping 无响应 → 标记为 error
// 崩溃的 iframe 不影响其他插件（独立监控）
plugin.state = 'error';
EventBus.emit('plugin:crashed', { pluginId: plugin.id });
```

### 9.4 手动重载恢复

进入 `error` 状态的插件不会自动恢复（避免无限重试循环）。恢复方式：

```typescript
// 方式1：游戏端命令
// /reui reload <pluginId>

// 方式2：管理面板插件调用（需要 "plugins.<pluginId>" 权限）
await client.request('plugin:reload', { pluginId: 'crashed-plugin' });

// 方式3：开发模式快捷键（全量重载）
// Ctrl+Shift+R
```

重载时销毁旧的 error iframe，重新走 `registered → loading → ready` 流程。

### 9.5 角色限制不满足的用户体验

角色限制不满足时，插件不创建 iframe，但可以在 Plugin Manager 中保留记录：

```typescript
/**
 * PluginRecord — Plugin Manager 的注册表记录（管理视角）
 * 包括所有已注册的插件，无论是否被加载。
 *
 * 注意：这与 PluginInstance.state ('loading'|'ready'|'active'|'hidden'|'error')
 * 是不同的概念：
 * - PluginInstance.state 描述已加载 iframe 的运行时状态
 * - PluginRecord.state 描述插件在注册表中的管理状态（可能没有 iframe）
 */
interface PluginRecord {
  id: string;
  manifest: PluginManifest;
  state: 'active' | 'role_denied' | 'disabled' | 'error';
  instance?: PluginInstance;          // 仅 state === 'active' 时存在
  deniedReason?: string;              // state === 'role_denied' 时记录
}
```

## 10. 示例：完整插件工程

### 10.1 plugin.json

```json
{
  "id": "player-phone",
  "name": "Phone",
  "version": "1.2.0",
  "entry": "dist/index.html",
  "devEntry": "http://localhost:3002",
  "layer": "panel",
  "display": {
    "width": "340px",
    "height": "620px",
    "position": "right"
  },
  "permissions": [
    "runtime.network",
    "runtime.websocket",
    "runtime.message"
  ],
  "enabled": true,
  "defaultHotkey": "F1"
}
```

### 10.2 index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Phone</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.tsx"></script>
</body>
</html>
```

### 10.3 main.tsx

```tsx
import { init, event, nui } from '@reui/core';
import { ThemeProvider } from '@reui/framework';
import { App } from './App';
import { createRoot } from 'react-dom/client';

async function bootstrap() {
  // 初始化 SDK（pluginId 自动从 URL ?__reui_id= 获取）
  await init();

  // 监听游戏事件
  nui.onGameEvent('phone:incoming-call', (data) => {
    // handle incoming call
  });

  // 渲染应用
  createRoot(document.getElementById('root')!).render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

bootstrap();
```
