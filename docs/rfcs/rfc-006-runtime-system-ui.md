
# RFC-006: Phase 3.5 — Runtime 系统级 UI 服务

| 字段 | 值 |
|------|-----|
| **RFC 编号** | 006 |
| **标题** | Runtime 系统级 UI 服务（Notification / Dialog / Confirm） |
| **状态** | Draft |
| **作者** | ReUI Team |
| **创建日期** | 2026-05-29 |
| **依赖** | RFC-001 (通讯协议), RFC-002 (插件系统 / Layer System), RFC-003 (Runtime 服务) |
| **被依赖** | RFC-004 (Framework UI 可在其之上封装高级反馈组件) |

---

## 1. 背景与动机

ReUI 目前的分层非常清晰：

- `@reui/core` 是 iframe 侧的纯通讯 SDK，**不含任何 UI 渲染代码**（RFC-001 §2.2 明确将"UI 组件库"列为非目标）。
- `@reui/framework` 是**可选的** React 组件库，提供 `Toast / Dialog / Notification` 等组件（RFC-004 §3.3）。
- 插件运行在 `sandbox="allow-scripts"` 的 iframe 中（RFC-002 §3.6.1），**iframe 内部弹出的 UI 不能溢出到 iframe 边界之外**。

这就引出了一个目前架构里没有覆盖的需求：**全局/系统级 UI**。具体表现为以下场景：

1. 服务端推送一条全服公告，需要覆盖整个屏幕显示，不依赖任何具体插件页面是否打开。
2. 一个 HUD 类小插件（仅占屏幕一角）希望弹出一个"是否使用医疗包"的全局确认框。
3. Runtime 自身在加载/卸载插件、检测到插件崩溃时需要给玩家一条提示。
4. 玩家被踢出/禁言/权限变更等系统级事件需要立刻可见。
5. Vue / Svelte / 纯 HTML 编写的插件（不引入 `@reui/framework`）也需要"通知/确认"能力，否则就被迫复制实现。

如果让每个插件自己实现这类 UI：

- **视觉不统一**：每个插件实现的弹窗风格各异（违反 RFC-004 G1）。
- **不能覆盖全屏**：iframe 内部弹窗最多覆盖 iframe 区域，无法跨越到其他插件之上。
- **Core 不应承载 UI**：在 `@reui/core` 中加入 DOM/React 渲染会突破其"通讯 SDK + < 10KB gzip"的边界（RFC-001 §7.2）。
- **强行使用 framework**：违反 RFC-004 N1（不强制 React），且要求所有插件预装 `@reui/framework`。

**本 RFC 的解决思路：** 将"系统级 UI"作为 Runtime 的一项**单例服务**实现，渲染权完全归 Runtime，子页面通过 `postMessage` 协议以 RPC 方式调用，`@reui/core` 仅暴露一组**薄包装**的 API（不引入 DOM/框架），与现有 `event / http / ws / auth / nui / plugin` 模块保持一致风格。

---

## 2. 目标与非目标

### 2.1 目标

- **G1** 在 Runtime 内提供一个**单例 SystemUIService**，统一渲染全局 Notification / Dialog / Confirm / Alert / Toast。
- **G2** 在协议层新增 `system:*` 一组 method，覆盖通知、对话框、确认、警告、轻提示。
- **G3** 在 LayerSystem 中新增独立的 **System 层**（z-alog` 与 `runtime.notification`），由 PostMessageRouter 统一执行权限检查。
- **G6** 提供与 RFC-001/003 一致的错误处理（`ReUIError` + `ErrorCode`）和 capability 模型。
- **G7** 队列化通知（避免短时间内大量请求互相覆盖），对话框的"用户取消"通过专用错误码 `DIALOG_DISMISSED` 上报。
- **G8** 与现有 Auth / EventBus 风格一致：单例服务 + `subscribeForPlugin` 风格的清理逻辑。

### 2.2 非目标

- **N1** 不替代 `@reui/framework` 的 `Toast / Diaindex 400-499，最高优先级），不与 HUD / Panel / Overlay 互斥也不参与栈管理。
- **G4** 在 `@reui/core` 中暴露 `system` 模块（薄包装），**不引入任何 DOM 或 UI 框架**。
- **G5** 所有调用受 capability 控制（新增 `runtime.dilog`：插件**自身界面内部**的反馈仍由 framework 组件负责；本 RFC 仅解决"必须跨 iframe / 全屏覆盖"的场景。
- **N2** 不在 `@reui/core` 中加入任何 DOM 操作或 UI 框架依赖。
- **N3** 不实现复杂表单弹窗（如多字段输入）。本期仅支持文本输入框（`prompt`）作为最简表单；复杂表单仍应作为 overlay 插件实现。
- **N4** 不开放系统层给普通插件作为渲染容器（普通插件仍只能位于 hud/panel/overlay）。系统层**专属于 Runtime SystemUIService**。
- **N5** 不在本 RFC 引入新的协议版本（仍为 `version: 1`，仅扩展 method 与 capability）。
- **N6** 不实现持久化的"通知中心"。所有通知都是**瞬时**的，关闭即销毁。

---

## 3. 整体架构

```
┌────────────────────────── Runtime（宿主页面） ──────────────────────────┐
│                                                                       │
│  ┌─────────────────┐    ┌────────────────────┐    ┌────────────────┐  │
│  │ PostMessage     │    │ SystemUIService     │    │  LayerSystem   │  │
│  │ Router          │───→│ (Singleton)         │───→│  System Layer  │  │
│  │  + capability   │    │  • notify()         │    │  z-index 400+  │  │
│  │  + 路由分发      │    │  • confirm()        │    │  (DOM 容器)    │  │
│  └─────────────────┘    │  • alert()          │    └────────────────┘  │
│         ▲                │  • prompt()         │                       │
│         │                │  • toast()          │                       │
│         │                │  • notifQueue       │                       │
│         │                │  • dialogStack      │                       │
│         │                └────────────────────┘                       │
└─────────┼──────────────────────────────────────────────────────────────┘
          │ reui:request {method:"system:*"}
          │ reui:response {success/dismissed}
          │ reui:push     {event:"system:*"}
          │
┌─────────┼─────────── 任意子页面 iframe（Vue/React/纯 HTML） ───────────┐
│         ▼                                                              │
│  @reui/core                                                            │
│   └── system (薄包装)                                                  │
│        • notify()  • confirm()  • alert()  • prompt()  • toast()      │
└────────────────────────────────────────────────────────────────────────┘
```

**架构要点：**

1. **System 层独立于 HUD/Panel/Overlay**：它不是"另一种插件"，而是 Runtime 自己控制的 DOM 区域，不创建 iframe，没有沙箱越界问题，可以直接调用游戏的 `SetNuiFocusInput`。
2. **Core 仍是纯通讯 SDK**：`@reui/core/system` 仅是 5–6 个 `client.request()` 的薄包装，不引入任何 DOM 操作或 UI 框架。
3. **唯一渲染权**：所有系统级 UI 元素都在 Runtime 主文档中渲染，避免 iframe 边界限制。
4. **可选承载方式**：System 层的具体渲染既可以是 Runtime 内置的轻量原生实现（Phase A），也可以由 Runtime **预置加载**的 `@reui/framework` 实例承载（Phase B，可选优化）；对调用方完全透明。

---

## 4. 详细设计

### 4.1 LayerSystem 扩展

在 RFC-002 §3.5 的基础上新增 **System 层**：

| 层级 | z-index 范围 | 可见性 | 输入行为 | 管理模式 | 来源 |
|------|-------------|--------|----------|----------|------|
| HUD | 100-199 | 始终可见 | `pointer-events: none` | 独立并存 | 普通插件 iframe |
| Panel | 200-299 | 按需切换 | `SetNuiFocusInput(true)` | 互斥 | 普通插件 iframe |
| Overlay | 300-399 | 栈式弹出 | 遮罩阻止下层 | 栈式管理 | 普通插件 iframe |
| **System** | **400-499** | **按需弹出** | **dialog 时拦截输入；toast/notif 鼠标穿透** | **队列 + 栈** | **Runtime 内部 DOM** |

#### 4.1.1 LayerType 枚举扩展

```typescript
// runtime/src/layer/types.ts
export type LayerType = 'hud' | 'panel' | 'overlay' | 'system';
```

> **重要：** `system` 层**不向 `plugin.json` 开放**——`PluginManifest.layer` 的 Zod Schema 仍然只接受 `'hud' | 'panel' | 'overlay'`（与 RFC-002 §3.1.1 保持一致）。任何插件配置 `layer: 'system'` 的 plugin.json 都会被服务端 Schema 校验拒绝。

#### 4.1.2 LayerSystem API 扩展

```typescript
class LayerSystem {
  // … 现有字段
  private systemLayer: HTMLDivElement;  // z-index 400-499 容器

  /** 由 SystemUIService 在初始化时调用一次，将其根 DOM 节点挂入 system 层 */
  mountSystemRoot(root: HTMLElement): void;

  /** 进入"对话框"焦点模式：dialog/prompt/confirm 弹出时调用 */
  acquireSystemFocus(): void;

  /** 离开焦点模式：所有系统对话框关闭后调用 */
  releaseSystemFocus(): void;
}
```

**焦点策略：**

- 当 SystemUIService 弹出 `dialog / confirm / alert / prompt` 时，调用 `acquireSystemFocus()`：
  - 设置 system 层 `pointer-events: auto`；
  - 调用 NuiBridge `setCursorVisible(true)` 与 FiveM `SetNuiFocusInput(true, true)`；
  - **不影响**底下 Panel / Overlay 的 z-index 与栈状态——系统层只是覆盖在最上层。
- 关闭最后一个对话框后调用 `releaseSystemFocus()`：
  - 还原 system 层 `pointer-events: none`；
  - 焦点归还策略：
    - 若 Overlay 栈非空，焦点保持在 Overlay 层；
    - 否则若 Panel 处于 active，焦点保持在 Panel 层；
    - 否则 `SetNuiFocusInput(false, false)` 归还游戏。
- `notification / toast` 不调用 `acquireSystemFocus`，始终鼠标穿透。

---

### 4.2 SystemUIService（Runtime 单例）

```typescript
// runtime/src/services/system-ui.ts

export type NotificationLevel = 'info' | 'success' | 'warning' | 'danger';

export interface NotifyParams {
  message: string;                    // 必填
  title?: string;
  level?: NotificationLevel;          // 默认 'info'
  duration?: number;                  // 单位 ms，默认 4000；0 = 不自动消失
  icon?: string;                      // 图标 key（由主题预定义）
  action?: { label: string; eventName: string };  // 可选行动按钮，点击后通过 EventBus 推送
}

export interface DialogParams {
  title?: string;
  message: string;
  level?: NotificationLevel;          // 默认 'info'
  okText?: string;                    // 默认 "确定"
  cancelText?: string;                // 默认 "取消"
  dismissible?: boolean;              // 默认 true，false 时点击遮罩/ESC 不关闭
}

export interface PromptParams extends DialogParams {
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;                 // 默认 200
  inputType?: 'text' | 'password';    // 默认 'text'
}

export interface ToastParams {
  message: string;
  level?: NotificationLevel;          // 默认 'info'
  duration?: number;                  // 默认 2000ms
}

interface ActiveItem {
  id: string;                         // SystemUIService 内部 uid
  pluginId: string;                   // 触发该 UI 的插件
  kind: 'notify' | 'toast' | 'dialog';
}

export class SystemUIService {
  private static instance: SystemUIService;
  private notifQueue: ActiveItem[] = [];     // 通知队列（最多同时 5 条）
  private dialogStack: ActiveItem[] = [];    // 对话框栈（modal，互斥显示）
  private layerSystem: LayerSystem;
  private eventBus: EventBus;

  static getInstance(): SystemUIService;

  // ─── 通知（fire-and-forget，立即 resolve） ───
  notify(pluginId: string, params: NotifyParams): { id: string };

  // ─── 轻提示 ───
  toast(pluginId: string, params: ToastParams): void;

  // ─── 对话框（async，等待用户操作） ───
  alert(pluginId: string, params: DialogParams): Promise<void>;
  confirm(pluginId: string, params: DialogParams): Promise<boolean>;
  prompt(pluginId: string, params: PromptParams): Promise<string | null>;

  // ─── 主动关闭（如插件取消、热重载、卸载等） ───
  dismiss(id: string): boolean;                 // 关闭单条通知/对话框
  dismissAllForPlugin(pluginId: string): void;  // 插件卸载时清理（PluginManager 调用）

  // ─── 用户行为事件（推送给 EventBus） ───
  // 'system:notification:action' 当 notify 含 action 且用户点击时
  // 'system:notification:dismissed' 用户手动关闭时
}
```

**实现关键点：**

| 点 | 行为 |
|----|------|
| 通知队列 | 同时最多展示 5 条 notification（自上而下堆叠），超出排队等待。`duration: 0` 的通知不计入超时但仍占据一个槽位 |
| 对话框栈 | `dialog/confirm/alert/prompt` 同一时刻**只显示栈顶一个**，后续请求排队。栈顶关闭后弹出下一个 |
| 用户取消 | `confirm` 用户点取消 → resolve `false`；`prompt` 用户取消 → resolve `null`；`alert` 用户关闭 → resolve `void` |
| 强制关闭（dismissAllForPlugin） | 进行中的 dialog/confirm/prompt 触发 `DIALOG_DISMISSED` 错误响应，让插件的 `await confirm()` 抛 `ReUIError(DIALOG_DISMISSED)` |
| 重复防抖 | 同一插件 1 秒内重复发送相同 `notify` 内容自动合并（仅刷新存在的那条的 duration） |
| 跨插件隔离 | 每条系统 UI 都关联 `pluginId`，PluginManager 在卸载插件时调用 `dismissAllForPlugin` |

#### 4.2.1 对话框渲染策略（Phase A vs Phase B）

| 方案 | 说明 | 取舍 |
|------|------|------|
| **Phase A：原生 DOM + SCSS** | Runtime 直接 `document.createElement` 渲染对话框、通知、Toast，使用 `@reui/framework` 已有的 Design Token CSS 变量 | ✅ 零额外依赖、体积最小、最稳定<br>❌ 视觉与 framework 组件可能微小差异 |
| **Phase B：Runtime 预加载 framework** | Runtime 内嵌 React + `@reui/framework`，将 `Dialog/Notification` 渲染到 system 层 | ✅ 视觉完全统一<br>❌ Runtime 强依赖 React |

**默认采用 Phase A**。Phase B 作为后续可选优化，**对外接口不变**，由 SystemUIService 内部决定实现方式。

---

### 4.3 协议扩展（在 RFC-001 method 注册表上新增）

#### 4.3.1 新增 method（`system:*`）

| method | params | response | 是否需要响应 | 错误码 |
|--------|--------|----------|------|--------|
| `system:notify` | `NotifyParams` | `{ id: string }` | 是（立即返回 id） | `INVALID_PARAMS` |
| `system:toast` | `ToastParams` | `void` | 否（fire-and-forget，使用 `reui:notify`） | — |
| `system:alert` | `DialogParams` | `void`（用户关闭后 resolve） | 是（异步） | `DIALOG_DISMISSED`, `SYSTEM_BUSY` |
| `system:confirm` | `DialogParams` | `{ ok: boolean }` | 是（异步） | `DIALOG_DISMISSED`, `SYSTEM_BUSY` |
| `system:prompt` | `PromptParams` | `{ value: string \| null }` | 是（异步） | `DIALOG_DISMISSED`, `SYSTEM_BUSY` |
| `system:dismiss` | `{ id: string }` | `{ dismissed: boolean }` | 是 | — |

**说明：**

- `system:notify` 立即返回 `id` 给调用方，方便后续 `system:dismiss` 主动关闭（如 long-running 任务进度通知）。
- `system:toast` 使用 `reui:notify`（fire-and-forget）通道发送，不占用 request id；这是与现有协议（RFC-001 §3.1）一致的"通知"语义。
- `confirm` 的 `cancel` 视为正常返回 `{ok: false}`，**不产生错误**；只有外部强制关闭（插件卸载、热重载、`dismissAllForPlugin`）才返回 `DIALOG_DISMISSED` 错误。

#### 4.3.2 新增推送事件（`system:*`，走 SystemEventRegistry）

| event | payload | 触发时机 |
|-------|---------|----------|
| `system:notification:action` | `{ id, eventName }` | notify 含 action 且用户点击其按钮时（仅推送给发起插件） |
| `system:notification:dismissed` | `{ id, reason: 'auto' \| 'user' \| 'plugin' }` | notify 关闭时（仅推送给发起插件） |

**事件分发与 RFC-003 §3.5 一致：** `system:` 命名空间纳入 `SystemEventRegistry`，PostMessageRouter 在 `event:subscribe` 路由时增加 `case 'system'` 分支。

#### 4.3.3 错误码扩展

在 RFC-001 §4.2 的基础上新增：

| Code | 含义 | 触发条件 |
|------|------|----------|
| `DIALOG_DISMISSED` | 对话框被外部强制关闭 | 插件卸载 / 热重载 / 主动 `dismiss` 进行中的 dialog |
| `SYSTEM_BUSY` | 系统 UI 服务繁忙 | 超过队列上限（如 dialogStack 长度 > 8）时拒绝新请求 |

#### 4.3.4 capability（在 RFC-002 §3.1.1 permissions 列表上新增）

| capability | 允许调用的 method |
|------------|-------------------|
| `runtime.notification` | `system:notify`、`system:toast`、`system:dismiss`（仅自身发起的 id） |
| `runtime.dialog` | `system:alert`、`system:confirm`、`system:prompt` |
| `runtime.all` | 上述全部（已存在，无需变更） |

**默认策略：** 普通 HUD/Panel 插件应**显式声明** `runtime.notification` 才能调用 toast/notify；`runtime.dialog` 属于较强权限，建议仅授予明确需要的插件，CLI 在 `reui sign` 时对包含 `runtime.dialog` 的插件标记为"高权限"（参考 RFC-005）。

---

### 4.4 PostMessageRouter 集成

按 RFC-001 §3.3 的 handler 注册模式扩展：

```typescript
// runtime/src/router/system-handlers.ts
import { SystemUIService } from '../services/system-ui';
import { ReUIError, ErrorCode } from '../errors';

export function registerSystemHandlers(router: PostMessageRouter): void {
  const svc = SystemUIService.getInstance();

  router.registerHandler('system:notify', (plugin, msg) => {
    requireCapability(plugin, 'runtime.notification', msg);
    const { id } = svc.notify(plugin.id, msg.params as NotifyParams);
    router.sendSuccess(plugin, msg.id, { id });
  });

  router.registerHandler('system:toast', (plugin, msg) => {
    requireCapability(plugin, 'runtime.notification', msg);
    svc.toast(plugin.id, msg.params as ToastParams);
    // toast 通过 reui:notify 进入，无需响应
  });

  router.registerHandler('system:alert', async (plugin, msg) => {
    requireCapability(plugin, 'runtime.dialog', msg);
    try {
      await svc.alert(plugin.id, msg.params as DialogParams);
      router.sendSuccess(plugin, msg.id, undefined);
    } catch (err) {
      router.sendError(plugin, msg.id, toErrorPayload(err));
    }
  });

  router.registerHandler('system:confirm', async (plugin, msg) => {
    requireCapability(plugin, 'runtime.dialog', msg);
    try {
      const ok = await svc.confirm(plugin.id, msg.params as DialogParams);
      router.sendSuccess(plugin, msg.id, { ok });
    } catch (err) {
      router.sendError(plugin, msg.id, toErrorPayload(err));
    }
  });

  router.registerHandler('system:prompt', async (plugin, msg) => {
    requireCapability(plugin, 'runtime.dialog', msg);
    try {
      const value = await svc.prompt(plugin.id, msg.params as PromptParams);
      router.sendSuccess(plugin, msg.id, { value });
    } catch (err) {
      router.sendError(plugin, msg.id, toErrorPayload(err));
    }
  });

  router.registerHandler('system:dismiss', (plugin, msg) => {
    // 不要求 capability：插件总能关闭自己发起的 UI
    // SystemUIService 内部校验 id 归属
    const { id } = msg.params as { id: string };
    if (!svc.belongsTo(id, plugin.id)) {
      router.sendError(plugin, msg.id, {
        code: ErrorCode.PERMISSION_DENIED,
        message: 'Cannot dismiss UI item owned by another plugin',
      });
      return;
    }
    const dismissed = svc.dismiss(id);
    router.sendSuccess(plugin, msg.id, { dismissed });
  });
}
```

**`event:subscribe` 路由扩展（RFC-003 §3.5.2）：** 增加 `case 'system'` 分支，调用 `systemEventRegistry.register(plugin.id, event)` 并由 SystemUIService 在内部触发时仅推送给对应 `pluginId` 的 iframe。

---

### 4.5 PluginManager 集成

按 RFC-002 §3.4 的生命周期扩展：

```typescript
// runtime/src/plugin/manager.ts (片段)

async unload(pluginId: string, reason: UnloadReason): Promise<void> {
  // … 现有逻辑：通知 plugin:beforeUnload、保存状态、销毁 iframe

  // 新增：清理该插件的所有系统 UI
  SystemUIService.getInstance().dismissAllForPlugin(pluginId);

  // … 现有逻辑：清理 EventBus、HeartbeatMonitor、订阅
}
```

**插件崩溃（heartbeat 超时）触发 `plugin:crashed` 时同样调用 `dismissAllForPlugin`。**

---

### 4.6 @reui/core SDK 模块

```typescript
// @reui/core/src/system.ts

import { Client } from './client';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'danger';

export interface NotifyOptions {
  title?: string;
  level?: NotificationLevel;
  duration?: number;          // 0 = 不自动消失
  icon?: string;
  action?: { label: string; eventName: string };
}

export interface DialogOptions {
  title?: string;
  level?: NotificationLevel;
  okText?: string;
  cancelText?: string;
  dismissible?: boolean;
}

export interface PromptOptions extends DialogOptions {
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  inputType?: 'text' | 'password';
}

export interface ToastOptions {
  level?: NotificationLevel;
  duration?: number;
}

export interface NotificationHandle {
  /** 系统级 id，可用于后续 dismiss 或匹配 action 事件 */
  id: string;
  /** 主动关闭该通知 */
  dismiss(): Promise<void>;
}

export class ReUISystem {
  private client: Client;
  constructor(client: Client) { this.client = client; }

  /**
   * 推送一条全局通知（顶部堆叠，自动消失）
   * @example
   * const n = await system.notify('已保存', { level: 'success' });
   * // long-running 任务结束后主动关闭：
   * await n.dismiss();
   */
  async notify(message: string, options?: NotifyOptions): Promise<NotificationHandle> {
    const { id } = await this.client.request<{ id: string }>('system:notify', {
      message, ...options,
    });
    return {
      id,
      dismiss: () => this.client.request('system:dismiss', { id }).then(() => undefined),
    };
  }

  /**
   * 轻提示（fire-and-forget，不等待响应）
   * @example system.toast('已复制');
   */
  toast(message: string, options?: ToastOptions): void {
    // 使用 client.notify（reui:notify）而非 request
    this.client.notify('system:toast', { message, ...options });
  }

  /**
   * 弹出告警对话框，等待用户关闭
   * @example await system.alert('保存失败：网络异常');
   */
  async alert(message: string, options?: DialogOptions): Promise<void> {
    await this.client.request('system:alert', { message, ...options });
  }

  /**
   * 弹出确认对话框
   * @returns 用户点确定 → true；用户点取消 → false；外部强制关闭 → 抛 ReUIError(DIALOG_DISMISSED)
   * @example
   * const ok = await system.confirm('确定删除？', { level: 'danger' });
   * if (!ok) return;
   */
  async confirm(message: string, options?: DialogOptions): Promise<boolean> {
    const { ok } = await this.client.request<{ ok: boolean }>('system:confirm', {
      message, ...options,
    });
    return ok;
  }

  /**
   * 弹出文本输入对话框
   * @returns 用户提交 → string；用户取消 → null；外部强制关闭 → 抛 ReUIError(DIALOG_DISMISSED)
   * @example const name = await system.prompt('请输入新名称');
   */
  async prompt(message: string, options?: PromptOptions): Promise<string | null> {
    const { value } = await this.client.request<{ value: string | null }>(
      'system:prompt', { message, ...options }
    );
    return value;
  }

  /**
   * 监听 notify 中 action 按钮点击
   * @example
   * system.onNotificationAction(({ id, eventName }) => { ... });
   */
  onNotificationAction(handler: (data: { id: string; eventName: string }) => void) {
    return this.client.onPush('system:notification:action', handler as any);
  }

  /**
   * 监听通知关闭（自动消失 / 用户关闭 / 外部强制关闭）
   */
  onNotificationDismissed(
    handler: (data: { id: string; reason: 'auto' | 'user' | 'plugin' }) => void
  ) {
    return this.client.onPush('system:notification:dismissed', handler as any);
  }
}
```

**导出方式（在 `@reui/core/src/index.ts` 追加，参考 RFC-003 §5.1）：**

```typescript
import { ReUISystem } from './system';
// …
export const system = new ReUISystem(client);
export type { NotificationLevel, NotifyOptions, DialogOptions, PromptOptions,
              ToastOptions, NotificationHandle } from './system';
```

> **体积影响：** 整个 `system.ts` 模块 < 1.5 KB（minified），不引入任何 DOM/UI 框架，对 RFC-001 §7.2 的 `< 10KB gzipped` 目标无威胁。

---

### 4.7 SDK 使用示例

```typescript
import { init, system } from '@reui/core';

await init();

// ── 1. 简单提示 ──
system.toast('已保存');

// ── 2. 全局通知（带 action） ──
const handle = await system.notify('您有 3 条新消息', {
  level: 'info',
  duration: 0,                                       // 不自动消失
  action: { label: '查看', eventName: 'open-mail' },
});
system.onNotificationAction(({ eventName }) => {
  if (eventName === 'open-mail') openMailbox();
});
// long-running 任务结束后：
await handle.dismiss();

// ── 3. 确认对话框 ──
const ok = await system.confirm('确定要删除该物品吗？', {
  level: 'danger',
  okText: '删除',
  cancelText: '保留',
});
if (ok) await api.delete(itemId);

// ── 4. 输入对话框 ──
const newName = await system.prompt('请输入新角色名', {
  defaultValue: currentName,
  maxLength: 32,
});
if (newName !== null) await api.rename(newName);

// ── 5. 处理强制关闭（插件热重载时的 in-flight dialog） ──
import { ReUIError, ErrorCode } from '@reui/core';
try {
  await system.confirm('提交？');
} catch (err) {
  if (err instanceof ReUIError && err.code === ErrorCode.DIALOG_DISMISSED) {
    // 静默忽略：插件正在卸载
    return;
  }
  throw err;
}
```

---

## 5. 安全考量

### 5.1 capability 强制检查

| 调用 | 必需 capability | PostMessageRouter 检查时机 |
|------|----------------|----------------------------|
| `system:notify` / `system:toast` | `runtime.notification` 或 `runtime.all` | 每次请求 |
| `system:alert` / `system:confirm` / `system:prompt` | `runtime.dialog` 或 `runtime.all` | 每次请求 |
| `system:dismiss` | 无 capability，但 SystemUIService 内部校验 `id` 归属插件 | 每次请求 |

未声明 capability 的调用返回 `CAPABILITY_DENIED`（RFC-001 §4.2）。

### 5.2 防滥用

| 风险 | 防护 |
|------|------|
| 插件高频弹通知刷屏 | 同一插件 1s 内重复内容自动合并；通知队列上限 5 条；超出排队 |
| 插件无限堆叠 dialog | dialog 栈上限 8，超出返回 `SYSTEM_BUSY` |
| 插件用 dialog 阻塞游戏 | `acquireSystemFocus` 仅影响系统层；可由 Runtime 配置一个全局快捷键（默认 `ESC`）强制 dismiss 栈顶 dialog（仅 `dismissible: true` 的对话框响应） |
| 插件冒充其他插件关闭 UI | `system:dismiss` 校验 id 归属，跨插件 dismiss 返回 `PERMISSION_DENIED` |
| 输入数据 XSS | SystemUIService 渲染 `message / title / placeholder` 时**仅以纯文本插入**（`textContent`），禁止 HTML 解析 |

### 5.3 与游戏焦点的交互

`system:confirm` 等需要键鼠输入的对话框弹出时：

1. SystemUIService 调用 `LayerSystem.acquireSystemFocus()`；
2. LayerSystem 调用 NuiBridge 触发 `SetNuiFocusInput(true, true)`；
3. 对话框关闭后 `releaseSystemFocus()`，按 §4.1.2 的归还策略恢复焦点。

这保证：即使玩家正在游戏中（无任何 panel/overlay 打开），系统弹出 `confirm` 时也能立即获得键鼠输入；关闭后焦点正确归还游戏。

---

## 6. 测试计划

### 6.1 单元测试（SystemUIService）

| 测试用例 | 预期结果 |
|----------|----------|
| `notify` 同时插入 6 条 | 5 条立即显示，1 条排队，关闭任意一条后排队的弹出 |
| 同插件 1s 内重复 `notify` 相同 message | 仅刷新 duration，不创建新条目 |
| `confirm` 用户点确定 | resolve `true` |
| `confirm` 用户点取消 | resolve `false`，**无错误抛出** |
| `prompt` 用户提交空字符串 | resolve `''` |
| `prompt` 用户取消 | resolve `null` |
| 进行中的 `confirm` + `dismissAllForPlugin(pluginId)` | reject `ReUIError(DIALOG_DISMISSED)` |
| dialog 栈达到 8 时再 push | 返回 `SYSTEM_BUSY` |
| `dismiss(id)` 跨插件调用 | `belongsTo` 返回 false，触发 `PERMISSION_DENIED` |
| `notify` 含 action 用户点击 | `system:notification:action` 推送到发起插件，含 `id`/`eventName` |
| `notify` 自动消失 | `system:notification:dismissed` 推送 `reason: 'auto'` |

### 6.2 集成测试

| 场景 | 验证点 |
|------|--------|
| 子页面 `system.confirm()` → Runtime 渲染对话框 → 用户点确定 → 子页面 await 返回 `true` | 完整 RPC 链路 |
| 子页面 capability 不含 `runtime.dialog` 调用 `confirm` | reject `CAPABILITY_DENIED`，UI 未弹出 |
| 插件热重载（unload + reload）时进行中的 `prompt` | 旧调用 reject `DIALOG_DISMISSED`，新插件起来后能正常调用 |
| 插件崩溃（heartbeat 超时）时进行中的 `confirm` | 自动 `dismissAllForPlugin`，对话框消失，插件状态进入 `error` |
| 系统 dialog 弹出 → `SetNuiFocusInput(true)` → 关闭 → 焦点正确归还（无 overlay/panel 时归还游戏） | LayerSystem 焦点归还策略 |
| 通知含 action 用户点击 → `system:notification:action` 仅发到发起插件，其他插件不收到 | SystemEventRegistry 隔离 |

### 6.3 边界测试

- 1000 字符的 `message`（应被自动截断到 800 字符并加省略号，避免覆盖屏幕）
- 同一插件并发发起 10 个 `confirm`：栈式排队，按 FIFO 弹出
- `prompt` 输入 `<script>alert(1)</script>`：textContent 插入，不执行
- 对话框 `dismissible: false` + 全局 ESC：拒绝关闭

---

## 7. 验收标准

### 7.1 功能验收

- [ ] LayerSystem 新增 `system` 层，z-index 400-499，独立于 hud/panel/overlay
- [ ] `PluginManifest.layer` 的 Schema **不接受** `'system'`
- [ ] `system:notify / toast / alert / confirm / prompt / dismiss` 六个 method 全部注册到 PostMessageRouter
- [ ] `runtime.notification` 与 `runtime.dialog` capability 在 PostMessageRouter 正确执行
- [ ] `confirm` 用户取消返回 `{ok: false}` 而**非**错误
- [ ] 外部强制 dismiss 进行中的 dialog/prompt 时返回 `DIALOG_DISMISSED` 错误
- [ ] dialog 栈上限 8，溢出返回 `SYSTEM_BUSY`
- [ ] 通知队列上限 5，超出排队
- [ ] PluginManager.unload 调用 `SystemUIService.dismissAllForPlugin(pluginId)`
- [ ] heartbeat 超时崩溃路径同样调用 `dismissAllForPlugin`
- [ ] `@reui/core` 导出 `system` 模块，API 类型完整无 `any` 泄漏
- [ ] `system:notification:action` / `system:notification:dismissed` 仅推送给发起插件
- [ ] message/title/placeholder 渲染使用 textContent，不解析 HTML

### 7.2 性能验收

- [ ] `system:toast` 端到端延迟 < 16ms（一帧内显示）
- [ ] `system:notify` 端到端延迟 < 32ms
- [ ] `system:confirm` 弹出动画 ≤ 200ms（对齐 `animation.normal`）
- [ ] 同时存在 5 条通知 + 1 个 dialog 时无掉帧（60fps 维持）
- [ ] `@reui/core/system` 模块 minified < 1.5 KB；总包体积仍 < 10 KB gzipped

### 7.3 安全验收

- [ ] 无 `runtime.notification` 的插件调用 `system:notify` 收到 `CAPABILITY_DENIED`
- [ ] 无 `runtime.dialog` 的插件调用 `system:confirm` 收到 `CAPABILITY_DENIED`
- [ ] 跨插件 `system:dismiss` 收到 `PERMISSION_DENIED`
- [ ] HTML/script 注入测试无效（仅文本展示）
- [ ] 焦点归还在所有 corner case（多 overlay 同时存在、panel 切换中弹 dialog 等）下正确

---

## 8. 依赖关系

### 8.1 前置依赖

| RFC | 依赖内容 |
|------|----------|
| RFC-001 | `reui:request / response / push / notify` 协议、错误码体系、PostMessageRouter handler 注册 |
| RFC-002 | LayerSystem（扩展新增 system 层）、PluginManager 卸载钩子、capability 权限模型 |
| RFC-003 | EventBus（系统事件分发）、SystemEventRegistry（`system:` 命名空间分流）、ReUIError/ErrorCode |

### 8.2 对其他组件的影响

| 组件 | 影响 |
|------|------|
| `LayerSystem` | 新增 system 层 + `acquireSystemFocus / releaseSystemFocus` |
| `PostMessageRouter` | 注册 6 个 handler、`event:subscribe` 增加 `system` 分支 |
| `PluginManager` | unload / crash 路径调用 `dismissAllForPlugin` |
| `@reui/core` | 新增 `system` 模块导出，`Client` 增加 `notify(method, params)` 公开方法（用于 toast） |
| RFC-002 plugin.json Schema | `permissions` 枚举新增 `runtime.notification`、`runtime.dialog`（后者已在 RFC-002 §3.1.1 列出，本 RFC 落实其语义） |
| RFC-005 CLI（`reui sign`） | `runtime.dialog` 列为高权限，签名时交互确认（与现有 `runtime.all`、`plugins.all` 同级） |

### 8.3 实现顺序

```
1. SystemUIService 单例（DOM 渲染 + 队列/栈管理）— 独立可单测
2. LayerSystem 扩展 system 层 + 焦点管理
3. PostMessageRouter 注册 system:* handler + capability 检查
4. SystemEventRegistry 增加 'system' 命名空间分支
5. PluginManager.unload / heartbeat 崩溃路径接入 dismissAllForPlugin
6. @reui/core/system 模块（薄包装）
7. 集成测试 + 验收清单
```

---

## 附录 A：method 速查表（与 RFC-001 §4.1 对齐）

| method | params | response | capability | 通道 |
|--------|--------|----------|------------|------|
| `system:notify` | `NotifyParams` | `{id: string}` | `runtime.notification` | `reui:request` |
| `system:toast` | `ToastParams` | — | `runtime.notification` | `reui:notify` |
| `system:alert` | `DialogParams` | `void` | `runtime.dialog` | `reui:request` |
| `system:confirm` | `DialogParams` | `{ok: boolean}` | `runtime.dialog` | `reui:request` |
| `system:prompt` | `PromptParams` | `{value: string\|null}` | `runtime.dialog` | `reui:request` |
| `system:dismiss` | `{id: string}` | `{dismissed: boolean}` | — (内部归属校验) | `reui:request` |

## 附录 B：事件速查表（与 RFC-003 §3.5 命名空间一致）

| SDK API | 实际 event | 路由目标 |
|---------|-----------|---------|
| `system.onNotificationAction(...)` | `system:notification:action` | SystemEventRegistry → 仅发起插件 |
| `system.onNotificationDismissed(...)` | `system:notification:dismissed` | SystemEventRegistry → 仅发起插件 |

## 附录 C：与 RFC-004 framework 反馈组件的关系

| 维度 | `@reui/framework` `Toast/Dialog/Notification` | `@reui/core` `system.*` |
|------|-----------------------------------------------|--------------------------|
| 渲染位置 | iframe **内部**（仅自身可见区域） | Runtime 主文档 system 层（覆盖全屏） |
| 强制依赖 | 需要引入 framework + React | 仅 `@reui/core`（任何技术栈可用） |
| 适合场景 | 插件自身界面内的反馈（如表单校验提示） | 跨 iframe / 全屏覆盖 / 系统级提示 |
| 视觉一致性 | 与 framework 其他组件对齐 | 与 framework 共享 Design Token CSS 变量 |
| 关闭对其他插件影响 | 无 | 无（每个 UI 项关联 pluginId，独立管理） |

**最佳实践：**
- 表单输入校验、loading、局部 toast → `@reui/framework`
- 跨插件通知、删除确认、系统警告、long-running 任务进度 → `@reui/core/system.*`

## 附录 D：完整消息流示例（system:confirm）

```
 1. 插件代码：const ok = await system.confirm('删除？', {level:'danger'});
 2. ReUISystem.confirm() 调用 client.request('system:confirm', { message:'删除？', level:'danger' })
 3. Client 生成 id="inventory:42"，发送 reui:request 到 parent
 4. MessageDispatcher 验证来源 → PostMessageRouter
 5. PostMessageRouter 验证 version=1 ✓，capability 含 'runtime.dialog' ✓
 6. 路由到 system:confirm handler → SystemUIService.confirm('inventory', params)
 7. SystemUIService 创建 ActiveItem 入栈 → DOM 渲染对话框 → LayerSystem.acquireSystemFocus()
 8. 用户点"确定" → resolve(true) → handler sendSuccess(plugin, "inventory:42", { ok: true })
 9. dialogStack 弹出该 item，若栈空 → LayerSystem.releaseSystemFocus()
10. 子页面 Client 收到 response → 匹配 pendingRequests["inventory:42"] → resolve {ok:true}
11. ReUISystem.confirm() 返回 true 给插件代码
```
