# RFC-007: Phase 3.6 — 插件导出与跨插件 RPC

| 字段 | 值 |
|------|-----|
| **RFC 编号** | 007 |
| **标题** | 插件导出系统与跨插件 / Lua RPC（Plugin Exports & Cross-Plugin RPC） |
| **状态** | Draft |
| **作者** | ReUI Team |
| **创建日期** | 2026-05-29 |
| **依赖** | RFC-001 (通讯协议)、RFC-002 (插件系统 / 权限模型)、RFC-003 (Runtime 服务) |
| **被依赖** | 任何希望提供"被其他插件调用"能力的业务插件、希望调用 NUI 插件方法的 Lua 资源 |

---

## 1. 背景与动机

RFC-001 定义了 iframe ↔ Runtime 的 Request/Response 协议，RFC-002 定义了 `plugin:message` 这一**最小**的跨插件消息通道（并预留了 `plugins.<id>` 权限），但并未定义：

1. 插件**如何声明**自己想要暴露给外界的方法；
2. 调用方**如何发现 / 调用**目标插件的方法；
3. 游戏端 **Lua 代码如何调用** NUI 插件中的方法（与 FiveM 原生 `exports['resource']:func()` 类似的体验）。

如果不提供这一层，业务插件只能各自约定 `plugin:message` 的 payload 格式，缺乏类型安全、缺乏权限边界、无法做发现与回应映射。常见痛点：

1. **分散重复**：A 插件想用 B 插件的"获取库存物品数量"逻辑，需要 B 自行约定一组事件名 + ack 协议，重复造轮子；
2. **无类型契约**：调用方无法知道目标方法的入参/返回值结构，只能对照文档手工拼 payload；
3. **权限粗糙**：`plugins.<id>` 只能控制"能否给插件 X 发消息"，无法精确到"X 的哪个方法"；
4. **Lua 缺位**：脚本想要刷新 HUD 的某个状态，目前必须经由 EventBus 广播事件，无法直接"调用并取回返回值"；
5. **生命周期混乱**：调用方在 in-flight 期间被调用插件被卸载/崩溃，没有统一的错误回收。

**本 RFC 的解决思路：** 在 RFC-001 的 Request/Response 协议之上构建一层**Plugin Exports 系统**——参考 FiveM 原生 `exports`、JSON-RPC 与 ES 装饰器，统一以下三件事：

- 在 `@reui/core` 中提供 `exports.expose(...)` 装饰器与 `exports.register(...)` 命令式 API，让插件**声明性地**暴露方法；
- 在 Runtime 中提供 `ExportRegistry` 单例，承载所有插件的导出方法注册表，并通过 `exports:invoke` 进行跨 iframe 路由；
- 在游戏端通过一个 ReUI 自带的桥接 resource 暴露 `exports['reui']:invokePlugin(pluginId, method, args, cb)`，把 Lua → NUI 插件方法的调用打通。

---

## 2. 目标与非目标

### 2.1 目标

- **G1** 在 `@reui/core` 中暴露 `exports` 模块：
  - `exports.expose(options?)` —— TypeScript（stage-3 / legacy）装饰器，标注类的方法为可导出；
  - `exports.register(map)` —— 命令式 API，用于不愿启用装饰器的项目；
  - `exports.invoke(pluginId, method, ...args)` —— 调用其他插件已导出的方法，返回 `Promise`。
- **G2** 在 Runtime 中实现 **`ExportRegistry`**（单例）：
  - 接收 `exports:register` 上报，维护 `Map<pluginId, Map<method, ExportMeta>>`；
  - 路由 `exports:invoke`：捕获调用方 → 查表 → 转发到目标插件 → 等响应 → 回传调用方；
  - 在插件卸载/崩溃/热重载时**原子替换**注册项，并 reject 进行中的调用。
- **G3** 提供与 RFC-001/RFC-002 一致的**权限模型**：
  - 调用方需要 `exports.call.<targetPluginId>` 或 `exports.call.*`（与 `plugins.<id>` 复用同一语义）；
  - 被调用方需要 `exports.expose` 才能注册导出（防止低权限插件意外暴露 API）；
  - 每个 `@expose` 可以在装饰器层显式声明 `requireRoles` / `requirePermissions`，由 ExportRegistry 在转发前再校验调用方上下文。
- **G4** 提供 **Lua 桥接**：ReUI 自带 resource 暴露 `exports['reui']:invokePlugin(...)`，覆盖以下两个方向：
  - **Lua → NUI 插件**：等价于 iframe → iframe 的 `exports.invoke`；
  - **NUI 插件 → Lua**（可选 stretch）：不在本期目标，留给 RFC-002 的 `nui:send` 解决。
- **G5** 错误处理与 RFC-001 §4.2 一致：超时、未知 method、目标插件不存在、调用方权限不足、目标插件崩溃等，均映射到结构化错误码。
- **G6** 类型推断：当调用方与被调用方在同仓库时，提供**可选的**类型工具 `ExposedOf<T>` 让 `exports.invoke<typeof T>(...)` 在 IDE 中获得入参与返回类型提示。
- **G7** 不引入新协议版本（仍为 `version: 1`）。仅在 method 命名空间增加 `exports:`，capability 列表增加 `exports.*`。

### 2.2 非目标

- **N1** 不取代 EventBus（RFC-003）。Exports 是**点对点 RPC**；广播 / 订阅仍由 EventBus 负责。
- **N2** 不引入流式 RPC（双向流、Server-Sent）——本期仅支持 Request/Response。如需流，可由调用方订阅 EventBus + Exports 触发。
- **N3** 不实现跨进程 / 跨服务器的 Exports。本系统仅在**同一玩家客户端**的 NUI / Lua 之间路由。
- **N4** 不强制使用 TypeScript 装饰器。装饰器仅是糖；底层始终是 `exports.register({...})`。
- **N5** 不在 Runtime 中执行业务逻辑。Runtime 只做**路由 + 权限**，方法实现仍在被调用插件 iframe 内执行。
- **N6** 不实现自动生成 `.d.ts` 契约文件（虽然可在 RFC-005 CLI 中追加 `reui exports gen`，本 RFC 仅约定运行时行为）。
- **N7** 不允许循环依赖死锁的 100% 防护——本期仅做超时与开发模式 warn，更严格的回路检测留给后续 RFC。

---

## 3. 整体架构

```
┌──────────────────────────────────── Runtime（宿主页面） ────────────────────────────────────┐
│                                                                                            │
│   ┌──────────────────┐     ┌──────────────────────┐     ┌────────────────────────────┐     │
│   │ PostMessage      │     │  ExportRegistry       │     │  PluginManager (RFC-002)   │     │
│   │ Router           │────▶│  (Singleton)          │◀────│  • 卸载/崩溃 → 失效注册   │     │
│   │  + capability    │     │  • register(plg, ms)  │     │                            │     │
│   │  + 路由分发       │     │  • invoke(src, dst,m) │     └────────────────────────────┘     │
│   └─────▲────────────┘     │  • drop(plg)          │                                         │
│         │                  └──────────────────────┘                                         │
│         │ reui:request {method:"exports:invoke"}                                            │
│         │ reui:request {method:"exports:register"}                                          │
│         │ reui:response                                                                     │
│         │                                                                                   │
└─────────┼──────────────────────────┬──────────────────────────────────────────────────────┘
          │                          │
┌─────────┼──── A: 任意子页面 iframe ┼─────────┐    ┌─── B: 目标插件 iframe ─────────────┐
│         ▼                          ▼          │    │                                    │
│  @reui/core                                   │    │  @reui/core                        │
│   └── exports                                 │    │   └── exports                      │
│        • invoke(plg, m, args) ──── reui:invoke│───▶│        • registered handlers       │
│        • register(...)                        │    │        • @expose() 装饰过的方法    │
│        • @expose 装饰器                       │    │                                    │
└───────────────────────────────────────────────┘    └────────────────────────────────────┘

          ▲
          │ exports['reui']:invokePlugin(plg, m, args, cb)
          │
┌─────────┴───────── 游戏端 Lua（ReUI 自带桥接 resource） ──────────┐
│                                                                  │
│  resource: reui   (server.lua / client.lua)                      │
│   • exports['reui']:invokePlugin(plg, method, args, cb)          │
│       → SendNUIMessage('reui:lua-invoke', {reqId, plg, m, args}) │
│   • RegisterNUICallback('reui:lua-invoke-result', ...)           │
└──────────────────────────────────────────────────────────────────┘
```

**架构要点：**

1. **薄路由层**：Runtime 只维护 `pluginId → method → ownerWindow` 的映射；真正的方法体始终在被调用 iframe 内执行（与 RFC-001 §3.5 的精神一致）。
2. **复用 Request/Response**：`exports:invoke` 是一次普通 `reui:request`，由 PostMessageRouter 路由到 ExportRegistry 这个特殊 handler；ExportRegistry 再以 `reui:request` 转发给目标 iframe；目标 iframe 的响应再原路返回——一次跨插件调用 = 两个 RFC-001 请求的链路串联。
3. **权限两段式**：调用方在请求阶段过 `exports.call.<target>`；目标 iframe 在执行阶段过 `exports.expose`（注册时一次性校验，不在每次 invoke 校验）。
4. **Lua 桥接**：通过自带 resource 用 `SendNUIMessage` 注入 Lua 调用，NUI 端的 Runtime 把它当成"虚拟调用方"再走 ExportRegistry。
5. **生命周期与 PluginManager 同源**：插件卸载/崩溃由 PluginManager 驱动，ExportRegistry 仅订阅 `plugin:crashed` / `plugin:beforeUnload` 事件。

---

## 4. 详细设计

### 4.1 协议扩展

在 RFC-001 §4.1 method 注册表上新增 `exports:` 命名空间：

| method | 方向 | params | response | 是否需要响应 | 错误码 |
|--------|------|--------|----------|-------------|--------|
| `exports:register` | iframe → Runtime | `{ methods: ExportDecl[] }` | `{ accepted: string[] }` | 是 | `CAPABILITY_DENIED`、`INVALID_PARAMS` |
| `exports:invoke` | iframe → Runtime → 目标 iframe | `{ target: string; method: string; args: unknown[] }` | `unknown`（透传目标返回） | 是 | `EXPORT_NOT_FOUND`、`PLUGIN_NOT_LOADED`、`EXPORT_RELOADED`、`TIMEOUT` 等 |
| `exports:list` | iframe → Runtime | `{ target?: string }` | `{ entries: ExportListEntry[] }` | 是 | — |
| `exports:unregister` | iframe → Runtime | `{ methods: string[] }` | `{ accepted: string[] }` | 是 | — |

> `exports:invoke` 在 Runtime 内不会原样转发到目标 iframe；ExportRegistry 会**重新打包**为 `exports:__dispatch`（保留请求方信息）发送给目标，避免 method 名冲突。

```typescript
// runtime/src/router/types.ts
export interface ExportDecl {
  method: string;                // 仅允许 [a-zA-Z][\w.-]*，最长 64 字符
  description?: string;          // 仅用于 exports:list 展示
  requireRoles?: string[];       // 调用方必须满足的角色（OR）
  requirePermissions?: string[]; // 调用方必须具备的权限（AND，使用 RFC-002 的格式）
}

export interface ExportListEntry {
  pluginId: string;
  method: string;
  description?: string;
}
```

#### 4.1.1 在目标 iframe 内的二次请求格式

ExportRegistry 转发到目标 iframe 时使用专属 method：

```typescript
interface DispatchRequest {
  type: 'reui:request';
  version: 1;
  id: string;                    // Runtime 重新生成的 id（不复用调用方 id）
  method: 'exports:__dispatch';
  params: {
    method: string;              // 实际要调用的导出方法名
    args: unknown[];
    callerPluginId: string;      // 调用方插件 id（'__lua' 表示 Lua）
    callerRoles: string[];       // 仅供调试 / 审计；权限由 Runtime 已校验
  };
}
```

目标 iframe 的 `Client` 会拦截 `exports:__dispatch`，定位本地 handler，执行并通过 `reui:response` 返回结果。

---

### 4.2 capability（在 RFC-002 §3.1.1 permissions 列表上扩展）

| capability | 允许动作 |
|------------|----------|
| `exports.expose` | 调用 `exports:register` / `exports:unregister`，将自己的方法注册到 ExportRegistry |
| `exports.call.<targetPluginId>` | 调用指定插件的导出方法 |
| `exports.call.*` 或 `exports.call.all` | 调用任意插件的导出方法（高权限，CLI 标记） |
| `runtime.all` / `plugins.all`（已有） | 等价 `exports.call.*` + `exports.expose`，向后兼容 |

**与 RFC-002 `plugins.<id>` 的关系：**

- `plugins.<id>` 仍然控制 `plugin:message`（裸 fire-and-forget 跨插件消息）；
- `exports.call.<id>` 是更细的 RPC 通道；
- 简化策略：**Runtime 在权限匹配时，将 `plugins.<id>` 视作 `exports.call.<id>` 的超集**——已声明 `plugins.<id>` 的插件无需再写一遍 `exports.call.<id>`，但反之不成立（`exports.call.<id>` 仅授予 RPC，不授予裸消息能力）。
- CLI 在 `reui sign` 阶段对包含 `exports.call.*`、`exports.call.all` 或 `plugins.all` 的插件标记为高权限（与 RFC-005 一致）。

每个 `@expose` 还可以在**目标侧**进一步限制调用方：

```ts
@expose({ requirePermissions: ['admin.kick'] })
kickPlayer(id: number) { ... }
```

ExportRegistry 在转发前会读取调用方插件的 permissions，确认 `requirePermissions` 全部满足，否则返回 `CAPABILITY_DENIED`。这给被调用方提供了"在我自己的方法上加额外门槛"的能力，而无须信任调用方自己的权限声明。

---

### 4.3 Runtime: ExportRegistry

```typescript
// runtime/src/services/export-registry.ts

interface RegisteredExport {
  pluginId: string;
  method: string;
  description?: string;
  requireRoles?: string[];
  requirePermissions?: string[];
  /** 注册时所属的 Plugin 实例 epoch（每次 reload + 1），用于过期检测 */
  epoch: number;
}

export class ExportRegistry {
  private static instance: ExportRegistry;

  /** pluginId → method → entry */
  private registry = new Map<string, Map<string, RegisteredExport>>();

  /** 进行中的转发：runtimeReqId → { resolve, reject, timer, callerPluginId, target } */
  private inflight = new Map<string, InflightCall>();

  private router!: PostMessageRouter;
  private pluginManager!: PluginManager;

  static getInstance(): ExportRegistry { /* ... */ }

  bind(router: PostMessageRouter, pm: PluginManager): void {
    this.router = router;
    this.pluginManager = pm;
    // 订阅生命周期事件（来自 PluginManager 发出的内部事件）
    pm.on('plugin:beforeUnload', (id) => this.dropPlugin(id, 'EXPORT_RELOADED'));
    pm.on('plugin:crashed',     (id) => this.dropPlugin(id, 'PLUGIN_CRASHED'));
  }

  // ── 注册 ──
  register(plugin: PluginInstance, decls: ExportDecl[]): string[] {
    if (!this.router.hasCapability(plugin, 'exports.expose')) {
      throw new ReUIError(ErrorCode.CAPABILITY_DENIED, 'exports:register');
    }

    const accepted: string[] = [];
    const map = this.registry.get(plugin.id) ?? new Map();
    for (const d of decls) {
      if (!isValidExportName(d.method)) continue;
      map.set(d.method, {
        pluginId: plugin.id,
        method: d.method,
        description: d.description,
        requireRoles: d.requireRoles,
        requirePermissions: d.requirePermissions,
        epoch: plugin.epoch,
      });
      accepted.push(d.method);
    }
    this.registry.set(plugin.id, map);
    return accepted;
  }

  // ── 调用（核心路由） ──
  async invoke(
    caller: { pluginId: string; roles: string[]; permissions: string[] } | LuaCaller,
    target: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    const entry = this.registry.get(target)?.get(method);
    if (!entry) throw new ReUIError(ErrorCode.EXPORT_NOT_FOUND, `${target}.${method}`);

    // 1) 调用方权限：exports.call.<target> | exports.call.* | plugins.<target> | plugins.all
    if (caller !== '__lua' && !this.canCall(caller, target)) {
      throw new ReUIError(ErrorCode.CAPABILITY_DENIED, `exports.call.${target}`);
    }

    // 2) 目标方法的额外约束
    if (entry.requireRoles?.length && !this.matchRoles(caller, entry.requireRoles)) {
      throw new ReUIError(ErrorCode.PERMISSION_DENIED, `${target}.${method}`);
    }
    if (entry.requirePermissions?.length && !this.matchPerms(caller, entry.requirePermissions)) {
      throw new ReUIError(ErrorCode.PERMISSION_DENIED, `${target}.${method}`);
    }

    // 3) 目标插件状态
    const targetPlugin = this.pluginManager.get(target);
    if (!targetPlugin || targetPlugin.state !== 'ready') {
      throw new ReUIError(ErrorCode.PLUGIN_NOT_LOADED, target);
    }

    // 4) 转发到目标 iframe（用 Runtime 自己的 reqId）
    return this.dispatchToPlugin(targetPlugin, entry, args, caller);
  }

  // ── 卸载/崩溃 ──
  private dropPlugin(pluginId: string, code: ErrorCode): void {
    this.registry.delete(pluginId);
    for (const [reqId, call] of this.inflight) {
      if (call.target === pluginId) {
        clearTimeout(call.timer);
        call.reject(new ReUIError(code, `${pluginId}.${call.method}`));
        this.inflight.delete(reqId);
      }
    }
  }
}
```

**关键不变量：**

| 不变量 | 行为 |
|--------|------|
| 注册的方法名仅在 `[a-zA-Z][\w.-]{0,63}` 范围内 | 防止注入（如 `__proto__`）与协议混淆 |
| 每个 plugin epoch +1 后旧注册项立即失效 | 热重载安全：旧 iframe 的延迟 register 不会污染新 iframe |
| `invoke` 超时默认 8 秒（可由调用方传入 `timeout`，上限 30 秒） | 与 RFC-001 §3.5 的 `REQUEST_TIMEOUT` 同源，但更宽（业务方法可能慢） |
| 同一 (pluginId, method) 二次注册覆盖旧项 | 简化热模块替换；通过 epoch 区分新旧 iframe 来源 |
| Runtime 不缓存 args / 不深度克隆 | 由 postMessage 结构化克隆负责；不可序列化数据由调用方负责 |

#### 4.3.1 死锁防护（开发模式）

ExportRegistry 维护一份 `callerStack: pluginId[]`，每次 `invoke` 入栈，响应/错误后出栈。检测到调用链里出现重复 `pluginId` 时（A → B → A）：

- **生产模式**：仍允许调用，但日志 warn；
- **开发模式**：返回 `EXPORT_CYCLE_DETECTED` 错误（CLI/devtools 直接打印调用栈）。

> **注意：** 这只是启发式防护，无法 100% 防止"长周期回路"导致的死锁。真正的解决方案是给业务设计避免环路，所以本 RFC 不把它列为强制行为。

---

### 4.4 PostMessageRouter 集成

按 RFC-001 §3.3 的 handler 注册模式扩展：

```typescript
export function registerExportHandlers(router: PostMessageRouter): void {
  const reg = ExportRegistry.getInstance();

  router.registerHandler('exports:register', (plugin, msg) => {
    try {
      const decls = (msg.params as { methods: ExportDecl[] }).methods ?? [];
      const accepted = reg.register(plugin, decls);
      router.sendSuccess(plugin, msg.id, { accepted });
    } catch (err) { router.sendError(plugin, msg.id, toErrorPayload(err)); }
  });

  router.registerHandler('exports:unregister', (plugin, msg) => {
    const { methods } = msg.params as { methods: string[] };
    const accepted = reg.unregister(plugin.id, methods);
    router.sendSuccess(plugin, msg.id, { accepted });
  });

  router.registerHandler('exports:list', (plugin, msg) => {
    const { target } = (msg.params ?? {}) as { target?: string };
    router.sendSuccess(plugin, msg.id, { entries: reg.list(target) });
  });

  router.registerHandler('exports:invoke', async (plugin, msg) => {
    const { target, method, args } = msg.params as {
      target: string; method: string; args?: unknown[];
    };
    try {
      const result = await reg.invoke(
        { pluginId: plugin.id, roles: plugin.roles, permissions: plugin.permissions },
        target, method, args ?? [],
      );
      router.sendSuccess(plugin, msg.id, result);
    } catch (err) {
      router.sendError(plugin, msg.id, toErrorPayload(err));
    }
  });
}
```

**调用链路示意（A 调 B.kick）：**

```
A (iframe)  ─reui:request {method:'exports:invoke', params:{target:'B', method:'kick', args:[1]}}─▶
Runtime     [PostMessageRouter 校验 exports.call.B + 路由]
            [ExportRegistry.invoke → 校验 B.kick.requirePermissions → 找到 B 的 contentWindow]
Runtime     ─reui:request {method:'exports:__dispatch', params:{method:'kick', args:[1], callerPluginId:'A'}}─▶ B
B (iframe)  [@reui/core 内置 dispatcher → 调用本地 handler kick(1) → 返回结果]
B           ─reui:response {success:true, result: ...}─▶ Runtime
Runtime     ─reui:response {success:true, result: ...}─▶ A
A           [client.request 的 Promise resolve]
```

每个箭头都是普通 RFC-001 消息。Runtime 在中间维护 `runtimeReqId ↔ callerReqId` 映射，使得调用方完全感知不到中间转发的存在。

---

### 4.5 `@reui/core` 侧 SDK

```typescript
// @reui/core/src/exports.ts

import { Client } from './client';

export interface ExposeOptions {
  /** 自定义导出名（默认取方法名） */
  name?: string;
  description?: string;
  /** 调用方必须具备的角色之一（OR） */
  requireRoles?: string[];
  /** 调用方必须具备的全部权限（AND，复用 RFC-002 字符串格式） */
  requirePermissions?: string[];
}

export interface InvokeOptions {
  /** 单次调用超时（ms），默认 8000，上限 30000 */
  timeout?: number;
}

export class ReUIExports {
  private client: Client;
  /** 装饰器累积的待注册方法（init 之前累积，init 之后立即注册） */
  private pending: Array<{ name: string; opts: ExposeOptions; fn: Function }> = [];
  /** 已注册的本地 handler */
  private handlers = new Map<string, Function>();

  constructor(client: Client) {
    this.client = client;
    // 接收 Runtime 的二次转发 exports:__dispatch
    client.registerLocalHandler('exports:__dispatch', this.onDispatch.bind(this));
    client.onReady(() => this.flushPending());
  }

  // ── 装饰器（stage-3） ──
  expose(opts: ExposeOptions = {}): MethodDecoratorStage3 {
    return (originalMethod, ctx) => {
      if (ctx.kind !== 'method') throw new Error('@expose only on methods');
      const name = opts.name ?? String(ctx.name);
      ctx.addInitializer(function () {
        // `this` 是装饰器宿主对象（在 init 时绑定）
        const bound = (originalMethod as Function).bind(this);
        ReUIExports._instance.declare(name, bound, opts);
      });
      return originalMethod;
    };
  }

  // ── 命令式 API ──
  register(map: Record<string, Function>, opts?: ExposeOptions): void {
    for (const [name, fn] of Object.entries(map)) this.declare(name, fn, opts ?? {});
  }

  // ── 调用 ──
  async invoke<T = unknown>(
    target: string,
    method: string,
    args: unknown[] = [],
    options: InvokeOptions = {},
  ): Promise<T> {
    return this.client.request<T>('exports:invoke', { target, method, args }, options);
  }

  // ── 辅助 ──
  list(target?: string) {
    return this.client.request<{ entries: any[] }>('exports:list', { target });
  }

  // ── 内部 ──
  private declare(name: string, fn: Function, opts: ExposeOptions): void {
    this.handlers.set(name, fn);
    this.pending.push({ name, opts, fn });
    if (this.client.isReady) this.flushPending();
  }

  private async flushPending(): Promise<void> {
    if (!this.pending.length) return;
    const decls = this.pending.map(({ name, opts }) => ({
      method: name,
      description: opts.description,
      requireRoles: opts.requireRoles,
      requirePermissions: opts.requirePermissions,
    }));
    this.pending = [];
    await this.client.request('exports:register', { methods: decls });
  }

  private async onDispatch(msg: { params: { method: string; args: unknown[]; callerPluginId: string } }) {
    const { method, args } = msg.params;
    const fn = this.handlers.get(method);
    if (!fn) throw new ReUIError(ErrorCode.EXPORT_NOT_FOUND, method);
    return await fn(...args);
  }
}

// 单例 + 默认导出
export const exports = new ReUIExports(client);
```

> **TS 装饰器选择：** 装饰器必须支持 stage-3（TS 5.x 默认）以及 legacy（`experimentalDecorators`），`@reui/cli` 在脚手架中默认开启 stage-3，并在文档里给出 legacy 模式的兼容写法。装饰器的实现使用 `addInitializer`，确保即使在没有类装饰器实例化的语义里也能在对象创建时把方法注册到单例。

#### 4.5.1 使用样例

```ts
// inventory/src/exports.ts
import { exports as ex } from '@reui/core';

class InventoryAPI {
  @ex.expose({ description: '查询玩家某物品数量' })
  getCount(playerId: number, itemId: string): number {
    return this.store.count(playerId, itemId);
  }

  @ex.expose({ requirePermissions: ['inventory.write'] })
  give(playerId: number, itemId: string, count: number): boolean {
    return this.store.add(playerId, itemId, count);
  }
}
new InventoryAPI();   // 实例化即注册（addInitializer 时机）

// shop/src/checkout.ts
import { exports as ex } from '@reui/core';
const count = await ex.invoke<number>('inventory', 'getCount', [pid, 'apple']);
if (count >= 1) await ex.invoke('inventory', 'give', [pid, 'banana', 1]);
```

**命令式风格（不依赖装饰器）：**

```ts
import { exports as ex } from '@reui/core';
ex.register({
  getCount: (pid, item) => store.count(pid, item),
  give: (pid, item, n) => store.add(pid, item, n),
}, { requirePermissions: ['inventory.write'] });
```

#### 4.5.2 类型推断（可选）

提供一个工具类型（不强制）：

```ts
// inventory/src/exports.ts
export type InventoryExports = {
  getCount(playerId: number, itemId: string): number;
  give(playerId: number, itemId: string, count: number): boolean;
};

// shop/src/checkout.ts
import type { InventoryExports } from 'inventory/exports';
import { exports as ex } from '@reui/core';

const inv = ex.proxy<InventoryExports>('inventory');
const c = await inv.getCount(pid, 'apple');     // 强类型 + 自动补全
await inv.give(pid, 'banana', 1);
```

`exports.proxy<T>(target)` 仅是 `Proxy` 包装 `invoke`，运行时无额外开销；类型契约**完全靠跨包 import**。

---

### 4.6 Lua 桥（自带 resource）

ReUI 框架自带名为 `reui` 的 FiveM resource（用于挂载 NUI 与桥接），在其 `client.lua` 中暴露：

```lua
-- resources/reui/client.lua

local pending = {}
local nextReqId = 0

-- 异步：cb(err, result)
exports('invokePlugin', function(pluginId, method, args, cb, options)
  nextReqId = nextReqId + 1
  local reqId = ('lua:%d'):format(nextReqId)
  pending[reqId] = cb
  SendNUIMessage({
    type = 'reui:lua-invoke',
    reqId = reqId,
    target = pluginId,
    method = method,
    args = args or {},
    timeout = (options and options.timeout) or 8000,
  })
end)

-- await 风格（同步阻塞当前协程，最长 timeout 毫秒）
exports('invokePluginSync', function(pluginId, method, args, options)
  local p = promise.new()
  exports.reui:invokePlugin(pluginId, method, args, function(err, res)
    if err then p:reject(err) else p:resolve(res) end
  end, options)
  return Citizen.Await(p)
end)

RegisterNUICallback('reui:lua-invoke-result', function(data, cb)
  local entry = pending[data.reqId]
  if entry then
    pending[data.reqId] = nil
    if data.success then entry(nil, data.result) else entry(data.error, nil) end
  end
  cb('ok')
end)
```

**Runtime 侧（NuiBridge 扩展）：**

```typescript
// runtime/src/bridge/nui-bridge.ts (片段)

handleGameMessage(data: any): void {
  // ... 现有 reui:init 等
  if (data?.type === 'reui:lua-invoke') {
    this.handleLuaInvoke(data);
    return;
  }
}

private async handleLuaInvoke(d: { reqId: string; target: string; method: string; args: unknown[]; timeout: number }) {
  try {
    const result = await ExportRegistry.getInstance().invoke(
      '__lua', d.target, d.method, d.args,
    );
    this.sendToGame('reui:lua-invoke-result', {
      reqId: d.reqId, success: true, result,
    });
  } catch (err) {
    this.sendToGame('reui:lua-invoke-result', {
      reqId: d.reqId, success: false,
      error: { code: err.code ?? 'RUNTIME_ERROR', message: err.message },
    });
  }
}
```

**Lua 侧权限：** Lua 调用方在 ExportRegistry 中以特殊 caller `'__lua'` 表示，**默认拥有 `exports.call.*`**（Lua 已经是受信源，跟客户端脚本同等权限）。但目标插件声明的 `requireRoles` / `requirePermissions` 仍会强制——这给 NUI 插件提供了"对 Lua 也设访问门槛"的能力。

**Lua 用法示例：**

```lua
-- 异步
exports.reui:invokePlugin('inventory', 'getCount', { source, 'apple' }, function(err, count)
  if err then return print('failed', err.code, err.message) end
  print(('player has %d apples'):format(count))
end)

-- 同步（必须在协程里）
Citizen.CreateThread(function()
  local count = exports.reui:invokePluginSync('inventory', 'getCount', { source, 'apple' })
  print(count)
end)
```

#### 4.6.1 Lua → NUI 的 args / 返回值序列化约束

- **入参** 必须是 Lua 表 / 基本类型（FiveM `SendNUIMessage` 已做 JSON 序列化）；不允许 `vector3` / `userdata`，需要由调用方转成 `{x, y, z}`。
- **返回值** 同样限制为 JSON-safe；NUI 插件返回函数 / Promise 会被自动剥离为 `null` 并产生 dev 模式 warn。

---

### 4.7 PluginManager 集成

按 RFC-002 §3.4 的生命周期扩展：

```typescript
// runtime/src/plugin/manager.ts (片段)

async unload(pluginId: string, reason: UnloadReason): Promise<void> {
  // 触发 plugin:beforeUnload（ExportRegistry 监听后 dropPlugin）
  this.emit('plugin:beforeUnload', pluginId);
  // ... 现有：保存状态、销毁 iframe、清理 EventBus / Heartbeat
}

private handleCrash(plugin: PluginInstance): void {
  this.emit('plugin:crashed', plugin.id);
  // ... 现有崩溃处理
}
```

**热重载语义：** PluginManager 在 reload 时先 emit `plugin:beforeUnload`（旧 epoch 失效），再创建新 iframe（新 epoch+1），新 iframe 会重新 `exports:register`。这保证了"热重载窗口期"内任何 in-flight 调用都会被 reject 为 `EXPORT_RELOADED`，不会调到老 iframe 上。

---

### 4.8 错误码扩展（在 RFC-001 §4.2 上新增）

| Code | 含义 | 触发条件 |
|------|------|----------|
| `EXPORT_NOT_FOUND` | 导出方法不存在 | 目标插件未注册该 method |
| `PLUGIN_NOT_LOADED` | 目标插件未加载或未就绪 | 插件未启用、尚未 ready、已被卸载 |
| `EXPORT_RELOADED` | 调用过程中目标插件被卸载/热重载 | PluginManager 触发 beforeUnload |
| `PLUGIN_CRASHED` | 调用过程中目标插件崩溃 | heartbeat 超时（RFC-001 §3.7） |
| `EXPORT_CYCLE_DETECTED` | 检测到调用环路（仅开发模式） | 调用栈内出现重复 pluginId |
| `EXPORT_NAME_INVALID` | 导出名不符合 `[a-zA-Z][\w.-]{0,63}` | 注册时 |

调用方权限不足复用现有 `CAPABILITY_DENIED` / `PERMISSION_DENIED`，超时复用 `TIMEOUT`。

---

## 5. 安全考量

### 5.1 capability 强制检查

| 调用 | 必需 capability | 检查时机 |
|------|----------------|----------|
| `exports:register` / `exports:unregister` | `exports.expose` 或 `runtime.all` | 每次请求 |
| `exports:invoke` (target=X) | `exports.call.X` / `exports.call.*` / `plugins.X` / `plugins.all` / `runtime.all` | 每次请求 |
| `exports:list` | 无 capability | 每次请求 |
| 目标方法的 `requireRoles` / `requirePermissions` | 由 ExportRegistry 在转发前再校验 | 每次请求 |

### 5.2 防滥用

| 风险 | 防护 |
|------|------|
| 插件冒充其他插件注册 | `exports:register` 只把当前 caller 的 pluginId 写入注册表，无法注入 `target` 字段 |
| 通过 method 名注入特殊字符 | 注册时正则 `[a-zA-Z][\w.-]{0,63}` 校验，否则 `EXPORT_NAME_INVALID` |
| 调用方重复同一 invoke 触发幂等问题 | Runtime 不去重；幂等仍由业务方法负责（与一般 RPC 一致） |
| in-flight 调用积压 | 每个 caller 同时未完成 invoke 上限默认 32，超出返回 `RUNTIME_ERROR`（避免过 RAM） |
| Lua 越过权限调用 | Lua caller 默认 `exports.call.*`，但目标可通过 `requirePermissions` 强制只对特定调用方开放（例如仅 `admin` 角色） |
| 长时间阻塞目标 iframe | 单次 `invoke` 默认 8s 超时；目标 iframe 的方法只会拿到 args，不会拿到 caller 的 socket，无法长期占用 |
| HTML/JS 注入 | 数据通道与 RFC-001 一致，由 postMessage 结构化克隆负责，不存在字符串拼接风险 |

### 5.3 与 RFC-002 沙箱模型的兼容

- 目标 iframe 仍在 `sandbox="allow-scripts"` 中执行；
- ExportRegistry 不在 Runtime 主页面执行业务代码；
- `exports.invoke` 的返回值经 postMessage 结构化克隆传输，**禁止函数 / Promise / DOM**，与 RFC-001 §5 的整体模型一致。

---

## 6. 测试计划

### 6.1 单元测试（ExportRegistry）

| 测试用例 | 预期结果 |
|----------|----------|
| `register` 含非法字符方法名 | 返回 `EXPORT_NAME_INVALID`，不进入注册表 |
| `register` 在缺少 `exports.expose` 权限时 | `CAPABILITY_DENIED` |
| `invoke` 调用方缺 `exports.call.<target>` | `CAPABILITY_DENIED` |
| `invoke` 目标插件未加载 | `PLUGIN_NOT_LOADED` |
| `invoke` 方法不存在 | `EXPORT_NOT_FOUND` |
| `invoke` 进行中 PluginManager 触发 `beforeUnload` | reject `EXPORT_RELOADED` |
| `invoke` 进行中目标心跳超时 | reject `PLUGIN_CRASHED` |
| `invoke` 目标方法 throw | reject 携带 `RUNTIME_ERROR` 与原错误 message |
| 重复 `register` 同名方法 | 后注册覆盖前注册（同 epoch 内） |
| 老 epoch 延迟 `register` | 静默丢弃（dev warn） |
| 调用环路 A→B→A | 开发模式 `EXPORT_CYCLE_DETECTED`，生产模式仅 warn |

### 6.2 集成测试

| 场景 | 验证点 |
|------|--------|
| iframe A 用 `@expose` 装饰 + 实例化 → A 加载完成后 B 能 `invoke` | 装饰器累积 + ready 后 flush 路径 |
| A 在 init 之前已声明导出，B 在 init 完成后立即 invoke | flushPending 时序正确，B 不会拿到 `EXPORT_NOT_FOUND` |
| Lua 调用 `exports.reui:invokePlugin('inv','getCount',{1,'apple'},cb)` | 收到正确 count；超时正确触发 |
| 调用方 capability 仅含 `plugins.inv`（无 `exports.call.inv`）| invoke 仍成功（向后兼容） |
| 目标方法 `requirePermissions: ['admin']` 调用方无 admin | `PERMISSION_DENIED` |
| 调用方 in-flight 32 个同时启动第 33 个 | `RUNTIME_ERROR` 限流 |

### 6.3 边界测试

- `args` 含循环引用 → postMessage 抛错并被 caller `reject(RUNTIME_ERROR)`；
- 返回 `Promise<Promise<...>>` → 由目标 iframe 自然 await 后再 reply（结果是值而非 Promise）；
- 目标方法返回 `undefined` → response.result = `undefined`；调用方 await 得到 `undefined`；
- 大对象 args（>1MB）→ Runtime 拒绝并返回 `INVALID_PARAMS`（与 NuiBridge 上限对齐）；
- 同一调用方并发 1000 次 `invoke`，验证 inflight Map 清理无泄漏。

---

## 7. 验收标准

### 7.1 功能验收

- [ ] `@reui/core` 导出 `exports` 模块，提供 `expose / register / invoke / list / proxy` API
- [ ] 装饰器在 stage-3 与 legacy 两种 TS 模式下均可用
- [ ] PostMessageRouter 注册 `exports:register / unregister / invoke / list`
- [ ] ExportRegistry 正确实现 epoch 隔离与热重载语义
- [ ] PluginManager `beforeUnload` / `crashed` 触发对应 in-flight reject
- [ ] Lua resource `exports.reui:invokePlugin` 异步 + 同步两种风格均工作
- [ ] `requireRoles` / `requirePermissions` 在 ExportRegistry 强制
- [ ] `exports.call.<id>` 与 `plugins.<id>` 互通（前者是后者的子集）
- [ ] 错误码 `EXPORT_NOT_FOUND / PLUGIN_NOT_LOADED / EXPORT_RELOADED / PLUGIN_CRASHED / EXPORT_CYCLE_DETECTED / EXPORT_NAME_INVALID` 正确触发
- [ ] dev 模式开启循环检测；prod 模式仅 warn

### 7.2 性能验收

- [ ] 同 NUI 内 `invoke` 端到端延迟 < 4ms（不含目标方法体）
- [ ] Lua → NUI `invoke` 端到端延迟 < 16ms（含一次 `SendNUIMessage` + 一次 NUI callback）
- [ ] 同时 100 个并发 invoke 无内存泄漏（inflight Map 在 60s 内清空）
- [ ] `@reui/core/exports` 模块 minified < 2.5 KB；总包仍 < 12 KB gzipped（在 RFC-001 §7.2 基础上放宽 2KB）

### 7.3 安全验收

- [ ] 无 `exports.expose` 的插件 `register` 被拒
- [ ] 无 `exports.call.<target>` 的插件 `invoke` 被拒（且不暴露目标方法是否存在的信息——统一返回 `CAPABILITY_DENIED` 而非 `EXPORT_NOT_FOUND`）
- [ ] 非法 method 名注册全部拒绝（穷举 `__proto__`、空字符串、超长、含 ASCII 控制字符等）
- [ ] Lua 调用受目标 `requirePermissions` 约束
- [ ] 跨插件 args 仅通过结构化克隆传输，不存在 prototype pollution

### 7.4 代码质量验收

- [ ] 所有 method 与错误码补充进 RFC-001 §4 的 method 表与错误码表（在 RFC-001 中以 hyperlink 引用本 RFC，**不**回写正文）
- [ ] `@reui/core` 公开 API 全部带 JSDoc + 类型签名，无 `any` 泄漏
- [ ] 装饰器 + 命令式两种用法各有 sample（`samples/exports-demo`）

---

## 8. 依赖关系

### 8.1 前置依赖

| RFC | 依赖内容 |
|-----|----------|
| RFC-001 | `reui:request / response` 协议、错误码体系、PostMessageRouter handler 注册、Client 类的 `request()` |
| RFC-002 | PluginManifest 的 `permissions` 模型（扩展 `exports.*` 与 `plugins.<id>`）、PluginManager 生命周期事件、capability 检查机制 |
| RFC-003 | Runtime 单例服务模式、ReUIError / ErrorCode 枚举、与 EventBus 一致的 `subscribeForPlugin` 风格清理逻辑 |

### 8.2 对其他组件的影响

| 组件 | 影响 |
|------|------|
| `PostMessageRouter` | 注册 4 个 handler；Method → Permission 映射表新增 4 行 |
| `PluginManager` | emit `plugin:beforeUnload`（如尚未提供）；epoch 字段加入 PluginInstance |
| `@reui/core/Client` | 新增 `registerLocalHandler` / `onReady`（供 ReUIExports 内部使用） |
| `@reui/core/index.ts` | 追加 `export const exports = new ReUIExports(client)` |
| `NuiBridge` | 增加 `reui:lua-invoke` 入站消息处理 + `reui:lua-invoke-result` 出站消息 |
| `resources/reui/client.lua` | 新增 `invokePlugin` / `invokePluginSync` exports 与 NUI callback |
| RFC-002 plugin.json Schema | `permissions` 枚举新增 `exports.expose`、`exports.call.<id>`、`exports.call.*` |
| RFC-005 CLI（`reui sign`） | `exports.call.*` / `exports.call.all` 标记为高权限 |
| `@reui/cli` 脚手架 | 默认开启 stage-3 装饰器；`reui scaffold plugin` 模板生成示例 `exports.ts` |

### 8.3 实现顺序

```
1. ExportRegistry 单例（Map + invoke 路由 + 错误处理）— 独立可单测
2. RFC-001 协议落实：PostMessageRouter 注册 4 个 handler
3. PluginManager 生命周期事件接入（beforeUnload / crashed → dropPlugin）
4. @reui/core 端 ReUIExports 类（先命令式 register/invoke，再装饰器）
5. Client 端 exports:__dispatch 处理路径
6. capability 模型扩展（与 RFC-002 plugin.json Schema 同步）
7. Lua 桥（resources/reui/client.lua + NuiBridge handleLuaInvoke）
8. 类型工具 ExposedOf<T> / proxy<T>（可选）
9. 集成测试 + 三种调用方向（A↔B、Lua→A）的 e2e 测试
```

---

## 附录 A：method 速查表（与 RFC-001 §4.1 对齐）

| method | params | response | capability | 通道 |
|--------|--------|----------|------------|------|
| `exports:register` | `{ methods: ExportDecl[] }` | `{ accepted: string[] }` | `exports.expose` | `reui:request` |
| `exports:unregister` | `{ methods: string[] }` | `{ accepted: string[] }` | `exports.expose` | `reui:request` |
| `exports:list` | `{ target?: string }` | `{ entries: ExportListEntry[] }` | — | `reui:request` |
| `exports:invoke` | `{ target, method, args }` | 透传目标返回 | `exports.call.<target>` 或 `plugins.<target>` | `reui:request` |
| `exports:__dispatch` *(内部)* | `{ method, args, callerPluginId }` | 业务返回 | 由 ExportRegistry 注入，调用方无法直接发起 | `reui:request` |

## 附录 B：与现有跨插件方案对比

| 维度 | RFC-002 `plugin:message` | **本 RFC `exports:invoke`** |
|------|--------------------------|------------------------------|
| 语义 | fire-and-forget / 自定义 ack | Request/Response（带返回值） |
| 类型契约 | 无（业务自定义 payload） | 可通过 `proxy<T>` 获得强类型 |
| 权限粒度 | `plugins.<id>` 整体放行 | 可精确到 `exports.call.<id>` 与目标 `requirePermissions` |
| 生命周期处理 | 调用方需自行处理对方崩溃 | Runtime 自动 reject `EXPORT_RELOADED / PLUGIN_CRASHED` |
| 适合场景 | 广播事件、异步通知 | RPC 风格的同步调用 |

## 附录 C：完整消息流示例（A 调 B.kick + Lua 调 A.foo）

```
# 场景 1：A → B
 1. A 代码：await ex.invoke('B', 'kick', [123]);
 2. ReUIExports.invoke() 调用 client.request('exports:invoke', {target:'B', method:'kick', args:[123]})
 3. Client 生成 id="A:42"，发送 reui:request 到 parent
 4. PostMessageRouter 校验 version=1 ✓，A 含 exports.call.B ✓
 5. ExportRegistry.invoke：B.kick 存在 ✓，B 已 ready ✓，requirePermissions ✓
 6. Runtime 生成新 id="rt:7"，向 B 发 reui:request {method:'exports:__dispatch', params:{method:'kick', args:[123], callerPluginId:'A'}}
 7. B 的 Client.onMessage 路由到本地 dispatcher → 调用 kick(123) → 返回 { success: true }
 8. B 发回 reui:response {id:"rt:7", success:true, result:{success:true}}
 9. Runtime 查 inflight["rt:7"] → 翻译成 reui:response {id:"A:42", success:true, result:{success:true}}
10. A 的 await ex.invoke 拿到 {success:true}

# 场景 2：Lua → A
 1. Lua: exports.reui:invokePlugin('A','foo',{1,2},cb)
 2. resource 'reui' SendNUIMessage('reui:lua-invoke',{reqId:'lua:5',target:'A',method:'foo',args:[1,2],timeout:8000})
 3. NuiBridge.handleGameMessage → handleLuaInvoke → ExportRegistry.invoke('__lua', 'A', 'foo', [1,2])
 4. ExportRegistry 校验：__lua 默认有 exports.call.* ✓，A.foo.requirePermissions ✓
 5. Runtime 向 A 发 exports:__dispatch（同上）
 6. A 返回 result
 7. NuiBridge.sendToGame('reui:lua-invoke-result', {reqId:'lua:5', success:true, result})
 8. Lua RegisterNUICallback 触发 → cb(nil, result)
```

## 附录 D：与 FiveM 原生 `exports['resource']:func()` 的对比

| 维度 | FiveM 原生 exports | ReUI plugin exports |
|------|--------------------|---------------------|
| 调用方 | Lua / JS 资源脚本 | NUI iframe 插件 + Lua（通过 `reui` resource） |
| 被调用方 | 任意 resource | 任意已加载 NUI 插件 |
| 类型安全 | 无 | 可选（通过共享 d.ts） |
| 权限 | 无（所有 resource 平权） | 双层（capability + requirePermissions） |
| 生命周期保护 | 无（停 resource 后调用挂起） | 自动 reject in-flight |
| 跨进程 | 仅本地 client 或仅 server | 本地 client（含 NUI ↔ NUI、Lua ↔ NUI） |

ReUI plugin exports 不是替代 FiveM 原生 exports，而是把"NUI 插件之间 / NUI 插件与 Lua 之间"这块原生缺失的能力补齐。
