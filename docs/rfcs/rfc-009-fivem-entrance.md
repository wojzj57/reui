# RFC-009: fivem-entrance — Runtime 的 FiveM 资源宿主

| 字段 | 值 |
|------|---|
| **状态** | Draft |
| **作者** | ReUI Team |
| **创建日期** | 2026-06-16 |
| **依赖** | RFC-001（通讯协议）、RFC-002（插件系统）、RFC-003（Runtime 服务）、RFC-005（CLI / 构建） |
| **被依赖** | 无（交付层，系统的最外层可部署制品） |

---

## 1. 背景与动机

现状：`workspace/runtime`（`@reui/runtime`）是一个**纯 TypeScript 逻辑库**——只有 `src/*.ts` 服务类（`EventBus`、`NuiBridge`、`PluginManager`、`MessageDispatcher`、`LayerSystem` 等）与 Vitest 测试，`package.json` 的入口直接指向 `./src/index.ts`。它**不是**一个可被 FiveM 加载的资源：

- 没有 `fxmanifest.lua`
- 没有宿主 `index.html`（Runtime 主页）
- 没有 Vite 构建产物
- 没有 `client.lua` / `server.lua` 把 NUI 接进游戏

也就是说，RFC-001 §3.4 描述的 `NuiBridge` 双向链路（游戏 `SendNUIMessage('reui:init')` → `NuiBridge.handleGameMessage` → 反向 `sendToGame` 走 `RegisterNUICallback`）目前**只有 CEF 一侧的代码，缺少游戏一侧的 Lua 与可部署外壳**。

本 RFC 定义一个新模块 **`fivem-entrance`**：把 `@reui/runtime` 装进一个真正的、可被 `ensure` / `start` 的 FiveM 资源，提供 NUI 宿主页面、Lua 客户端/服务端脚本与构建产物，闭合「游戏 ↔ Runtime」链路。

### 1.1 为什么是新包，而不是改 runtime 或另开仓库

| 方案 | 结论 | 理由 |
|------|------|------|
| 改 `workspace/runtime` | ❌ 否决 | runtime 是框架无关、可单测、可发布的核心逻辑库。塞入 `fxmanifest.lua` / Lua / HTML 会让「逻辑库」与「可部署制品」两个职责耦合，污染其干净的测试边界与发布形态 |
| 新建独立 git 仓库 | ❌ 否决 | 宿主强依赖 `@reui/runtime` / `@reui/core` / `@reui/cli`（plugin.json 校验/签名）与 `PluginManager` 加载流程；拆仓库会引入版本同步地狱，且本 monorepo 已用 pnpm workspaces 管好互联 |
| **在 monorepo 内新建宿主包** | ✅ 采纳 | 以 `workspace:*` 消费 runtime，产出真正的 FiveM 资源；职责清晰、版本同源、构建统一 |

---

## 2. 目标与非目标

### 2.1 目标

- 定义新包 `fivem-entrance` 的目录结构、`package.json`、构建脚本与产物布局
- 提供 NUI 宿主页面（Runtime 主页）：`index.html` + bootstrap，负责实例化 RFC-003 全部单例服务并挂载 `MessageDispatcher`
- 提供 `fxmanifest.lua`：声明 `ui_page`、`files`、`client_script`、`server_script`
- 提供 `client.lua`：启动时发送 `reui:init` 握手、桥接 `RegisterNUICallback`、管理 `SetNUIFocus`
- 提供 `server.lua`：插件清单扫描/下发的占位与扩展点（与 RFC-002 注册流程对接）
- 定义 Game ↔ Runtime 的完整消息契约（与 RFC-001 §3.4 严格对齐）
- 定义 dev / build / 部署三种工作流

### 2.2 非目标

- 不重新定义 postMessage 协议（属 RFC-001）
- 不实现 `PluginManager` / `LayerSystem` / 各单例服务本身（属 RFC-002/003，本包仅**组装与宿主化**）
- 不实现 `@reui/core` 子页面 SDK（属 RFC-001）
- 不实现具体业务插件（属 `samples/` 与各插件作者）
- 不定义签名算法细节（属 RFC-002/005，本包仅在加载前调用校验）

---

## 3. 命名与定位

- **包名**：`@reui/fivem-entrance`
- **资源名（FiveM resource）**：`fivem-entrance`（即 `GetCurrentResourceName()` 返回值，CEF host 为 `cfx-nui-fivem-entrance`）
- **角色**：系统最外层可部署制品。它是「**入口（entrance）**」——游戏进入 ReUI 世界的唯一门户，承载 Runtime 宿主页面与所有子插件 iframe。

> 资源名一旦确定即作为 `NuiBridge.resourceName` 的来源（见 §6.2），改名需同步 `client.lua` 与所有引用 `cfx-nui-fivem-entrance` 的资源路径。

---

## 4. 目录结构

```
workspace/fivem-entrance/
├── package.json              @reui/fivem-entrance —— 依赖 @reui/runtime / @reui/core (workspace:*)
├── tsconfig.json
├── vite.config.ts            构建 web/ 为 dist/，base 用相对路径（CEF 要求）
├── fxmanifest.lua            FiveM 资源清单
├── web/                      NUI 宿主页面源码（Vanilla TS，与 runtime 一致）
│   ├── index.html            Runtime 主页（挂载点）
│   ├── main.ts               bootstrap：实例化服务 + 挂 MessageDispatcher
│   └── style.css             host 基础样式（全屏、透明、Layer 容器）
├── client/
│   └── client.lua            reui:init 握手 + NUI callback 桥接 + SetNUIFocus
├── server/
│   └── server.lua            插件清单扫描/下发占位（对接 RFC-002）
└── dist/                     构建产物（fxmanifest 的 ui_page 指向此处；gitignore）
    ├── index.html
    └── assets/*
```

新增 workspace glob 已被 `pnpm-workspace.yaml` 的 `workspace/*` 覆盖，无需改动。

---

## 5. 构建与产物

### 5.1 Vite 配置要点

CEF 通过 `https://cfx-nui-fivem-entrance/dist/index.html` 加载页面，资源引用必须是相对路径或 `cfx-nui-` 绝对路径，故：

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',                 // ← 关键：CEF 下相对路径，避免 / 根路径 404
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,     // 不内联，保持文件可被 files{} 收录
    target: 'chrome93',       // CEF Chromium 基线
  },
});
```

### 5.2 package.json scripts

```jsonc
{
  "name": "@reui/fivem-entrance",
  "private": true,
  "scripts": {
    "dev": "vite",                      // 浏览器调试（mock 模式）
    "build": "vite build",              // 产出 dist/
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@reui/runtime": "workspace:*",
    "@reui/core": "workspace:*",
    "@reui/cli": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vite": "^5.4.0"
  }
}
```

### 5.3 部署

构建后将整个 `workspace/fivem-entrance/`（含 `dist/`、`fxmanifest.lua`、`client/`、`server/`）作为资源目录放入 FiveM server 的 `resources/`，`ensure fivem-entrance` 即可。亦可由 `@reui/cli` 提供打包命令（RFC-005 扩展点）。

---

## 6. NUI 宿主页面（Runtime 主页）

### 6.1 index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ReUI Runtime</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <!-- Layer 容器：HUD / Panel / Overlay / System，由 LayerSystem 管理 z-index 与可见性 -->
  <div id="reui-root"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

`style.css` 要点：`html,body{margin:0;width:100vw;height:100vh;overflow:hidden;background:transparent}`——背景必须透明，让游戏画面透出；各 Layer 为绝对定位的全屏容器。

### 6.2 main.ts bootstrap

宿主页面的唯一职责是**组装**：实例化 RFC-003 单例服务、构造 `MessageDispatcher`（RFC-001 §3.2 的唯一 `message` 监听入口）、把 `NuiBridge` / `PostMessageRouter` / `PluginManager` 注入其中，然后等待游戏端 `reui:init`。

```ts
import {
  EventBus, NuiBridge, PluginManager, MessageDispatcher,
  PostMessageRouter, LayerSystem, AuthService, HttpClient, WebSocketManager,
} from '@reui/runtime';

// 1. 单例服务
const eventBus = EventBus.getInstance();
const nuiBridge = NuiBridge.getInstance();           // spec 模式（默认）
const layerSystem = new LayerSystem({ root: document.getElementById('reui-root')! });
const pluginManager = new PluginManager(/* validator, storage … */);
const router = new PostMessageRouter(/* deps … */);

// 2. 唯一 message 入口（RFC-001 §3.2）
new MessageDispatcher({ nuiBridge, postMessageRouter: router, pluginManager });

// 3. dev 浏览器调试时切 mock，避免依赖游戏环境
if (import.meta.env.DEV) nuiBridge.setMode('mock');

// 4. 等待 client.lua 的 reui:init 设置 resourceName，之后 sendToGame 才可用
```

> `MessageDispatcher` 收到 `source === null | window` 的消息即转给 `nuiBridge.handleGameMessage`，故 `SendNUIMessage('reui:init')` 会被正确识别（见 `workspace/runtime/src/nui-bridge.ts`）。

---

## 7. Game ↔ Runtime 消息契约

与 RFC-001 §3.4 严格对齐。注意：游戏端消息**不带** `version` 字段（`version` 仅约束 Runtime ↔ iframe 链路），`NuiBridge` 按 `type` 前缀识别。

### 7.1 Game → Runtime（`SendNUIMessage`）

| type | payload | 处理 |
|------|---------|------|
| `reui:init` | `{ resourceName: string }` | `NuiBridge` 记录 resourceName，启用 `sendToGame` |
| `nui:<event>` | 任意 | `NuiBridge` 转发到 EventBus，事件名即 `nui:<event>` |

> 实现细节（重要）：当前 `nui-bridge.ts` 中 `reui:init` 的 `resourceName` 取**顶层字段**（`data.resourceName`），而 RFC-001 §3.4 文档示例写的是 `data.payload.resourceName`。本 RFC 以**代码实现为准**（CLAUDE.md 约定「与代码不一致时优先修代码再视情况更新文档」此处选择对齐代码），`client.lua` 发送顶层 `resourceName`。后续若统一为 payload 形态，需同步三处。

### 7.2 Runtime → Game（`fetch` NUI callback）

`NuiBridge.sendToGame(eventName, data)` → `POST https://<resourceName>/<eventName>`，由 `client.lua` 的 `RegisterNUICallback(eventName, …)` 接收。


---

## 8. Lua 脚本

### 8.1 fxmanifest.lua

```lua
fx_version 'cerulean'
game 'gta5'

author 'ReUI Team'
description 'ReUI Runtime host — entrance resource for the ReUI plugin framework'
version '0.0.0'

-- NUI 宿主页面（Vite 构建产物）
ui_page 'dist/index.html'

-- 必须显式收录全部产物，否则 CEF 取不到 assets
files {
  'dist/index.html',
  'dist/**/*',
}

client_script 'client/client.lua'
server_script 'server/server.lua'
```

### 8.2 client.lua

职责：①资源就绪后向 NUI 发 `reui:init` 握手；②把 Runtime 的 `sendToGame` 调用桥接到游戏；③按 Layer 焦点需求管理 `SetNUIFocus`。

```lua
-- 1. 握手：把 resourceName 推给 Runtime（NuiBridge 取顶层字段，见 §7.1）
AddEventHandler('onClientResourceStart', function(res)
  if res ~= GetCurrentResourceName() then return end
  SendNUIMessage({ type = 'reui:init', resourceName = GetCurrentResourceName() })
end)

-- 2. 焦点控制：Runtime 通过 sendToGame('reui:setFocus', {...}) 请求
RegisterNUICallback('reui:setFocus', function(data, cb)
  -- data: { keyboard = bool, cursor = bool }
  SetNUIFocus(data.keyboard == true, data.cursor == true)
  cb({ ok = true })
end)

-- 3. 业务回调示例：Runtime sendToGame('<event>', payload) → 此处接收
RegisterNUICallback('reui:log', function(data, cb)
  print(('[ReUI] %s'):format(tostring(data.message)))
  cb({ ok = true })
end)

-- 4. 反向推送游戏事件到 Runtime：转成 nui:<event>，由 NuiBridge → EventBus
RegisterNetEvent('reui:client:push', function(event, payload)
  SendNUIMessage({ type = ('nui:%s'):format(event), payload = payload })
end)
```

> 焦点约定：默认 `SetNUIFocus(false, false)`，避免玩家一进服就被锁定输入。只有当某个 Panel/Overlay 插件需要交互时，Runtime 才经 `reui:setFocus` 请求开启；关闭面板时务必复位（见 fivem-nui skill 的「Not disabling focus」陷阱）。

### 8.3 server.lua

占位 + 扩展点。RFC-002 的「服务端扫描插件目录、校验签名、下发清单」最终落在这里。第一阶段可只下发一个静态清单，供 Runtime `PluginManager` 加载 `samples/`。

```lua
-- 占位：未来对接 RFC-002 的插件注册/签名校验/清单下发
RegisterNetEvent('reui:server:requestManifest', function()
  local src = source
  -- TODO(RFC-002): 扫描 plugins 目录 + 校验签名 + 下发
  TriggerClientEvent('reui:client:manifest', src, {})
end)
```

---

## 9. 启动时序（端到端）

```
FiveM start fivem-entrance
  │
  ├─ client.lua: onClientResourceStart
  │     └─ SendNUIMessage({type:'reui:init', resourceName:'fivem-entrance'})
  │
  ├─ CEF 加载 dist/index.html → main.ts bootstrap
  │     ├─ 实例化单例服务 + LayerSystem
  │     └─ new MessageDispatcher(...) 挂上唯一 message 监听
  │
  ├─ MessageDispatcher 收到 reui:init（source===window）
  │     └─ nuiBridge.handleGameMessage → 记录 resourceName
  │
  ├─ [可选] Runtime 向 server 请求插件清单 → PluginManager 加载 iframe
  │
  └─ 子插件 iframe @reui/core 发起 reui:handshake → 正常通讯（RFC-001 §3.6）
```

此后 `NuiBridge.sendToGame` 可用，「Runtime → Game」链路打通。

---

## 10. 安全考量

- **资源名硬绑定**：`sendToGame` 的目标 URL 由游戏端 `reui:init` 提供的 `resourceName` 决定，不接受 NUI 侧任意覆盖，避免子插件伪造目标资源。
- **子插件不直连游戏**：iframe 无法直接 `fetch https://cfx-nui-fivem-entrance/...`（sandbox `allow-scripts`、origin 为 `null`），所有 NUI callback 必须经 Runtime 的 `nui:send` 方法中转并受 capability 检查（RFC-001 §4.1 / §5.3）。
- **焦点防卡死**：任何开启 `SetNUIFocus(true, *)` 的路径都必须有对应的复位回调，防止玩家无法移动/射击。
- **server 校验前置**：清单下发前必须经 RFC-002 的 Schema 校验与签名校验，未签名插件不得进入 `PluginManager`。
- **生产 iframe 不含 `allow-same-origin`**：宿主创建子插件 iframe 时遵循 RFC-001 §5.1，仅 dev 模式追加。

---

## 11. 测试计划

### 11.1 浏览器（mock 模式，无需游戏）

| 场景 | 验证 |
|------|------|
| `pnpm -F @reui/fivem-entrance dev` | 宿主页面加载，`NuiBridge` 处于 mock 模式，`sendToGame` 返回 `{ok,mock}` |
| 手动 `postMessage({type:'reui:init',resourceName:'x'})` | `getResourceName()` 返回 `'x'` |
| 手动 `postMessage({type:'nui:test',payload})` | EventBus 收到 `nui:test` |

### 11.2 构建产物

| 场景 | 验证 |
|------|------|
| `pnpm -F @reui/fivem-entrance build` | 产出 `dist/index.html` + `dist/assets/*`，资源引用为相对路径 |
| 检查 `dist/index.html` | 无 `/` 根路径绝对引用（CEF 下会 404） |

### 11.3 游戏内（CEF）

| 场景 | 验证 |
|------|------|
| `ensure fivem-entrance` | 资源启动无报错，CEF devtools（`http://localhost:13172/`）可见宿主页面 |
| 启动握手 | DevTools 中 `NuiBridge.getResourceName()` === `'fivem-entrance'` |
| `sendToGame('reui:log', {message})` | client.lua 控制台打印日志 |
| 焦点 | `reui:setFocus` 开启后可操作鼠标，关闭后玩家恢复移动 |

---

## 12. 验收标准

- [ ] 新包 `@reui/fivem-entrance` 落在 `workspace/fivem-entrance/`，被 pnpm workspace 识别
- [ ] `dev` 可在浏览器以 mock 模式加载宿主页面
- [ ] `build` 产出 CEF 可加载的 `dist/`（相对路径、assets 不内联）
- [ ] `fxmanifest.lua` 正确声明 `ui_page` / `files` / `client_script` / `server_script`
- [ ] `client.lua` 在资源启动时发送 `reui:init`，且 `NuiBridge` 正确记录 resourceName
- [ ] `RegisterNUICallback('reui:setFocus')` 能正确控制 `SetNUIFocus`，关闭时复位
- [ ] `ensure fivem-entrance` 后 CEF 可加载页面、`MessageDispatcher` 正常工作
- [ ] 宿主 bootstrap 不重复实现任何 RFC-003 服务逻辑，仅做组装

---

## 13. 依赖关系

```
RFC-001 (协议) ─┐
RFC-002 (插件)  ├─→ RFC-009 fivem-entrance（宿主资源 / 交付层）
RFC-003 (服务) ─┤
RFC-005 (构建) ─┘
```

| 依赖 | 用途 |
|------|------|
| `@reui/runtime` | 被宿主页面 import 并组装的全部单例服务与核心模块 |
| `@reui/core` | （可选）宿主页面内自检 / dev 调试用 |
| `@reui/cli` | plugin.json Schema 校验、签名校验、（RFC-005）打包命令 |
| FiveM CEF / NUI 原生 | `SendNUIMessage` / `RegisterNUICallback` / `SetNUIFocus` |
| Vite | 宿主页面构建（base 相对路径） |

### 后续工作（不在本 RFC 范围）

- server.lua 对接 RFC-002 的完整插件扫描/签名/下发流程
- `@reui/cli` 增加 `pack` 命令，一键产出可部署资源目录（RFC-005 扩展）
- 多语言 / 多 game build（当前仅 `gta5`）

