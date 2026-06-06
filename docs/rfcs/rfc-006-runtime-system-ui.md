
# RFC-006: Phase 3.5 — 系统 UI 插件（System UI Plugin）

| 字段 | 值 |
|------|-----|
| **RFC 编号** | 006 |
| **标题** | 系统 UI 插件（全局 Notification / Toast / Dialog / Confirm / Prompt） |
| **状态** | Draft（v2 重写，2026-06-06） |
| **作者** | ReUI Team |
| **创建日期** | 2026-05-29 |
| **重写日期** | 2026-06-06 |
| **依赖** | RFC-001（通讯协议）, RFC-002（插件系统 / Layer System）, RFC-003（Runtime 服务 / EventBus）, **RFC-007（插件导出与跨插件 / Lua RPC）** |
| **被依赖** | RFC-004（Framework 可提供系统插件渲染所用的反馈组件）；任何需要全局通知 / 确认能力的业务插件与 Lua 资源 |

> **本版相对 v1 的根本变化：** 系统级 UI 不再是 Runtime 内置单例服务，而是**一个建立在 ReUI 框架之上的特权插件 `reui-system`**。它通过 **RFC-007 的导出机制**对外提供能力，其他插件经 `@reui/core` 访问、Lua 经 `exports.reui:invokePlugin` 访问。**本 RFC 只设计接口与契约,UI 渲染留待后续用 `@reui/framework` 在该插件内实现。**

---

## 1. 背景与动机

ReUI 的分层很清晰：

- `@reui/core` 是 iframe 侧的纯通讯 SDK，**不含任何 UI 渲染代码**（RFC-001 §2.2）。
- `@reui/framework` 是**可选的** React 组件库（RFC-004）。
- 插件运行在 `sandbox="allow-scripts"` 的 iframe 中（RFC-002 §3.6.1）。

存在一类目前没有归属的需求 —— **全局 / 系统级 UI**：

1. 服务端推一条全服公告，需要覆盖整屏，不依赖任何业务插件是否打开。
2. 一个只占屏幕一角的 HUD 插件，想弹一个全局"是否使用医疗包"的确认框。
3. Runtime 加载 / 卸载 / 检测插件崩溃时需要给玩家提示。
4. **游戏端 Lua** 想弹一条通知或确认框（如"确认购买?"），目前只能广播事件、拿不到结果。
5. Vue / Svelte / 纯 HTML 插件（不引入 framework）也要"通知 / 确认"能力。

### 1.1 为什么做成"插件"而不是 Runtime 内置服务

v1 曾主张把它做成 Runtime 单例服务，理由是"iframe 内 UI 溢不出边界、视觉不统一、core 不该扛 UI"。本版改为**特权插件**模型，因为这些顾虑都可被规避，且插件模型收益更大：

| v1 的顾虑 | 本版的解法 |
|---|---|
| iframe 内弹窗溢不出 iframe 边界 | 系统插件不是"占一角的 HUD"，而是**铺满全屏、置顶、默认 `pointer-events:none`** 的特权 iframe —— 渲染区域即整屏，不存在溢出问题 |
| 各插件视觉不统一 | 系统 UI 由**唯一**的 `reui-system` 插件用 `@reui/framework` 实现，全局只有一套观感 |
| `@reui/core` 不该承载 UI | core 仍是纯通讯 SDK；它对系统 UI 只做**薄包装**（转发 `exports:invoke`），不含任何 DOM/框架 |
| 强制所有插件预装 framework | 只有 `reui-system` 这**一个**插件依赖 framework；调用方（任何技术栈 / Lua）只需 core 或 Lua 桥 |

**收益：** UI 用框架自身的能力实现并复用组件库；系统 UI 可独立签名、独立升级；Runtime 内核不掺入任何渲染代码；跨插件 / Lua 调用直接复用 RFC-007 既有链路，无需另造协议。

**代价（已知并接受）：** 系统插件未加载 / 崩溃时**没有全局 UI 兜底**（见 §2.2 N6、§4.4.3 `SYSTEM_UNAVAILABLE`）；调用比内置服务多一跳跨 iframe RPC（toast 仍在一帧内，可接受）。

---

## 2. 目标与非目标

### 2.1 目标

- **G1** 定义一个**特权系统插件** `reui-system`：建立在 ReUI 框架之上，挂载于 Runtime 预留的全屏置顶 **System 层**，提供全局 Notification / Toast / Alert / Confirm / Prompt。
- **G2** 该插件通过 **RFC-007 `@expose`** 导出一组方法（`notify / toast / alert / confirm / prompt / dismiss`），**不新增 `system:*` 协议**。
- **G3** 在 Runtime / LayerSystem 中提供**最小的、仅授予系统插件的契约**：① 预留 System 层槽位；② 焦点仲裁（`SetNuiFocusInput`，因为只有 Runtime 能调 NUI 焦点）；③ 向系统插件转发插件生命周期事件（用于清理失主 UI）。
- **G4** 在 `@reui/core` 暴露 `system` 模块（**薄包装,转发 `exports:invoke`**），保持与 `event/http/ws/auth/nui/plugin` 一致的类型化体验，**不引入任何 DOM / UI 框架**。
- **G5** 提供 **Lua 接口**：经 RFC-007 桥 `exports.reui:invokePlugin('reui-system', method, args, cb)` 调用，并可选提供 Lua 语法糖 resource（`exports.reui:notify(...)` 等）。
- **G6** 复用 RFC-001/003/007 的错误体系（`ReUIError` + `ErrorCode`），用 RFC-007 的 `@expose({ requirePermissions })` 在系统插件侧设访问门槛。
- **G7** 队列化通知、栈式对话框；"用户取消"是正常返回，**非错误**；仅外部强制关闭才报 `DIALOG_DISMISSED`。
- **G8** **本期只交付接口 / 类型 / 协议契约 / Lua 契约 / capability / manifest 约定**；UI 渲染由系统插件后续用 framework 实现（§2.2 N1）。

### 2.2 非目标

- **N1** **本 RFC 不实现任何 UI 渲染**。所有 `notify/dialog/toast` 的视觉、动画、布局都留给 `reui-system` 插件在后续阶段用 `@reui/framework` 实现；本 RFC 仅冻结其**对外接口与行为语义**。
- **N2** 不在 `@reui/core` 中加入任何 DOM 操作或 UI 框架依赖。
- **N3** 不实现复杂多字段表单弹窗。本期仅 `prompt` 单文本输入；复杂表单作为普通 overlay 插件实现。
- **N4** System 层**不向普通 `plugin.json` 开放**：`PluginManifest.layer` 的 Zod Schema 仍只接受 `'hud' | 'panel' | 'overlay'`。System 层专属于被标记为系统插件且签名受信的 `reui-system`（见 §4.1）。
- **N5** 不新增协议版本（仍 `version: 1`）；不新增 `system:*` method —— 调用一律走 RFC-007 的 `exports:invoke`。
- **N6** **不提供 Runtime 原生 UI 兜底**。系统插件不可用时,调用返回 `SYSTEM_UNAVAILABLE`,由调用方自行降级（如打印日志 / 本地 toast）。
- **N7** 不实现持久化"通知中心"。所有通知瞬时，关闭即销毁。

---

## 3. 整体架构

```
┌────────────────────────── Runtime（宿主页面，零渲染代码） ──────────────────────────┐
│                                                                                    │
│  ┌─────────────────┐   ┌────────────────────┐   ┌──────────────────────────────┐  │
│  │ PostMessage     │   │  ExportRegistry     │   │  LayerSystem                  │  │
│  │ Router          │──▶│  (RFC-007 单例)      │   │   • System 层槽位 (z 400-499) │  │
│  │  + capability   │   │   • 路由 exports:    │   │   • acquireFocus/releaseFocus │  │
│  │                 │   │     invoke           │   │     (仅 runtime.systemLayer)  │  │
│  └─────────────────┘   └─────────┬──────────┘   └──────────────┬───────────────┘  │
│                                  │ 转发到目标插件                │ 挂载 iframe        │
└──────────────────────────────────┼──────────────────────────────┼──────────────────┘
        ▲ exports:invoke            │                              │
        │ (reui:request)            ▼                              ▼
┌───────┴────────────┐   ┌──────────────────────────────────────────────────────────┐
│ 任意调用方 iframe   │   │  reui-system 插件 iframe（全屏置顶 / framework 实现 UI）    │
│  @reui/core         │   │   @expose notify / toast / alert / confirm / prompt /      │
│   └── system        │   │           dismiss                                          │
│     (薄包装,转发     │   │   • notifQueue（≤5）   • dialogStack（≤8）                 │
│      exports:invoke)│   │   • 失主清理（订阅 plugin:unloaded/crashed）               │
└────────────────────┘   │   • 渲染：后续用 @reui/framework（本 RFC 不实现）          │
                         └──────────────────────────────────────────────────────────┘
        ▲ exports.reui:invokePlugin('reui-system', ...)
        │
┌───────┴──────────────── 游戏端 Lua（RFC-007 自带桥 resource） ─────────────────────┐
│  exports.reui:invokePlugin('reui-system','confirm',{message='确认购买?'}, cb)       │
│  （可选语法糖）exports.reui:notify('已保存','success')                              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**架构要点：**

1. **系统 UI 是一个插件**，不是 Runtime 服务。它和普通插件一样被 PluginManager 加载、签名校验、生命周期管理；唯一区别是它被标记为**系统插件**，因而获得 System 层与若干特权 capability。
2. **调用一律走 RFC-007**：任何"调用系统 UI"= 一次 `exports:invoke('reui-system', method, args)`，由 ExportRegistry 路由。无新增协议。
3. **Runtime 只保留插件做不到的三件事**：System 层槽位、NUI 焦点仲裁、生命周期事件转发。除此之外 Runtime **不含任何系统 UI 逻辑或渲染**。
4. **core / Lua 都是薄包装**：core 的 `system.*` 转发 `exports:invoke`；Lua 走 RFC-007 桥 + 可选语法糖。

---

## 4. 详细设计

### 4.1 系统插件定位与 manifest（扩展 RFC-002）

`reui-system` 是一个**特权插件**。在 RFC-002 的 `PluginManifest` 上**新增一个受限字段**以标记系统插件，并约束其只能由受信签名启用：

```jsonc
// reui-system/plugin.json
{
  "id": "reui-system",
  "name": "ReUI System UI",
  "version": "1.0.0",
  "entry": "index.html",
  "kind": "system",              // ★ 新增：标记为系统插件（普通插件不可声明）
  "layer": "system",             // 仅当 kind === 'system' 时 Schema 才接受
  "permissions": [
    "runtime.systemLayer",       // ★ 新增特权：System 层 + 焦点 + 生命周期事件
    "exports.expose"             // RFC-007：允许 @expose 注册导出
  ]
}
```

**Schema 约束（在 RFC-002 §3.1.1 基础上）：**

- 新增可选字段 `kind?: 'system'`。**默认（不声明）为普通插件。**
- `layer: 'system'` 与 `permissions` 中的 `runtime.systemLayer` **仅在 `kind === 'system'` 时合法**；普通插件声明这三者中任意一个 → Schema 校验失败。
- `kind: 'system'` 的插件**必须经受信密钥签名**（RFC-005 `reui sign` 的高权限密钥），未签名 / 普通签名一律拒绝加载。
- 一个 Runtime 实例**至多注册一个** `kind: 'system'` 插件；重复注册 → `SYSTEM_ALREADY_REGISTERED`（仅 Runtime 启动期内部错误，不对插件暴露）。

> 这样既满足"系统 UI 是基于框架的插件"，又保证 System 层不被普通插件冒用。

### 4.2 Runtime 侧最小契约（仅授予系统插件）

这是 Runtime 中**唯一**与系统 UI 相关的代码，且全部 gated 在 `runtime.systemLayer` capability 之后。

#### 4.2.1 LayerSystem：System 层槽位

| 层级 | z-index | 可见性 | 输入行为 | 来源 |
|------|---------|--------|----------|------|
| HUD | 100-199 | 始终可见 | `pointer-events:none` | 普通插件 iframe |
| Panel | 200-299 | 按需切换 | 互斥 + 焦点 | 普通插件 iframe |
| Overlay | 300-399 | 栈式弹出 | 遮罩 | 普通插件 iframe |
| **System** | **400-499** | **常驻全屏** | **默认 `pointer-events:none`；对话框期间由插件请求焦点** | **`reui-system` iframe** |

```typescript
// runtime/src/layer-system.ts（扩展）
export type LayerType = 'hud' | 'panel' | 'overlay' | 'system';

class LayerSystem {
  /** 仅在加载 kind:'system' 插件时调用一次：把系统插件 iframe 挂入全屏置顶 system 槽位 */
  mountSystemPlugin(iframe: HTMLIFrameElement): void;

  /** 进入焦点模式（confirm/prompt 等需要键鼠时）。仅持 runtime.systemLayer 的插件可触发 */
  acquireSystemFocus(): void;

  /** 退出焦点模式，按归还策略恢复焦点 */
  releaseSystemFocus(): void;
}
```

**焦点归还策略**（与 v1 一致，保留）：`releaseSystemFocus()` 后 —— Overlay 栈非空则焦点留 Overlay；否则 Panel active 则留 Panel；否则 `SetNuiFocusInput(false,false)` 还给游戏。

#### 4.2.2 焦点仲裁方法（capability 门控）

System 插件不能自己调 `SetNuiFocusInput`（那是 Runtime / NUI 的权力）。Runtime 暴露两个**仅对持 `runtime.systemLayer` 的插件**开放的 method（走普通 `reui:request`，由 PostMessageRouter 校验 capability）：

| method | params | 行为 | capability |
|--------|--------|------|------------|
| `system-layer:acquireFocus` | `void` | `LayerSystem.acquireSystemFocus()` | `runtime.systemLayer` |
| `system-layer:releaseFocus` | `void` | `LayerSystem.releaseSystemFocus()` | `runtime.systemLayer` |

> 普通插件即便伪造这两个 method 也会因缺 `runtime.systemLayer` 被 `CAPABILITY_DENIED` 拒绝。

#### 4.2.3 生命周期事件转发

系统插件需要在"某个调用方插件卸载 / 崩溃"时，清理它名下尚未关闭的对话框（失主清理）。Runtime 通过 EventBus（RFC-003）向**持 `runtime.systemLayer` 的插件**额外推送：

| event | payload | 时机 |
|-------|---------|------|
| `runtime:plugin:unloaded` | `{ pluginId }` | PluginManager 卸载某插件后 |
| `runtime:plugin:crashed` | `{ pluginId }` | heartbeat 超时判定崩溃后 |

系统插件订阅这两个事件 → 调用内部 `dismissAllForCaller(pluginId)`。普通插件**无权**订阅 `runtime:plugin:*`（EventBus 在 `subscribeForPlugin` 时校验 capability）。

### 4.3 系统插件导出的方法与类型（`@expose`）

以下类型是**本 RFC 冻结的对外契约**；其实现（含 UI）在 `reui-system` 插件内、后续用 framework 完成。

```typescript
// reui-system/src/exports.ts（契约；UI 后续实现）
export type NotificationLevel = 'info' | 'success' | 'warning' | 'danger';

export interface NotifyParams {
  message: string;                                 // 必填
  title?: string;
  level?: NotificationLevel;                        // 默认 'info'
  duration?: number;                               // ms，默认 4000；0 = 不自动消失
  icon?: string;                                   // 主题预定义 key
  action?: { label: string; eventName: string };  // 可选行动按钮
}
export interface ToastParams  { message: string; level?: NotificationLevel; duration?: number; } // duration 默认 2000
export interface DialogParams { title?: string; message: string; level?: NotificationLevel;
                                okText?: string; cancelText?: string; dismissible?: boolean; }     // dismissible 默认 true
export interface PromptParams extends DialogParams {
  defaultValue?: string; placeholder?: string; maxLength?: number; inputType?: 'text' | 'password';
}

// 导出方法签名（由 @expose 注册到 ExportRegistry）
export class SystemUIExports {
  @expose({ requirePermissions: ['runtime.notification'] })
  notify(p: NotifyParams): { id: string };               // 立即返回 id

  @expose({ requirePermissions: ['runtime.notification'] })
  toast(p: ToastParams): void;                           // fire-and-forget

  @expose({ requirePermissions: ['runtime.notification'] })
  dismiss(id: string): { dismissed: boolean };           // 仅能关闭调用方自己发起的 id

  @expose({ requirePermissions: ['runtime.dialog'] })
  alert(p: DialogParams): Promise<void>;

  @expose({ requirePermissions: ['runtime.dialog'] })
  confirm(p: DialogParams): Promise<{ ok: boolean }>;

  @expose({ requirePermissions: ['runtime.dialog'] })
  prompt(p: PromptParams): Promise<{ value: string | null }>;
}
```

**权限模型（用 RFC-007 `requirePermissions` 而非 v1 的 PostMessageRouter 直检）：**

| capability（调用方需声明） | 可调用的导出方法 |
|---|---|
| `runtime.notification` | `notify` / `toast` / `dismiss` |
| `runtime.dialog` | `alert` / `confirm` / `prompt` |

- 调用方还必须持 RFC-007 的 `exports.call`（调用任意导出的基础权限）。
- ExportRegistry 在转发前用调用方的 `permissions` 校验 `requirePermissions`，不满足 → `CAPABILITY_DENIED`（门槛由**被调用方**设定，无需信任调用方自己的声明）。
- `runtime.dialog` 视为高权限，CLI `reui sign` 对声明它的插件标记"高权限"（RFC-005）。
- **调用方与失主归属**：ExportRegistry 转发时携带 `callerPluginId`（RFC-007 §4.1）；系统插件据此记录每条 UI 的 owner，用于 `dismiss` 归属校验与失主清理。Lua 调用方 owner 记为 `'__lua'`。

### 4.4 调用机制（复用 RFC-007，无新增协议）

#### 4.4.1 转发链路

```
调用方 core.system.confirm('删除?')
  → client.request('exports:invoke', { target:'reui-system', method:'confirm', args:[{message:'删除?'}] })
  → PostMessageRouter → ExportRegistry.invoke(caller, 'reui-system', 'confirm', args)
  → ExportRegistry 校验 confirm.requirePermissions(['runtime.dialog']) ⊆ caller.permissions
  → 重打包为 exports:__dispatch 转发到 reui-system iframe（RFC-007 §4.1）
  → reui-system 渲染对话框 + system-layer:acquireFocus
  → 用户点确定 → 方法 resolve { ok:true } → 原路返回调用方
```

#### 4.4.2 推送事件（notify 的 action / dismissed 回调）

notify 的 `action` 点击与关闭回调，**不再走专用 `system:*` push**，而是由系统插件用 RFC-003 EventBus 推送给**发起插件**。约定事件名（命名空间归系统插件所有）：

| event | payload | 时机 |
|-------|---------|------|
| `reui-system:notification:action` | `{ id, eventName }` | notify 含 action 且用户点击（仅发起插件可见） |
| `reui-system:notification:dismissed` | `{ id, reason: 'auto'\|'user'\|'plugin' }` | notify 关闭（仅发起插件可见） |

> 系统插件只向"该通知的 owner 插件"定向推送（按 §4.3 记录的 owner 过滤），不广播。

#### 4.4.3 错误码（在 RFC-001/007 基础上新增）

| Code | 含义 | 触发 |
|------|------|------|
| `DIALOG_DISMISSED` | 对话框被外部强制关闭 | 调用方卸载 / 崩溃 / 系统插件重载，致进行中的 alert/confirm/prompt 被迫中止 |
| `SYSTEM_BUSY` | 系统 UI 繁忙 | dialogStack 超过上限（>8）时拒绝新对话框 |
| `SYSTEM_UNAVAILABLE` | 系统插件不可用 | `reui-system` 未加载 / 崩溃 / 未注册（由 RFC-007 的 `PLUGIN_NOT_LOADED` 归一化而来） |

- `confirm` 用户点取消 = 正常返回 `{ok:false}`，**非错误**；`prompt` 取消 = `{value:null}`。
- 纯插件模型下**无兜底**：系统插件不在线时所有调用返回 `SYSTEM_UNAVAILABLE`，调用方应静默降级（见 §4.7 示例）。

### 4.5 `@reui/core` 的 `system` 薄包装

core 不直连任何 `system:*`，而是**封装 `exports:invoke`**，给调用方一套好用的类型化 API：

```typescript
// @reui/core/src/system.ts
import { Client } from './client';

const TARGET = 'reui-system';

export class ReUISystem {
  constructor(private client: Client) {}

  private invoke<T>(method: string, params: unknown): Promise<T> {
    return this.client
      .request<T>('exports:invoke', { target: TARGET, method, args: [params] })
      .catch((err) => { throw normalizeSystemError(err); }); // PLUGIN_NOT_LOADED → SYSTEM_UNAVAILABLE
  }

  async notify(message: string, options?: NotifyOptions): Promise<NotificationHandle> {
    const { id } = await this.invoke<{ id: string }>('notify', { message, ...options });
    return { id, dismiss: () => this.invoke('dismiss', id).then(() => undefined) };
  }

  toast(message: string, options?: ToastOptions): void {
    // fire-and-forget：用 client.notify 转发，不等响应
    this.client.notify('exports:invoke', { target: TARGET, method: 'toast', args: [{ message, ...options }] });
  }

  async alert(message: string, options?: DialogOptions): Promise<void> {
    await this.invoke('alert', { message, ...options });
  }
  async confirm(message: string, options?: DialogOptions): Promise<boolean> {
    return (await this.invoke<{ ok: boolean }>('confirm', { message, ...options })).ok;
  }
  async prompt(message: string, options?: PromptOptions): Promise<string | null> {
    return (await this.invoke<{ value: string | null }>('prompt', { message, ...options })).value;
  }

  onNotificationAction(handler: (d: { id: string; eventName: string }) => void) {
    return this.client.onPush('reui-system:notification:action', handler as any);
  }
  onNotificationDismissed(handler: (d: { id: string; reason: 'auto'|'user'|'plugin' }) => void) {
    return this.client.onPush('reui-system:notification:dismissed', handler as any);
  }
}
```

**导出（`@reui/core/src/index.ts` 追加）：**

```typescript
import { ReUISystem } from './system';
export const system = new ReUISystem(client);
export type { NotificationLevel, NotifyOptions, DialogOptions, PromptOptions, ToastOptions, NotificationHandle } from './system';
```

> **体积：** `system.ts` 仅是若干 `exports:invoke` 转发 + 类型，< 1.5 KB（minified），无 DOM/框架依赖，对 `< 10KB gzipped`（RFC-001 §7.2）无威胁。

### 4.6 Lua 接口（需求 #4）

#### 4.6.1 基础形态：直接走 RFC-007 桥

无需任何新桥，复用 RFC-007 §4.6 的 `exports.reui:invokePlugin`：

```lua
-- 通知
exports.reui:invokePlugin('reui-system', 'notify',
  { { message = '已保存', level = 'success' } },
  function(err, res) if not err then print('notify id =', res.id) end end)

-- 确认（拿到布尔结果）
exports.reui:invokePlugin('reui-system', 'confirm',
  { { message = '确认购买该物品?', level = 'warning', okText = '购买', cancelText = '取消' } },
  function(err, res)
    if err then return end          -- err.code 可能为 SYSTEM_UNAVAILABLE / DIALOG_DISMISSED
    if res.ok then doPurchase() end
  end)
```

**Lua 侧权限（RFC-007 §4.6）：** Lua 调用方记为受信 caller `'__lua'`，默认拥有 `exports.call.*`；但系统插件在 `@expose` 上声明的 `requirePermissions`（`runtime.notification` / `runtime.dialog`）**对 Lua 同样强制**——即系统插件可对 Lua 也设门槛（`'__lua'` 的权限集由桥 resource 的 convar 配置，默认含二者）。

#### 4.6.2 可选语法糖 resource

为贴近 FiveM 习惯，`reui-system` 可附带一个轻量 Lua 导出层，封装上面的样板：

```lua
-- 由 reui-system 自带桥提供（可选）
exports.reui:notify('已保存', 'success')                 -- 等价 invokePlugin('reui-system','notify',...)
exports.reui:toast('已复制')
exports.reui:confirm('确认购买?', function(ok) if ok then doPurchase() end end)
exports.reui:prompt('输入新名称', function(value) if value then rename(value) end end)
```

> 语法糖纯属便利层，**契约真相源仍是 §4.3 的方法签名**；语法糖内部一律转调 `invokePlugin('reui-system', ...)`。

### 4.7 行为语义（保留 v1 的好设计，执行者改为系统插件）

| 点 | 行为 |
|----|------|
| 通知队列 | 同时最多 5 条，自上而下堆叠，超出排队；`duration:0` 不超时但占槽 |
| 对话框栈 | `alert/confirm/prompt` 同一时刻只显示栈顶一个，后续排队；栈顶关闭弹下一个 |
| 用户取消 | `confirm`→`{ok:false}`；`prompt`→`{value:null}`；`alert`→`void`；**均非错误** |
| 失主清理 | 系统插件订阅 `runtime:plugin:unloaded/crashed`，对该 owner 进行中的 dialog 以 `DIALOG_DISMISSED` 中止、移除其全部通知 |
| 重复防抖 | 同一 owner 1s 内重复相同 `notify` 内容 → 仅刷新已存在那条的 duration |
| dismiss 归属 | `dismiss(id)` 仅能关闭调用方自己 owner 的 id；跨插件 → `PERMISSION_DENIED` |
| XSS | 渲染 `message/title/placeholder` **一律 `textContent`，禁止 HTML 解析**（系统插件实现的硬约束） |
| 焦点 | `alert/confirm/prompt` 弹出时 `system-layer:acquireFocus`，全部关闭后 `releaseFocus`；`notify/toast` 不夺焦点 |
| 文本上限 | `message` 超 800 字符自动截断加省略号，避免覆盖整屏 |

### 4.8 调用方使用示例

```typescript
import { init, system, ReUIError, ErrorCode } from '@reui/core';
await init();

system.toast('已保存');                                    // 轻提示

const handle = await system.notify('您有 3 条新消息', {     // 带 action 的常驻通知
  level: 'info', duration: 0, action: { label: '查看', eventName: 'open-mail' },
});
system.onNotificationAction(({ eventName }) => { if (eventName === 'open-mail') openMailbox(); });
await handle.dismiss();                                    // 任务结束主动关闭

const ok = await system.confirm('确定删除该物品?', { level: 'danger', okText: '删除' });
if (ok) await api.delete(itemId);

const name = await system.prompt('请输入新角色名', { defaultValue: cur, maxLength: 32 });
if (name !== null) await api.rename(name);

// 纯插件模型：系统插件不在线时的降级
try {
  await system.confirm('提交?');
} catch (err) {
  if (err instanceof ReUIError && err.code === ErrorCode.SYSTEM_UNAVAILABLE) { console.warn('系统 UI 未就绪'); return; }
  if (err instanceof ReUIError && err.code === ErrorCode.DIALOG_DISMISSED) return; // 本插件正在卸载
  throw err;
}
```

---

## 5. 安全考量

### 5.1 权限分层

| 主体 | 所需 capability | 校验方 |
|------|----------------|--------|
| 系统插件 `reui-system` | `runtime.systemLayer` + `exports.expose`，且 `kind:'system'` + 受信签名 | RFC-002 Schema + RFC-005 签名 + PostMessageRouter |
| 调用 notify/toast | `exports.call` + `runtime.notification` | ExportRegistry（`requirePermissions`） |
| 调用 alert/confirm/prompt | `exports.call` + `runtime.dialog` | ExportRegistry（`requirePermissions`） |
| Lua 调用 | `'__lua'` 受信，权限由桥 convar 配置 | RFC-007 桥 + ExportRegistry |

### 5.2 防滥用

| 风险 | 防护 |
|------|------|
| 高频刷通知 | 1s 重复合并；队列上限 5，超出排队 |
| 无限堆 dialog | 栈上限 8，超出 `SYSTEM_BUSY` |
| dialog 阻塞游戏 | 焦点只影响 system 层；Runtime 可配全局 `ESC` 强制 dismiss 栈顶 `dismissible:true` 对话框 |
| 冒充他人关闭 UI | `dismiss` 校验 owner，跨插件 `PERMISSION_DENIED` |
| 普通插件冒占 System 层 / 焦点 | Schema 拒绝普通插件的 `layer:'system'`/`runtime.systemLayer`；焦点 method capability 门控 |
| XSS | `textContent` 渲染，禁 HTML |

### 5.3 焦点与游戏的交互

`confirm/prompt` 弹出 → 系统插件 `system-layer:acquireFocus` → Runtime `SetNuiFocusInput(true,true)`；关闭 → `releaseFocus` 按 §4.2.1 策略归还。即便玩家在纯游戏态（无 panel/overlay），系统确认框也能立即拿到键鼠，关闭后正确归还。

---

## 6. 测试计划

### 6.1 系统插件单元测试（导出方法行为）

| 用例 | 预期 |
|------|------|
| `notify` 连插 6 条 | 5 条显示、1 条排队，关闭任一后排队弹出 |
| 同 owner 1s 内重复 `notify` | 仅刷新 duration，不新建 |
| `confirm` 确定 / 取消 | `{ok:true}` / `{ok:false}`（取消无错误） |
| `prompt` 提交空串 / 取消 | `{value:''}` / `{value:null}` |
| 进行中 `confirm` 遇 owner 卸载 | reject `DIALOG_DISMISSED` |
| dialogStack 达 8 再 push | `SYSTEM_BUSY` |
| 跨 owner `dismiss` | `PERMISSION_DENIED` |
| notify action 点击 / 自动消失 | 定向推送 `...:action` / `...:dismissed(reason:'auto')` |

### 6.2 集成测试（端到端）

| 场景 | 验证点 |
|------|--------|
| 调用方 `core.system.confirm()` → 经 ExportRegistry → 系统插件渲染 → 用户确定 → 调用方得 `true` | RFC-007 完整链路 |
| 调用方缺 `runtime.dialog` 调 `confirm` | `CAPABILITY_DENIED`，未弹窗 |
| `reui-system` 未加载时调用 | `SYSTEM_UNAVAILABLE`（无兜底 UI） |
| Lua `invokePlugin('reui-system','confirm',...)` | 回调拿到 `ok`，焦点正确切换/归还 |
| 调用方热重载时其进行中的 `prompt` | 旧调用 `DIALOG_DISMISSED`，重载后可正常再调 |
| confirm 弹出 → `SetNuiFocusInput(true)` → 关闭 → 焦点归还（无 overlay/panel 时还游戏） | LayerSystem 焦点策略 |

### 6.3 边界

- 1000 字 `message` → 截断 800 + 省略号。
- 同 owner 并发 10 个 `confirm` → FIFO 排队。
- `prompt` 输入 `<script>alert(1)</script>` → `textContent` 插入,不执行。
- `dismissible:false` + 全局 ESC → 拒绝关闭。

---

## 7. 验收标准

### 7.1 契约 / 接口（本 RFC 本期范围）

- [ ] RFC-002 Schema 新增 `kind:'system'`；`layer:'system'` 与 `runtime.systemLayer` 仅对 `kind:'system'` 合法，且要求受信签名
- [ ] LayerSystem 新增 System 层（z 400-499）+ `mountSystemPlugin/acquireSystemFocus/releaseSystemFocus`
- [ ] Runtime 暴露 `system-layer:acquireFocus/releaseFocus`，仅 `runtime.systemLayer` 可调
- [ ] Runtime 向持 `runtime.systemLayer` 的插件推送 `runtime:plugin:unloaded/crashed`
- [ ] `reui-system` 通过 `@expose` 注册 `notify/toast/alert/confirm/prompt/dismiss`，签名见 §4.3
- [ ] 权限经 RFC-007 `requirePermissions`（`runtime.notification`/`runtime.dialog`）强制
- [ ] `@reui/core` 导出 `system` 薄包装,全部转发 `exports:invoke`,类型无 `any` 泄漏
- [ ] 新增错误码 `DIALOG_DISMISSED` / `SYSTEM_BUSY` / `SYSTEM_UNAVAILABLE`
- [ ] Lua 经 `exports.reui:invokePlugin('reui-system',...)` 可调；可选语法糖 `exports.reui:notify/confirm/...`
- [ ] notify action/dismissed 经 EventBus 定向推送给 owner 插件

### 7.2 行为 / 安全

- [ ] `confirm` 取消返回 `{ok:false}` 而非错误；外部强制关闭才 `DIALOG_DISMISSED`
- [ ] 队列上限 5 / 栈上限 8（`SYSTEM_BUSY`）
- [ ] 跨 owner `dismiss` → `PERMISSION_DENIED`
- [ ] message/title/placeholder 用 `textContent`，HTML 注入无效
- [ ] 缺 `runtime.notification`/`runtime.dialog` 的调用 → `CAPABILITY_DENIED`
- [ ] 系统插件不在线 → `SYSTEM_UNAVAILABLE`，**无 Runtime 兜底渲染**

### 7.3 UI（后续阶段，非本 RFC）

- [ ] `reui-system` 用 `@reui/framework` 实现 notify/toast/dialog 的渲染、动画、主题（**留待 RFC-004 落地后**）

---

## 8. 依赖关系

### 8.1 前置依赖

| RFC | 依赖内容 |
|------|----------|
| RFC-001 | `reui:request/response/push/notify` 协议、错误码体系、PostMessageRouter |
| RFC-002 | 插件加载 / 签名 / 生命周期；LayerSystem（新增 system 层）；manifest Schema（新增 `kind:'system'`） |
| RFC-003 | EventBus（notify 回调 + 生命周期事件分发）、`ReUIError`/`ErrorCode` |
| **RFC-007** | **ExportRegistry / `@expose` / `exports:invoke` / Lua 桥 —— 调用机制的全部基础** |

> **关键：本 RFC 强依赖 RFC-007。** RFC-007 未落地前，本 RFC 无法实现（无调用通道）。建议实现顺序：RFC-007 → RFC-006 →（RFC-004 落地后）系统插件 UI。

### 8.2 对其他组件的影响

| 组件 | 影响 |
|------|------|
| RFC-002 Schema | 新增 `kind:'system'`；`layer:'system'`/`runtime.systemLayer` 受 `kind` 与签名约束 |
| LayerSystem | 新增 system 层 + 焦点仲裁 |
| PostMessageRouter | 注册 `system-layer:acquireFocus/releaseFocus`（capability 门控） |
| EventBus | 允许持 `runtime.systemLayer` 的插件订阅 `runtime:plugin:*` |
| ExportRegistry（RFC-007） | 无需改动，系统插件作为普通导出提供方接入 |
| `@reui/core` | 新增 `system` 模块（转发 `exports:invoke`） |
| RFC-005 CLI | `kind:'system'` 要求受信签名；`runtime.dialog` 标记高权限 |

### 8.3 实现顺序

```
0. （前置）RFC-007 ExportRegistry + Lua 桥落地
1. RFC-002 Schema 扩展 kind:'system' + 签名约束
2. LayerSystem system 层槽位 + 焦点仲裁 + capability 门控 method
3. EventBus 向 runtime.systemLayer 插件转发 plugin 生命周期事件
4. reui-system 插件骨架：@expose 六方法 + 队列/栈/失主清理/归属逻辑（UI 占位）
5. @reui/core/system 薄包装 + 错误归一化
6. Lua 语法糖 resource（可选）
7. 集成测试 + 验收（§7.1/§7.2）
8.（后续）reui-system 用 @reui/framework 实现 UI（§7.3）
```

---

## 附录 A：导出方法速查（契约真相源）

| 方法 | params | 返回 | requirePermissions | 调用通道 |
|------|--------|------|--------------------|----------|
| `notify` | `NotifyParams` | `{id}` | `runtime.notification` | `exports:invoke`（request） |
| `toast` | `ToastParams` | — | `runtime.notification` | `exports:invoke`（notify, fire-and-forget） |
| `dismiss` | `id:string` | `{dismissed}` | `runtime.notification`（+owner 校验） | `exports:invoke` |
| `alert` | `DialogParams` | `void` | `runtime.dialog` | `exports:invoke` |
| `confirm` | `DialogParams` | `{ok}` | `runtime.dialog` | `exports:invoke` |
| `prompt` | `PromptParams` | `{value}` | `runtime.dialog` | `exports:invoke` |

## 附录 B：事件速查

| SDK API | event | 路由 |
|---------|-------|------|
| `system.onNotificationAction` | `reui-system:notification:action` | EventBus → 仅 owner 插件 |
| `system.onNotificationDismissed` | `reui-system:notification:dismissed` | EventBus → 仅 owner 插件 |
| （系统插件内部订阅） | `runtime:plugin:unloaded` / `runtime:plugin:crashed` | EventBus → 仅 `runtime.systemLayer` 插件 |

## 附录 C：与 RFC-004 framework 反馈组件的关系

| 维度 | `@reui/framework` `Toast/Dialog` | `reui-system`（经 `@reui/core/system`） |
|------|----------------------------------|------------------------------------------|
| 渲染位置 | 调用插件 iframe **内部** | `reui-system` 全屏置顶 iframe（盖全屏） |
| 强制依赖 | 引入 framework + React | 仅 `@reui/core` 或 Lua（任意技术栈） |
| 适合场景 | 插件自身界面内反馈（表单校验等） | 跨插件 / 全屏 / 系统级 / Lua 触发 |
| 实现关系 | framework 组件 | **`reui-system` 的 UI 正是用这些 framework 组件实现的** |

## 附录 D：完整消息流（confirm，含 RFC-007 转发）

```
 1. 插件 A：const ok = await system.confirm('删除?', {level:'danger'})
 2. ReUISystem.confirm → client.request('exports:invoke',
       { target:'reui-system', method:'confirm', args:[{message:'删除?',level:'danger'}] })
 3. Client 生成 id='A:42' → reui:request 发往 parent
 4. MessageDispatcher 验证来源 → PostMessageRouter → ExportRegistry.invoke
 5. ExportRegistry 校验 confirm.requirePermissions(['runtime.dialog']) ⊆ A.permissions ✓
 6. 重打包 exports:__dispatch（带 callerPluginId='A'）→ reui-system iframe
 7. reui-system 入 dialogStack，渲染对话框（framework）→ system-layer:acquireFocus
 8. 用户点"删除" → confirm 方法 resolve {ok:true}
 9. reui-system 出栈，若栈空 → system-layer:releaseFocus
10. 响应原路：reui-system → ExportRegistry → PostMessageRouter → A 的 Client（匹配 id='A:42'）
11. ReUISystem.confirm 返回 true 给插件 A
```
