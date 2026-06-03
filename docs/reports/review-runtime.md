# `@reui/runtime` 审查报告

> 审查者：reviewer-runtime
> 审查范围：`workspace/runtime/`（package.json / tsconfig.json / vitest.config.ts / src/**/ tests/**）
> 对照基准：RFC-001（通讯协议）、RFC-002（插件系统）、RFC-003（Runtime 单例服务）、RFC-006（System UI）、RFC-007（Plugin Exports/RPC）
> 审查目标：作为整个 ReUI 体系核心宿主的 Runtime 实现完整性、安全约束落地、对 RFC 的对齐度

---

## 1. 包概览

### 1.1 在体系中的角色

按 [`AGENTS.md`](../../AGENTS.md) 与 RFC-001 §3.2 / RFC-002 §3.3 的定位，`@reui/runtime` 应承载：

1. **MessageDispatcher**：唯一 `window.addEventListener('message', ...)` 入口，按 `event.source` 分流游戏端 NUI 消息与 iframe 插件消息（RFC-001 §3.2）。
2. **PostMessageRouter**：版本检查、capability 验证、`reui:request` / `reui:notify` 路由分发（RFC-001 §3.3）。
3. **NuiBridge**：与 FiveM `SendNUIMessage` / `fetch` 桥接（RFC-001 §3.4）。
4. **PluginManager**：plugin.json 校验、签名核验、iframe 创建、生命周期、互斥 panel、热重载（RFC-002 §3.3-§3.7）。
5. **LayerSystem**：HUD / Panel / Overlay / System 四层 z-index 与可见性（RFC-002 §3.5、RFC-006 §4.1）。
6. **单例服务**：EventBus / WebSocketManager / HttpClient / AuthService（RFC-003 §3.1-§3.5）。
7. **SystemUIService**：`system:notify` / `system:confirm` / `system:toast` 等系统级 UI（RFC-006 §4.2）。
8. **ExportRegistry**：跨插件 / Lua RPC 中枢（RFC-007 §4.3）。
9. **HeartbeatMonitor**：心跳超时与僵死插件清理（RFC-001 §3.7）。

按 RFC-001/002/003/006/007 总和，runtime 至少应有 9 个核心类与若干辅助模块。

### 1.2 实际模块结构

```
workspace/runtime/
├── package.json          私有包，type=module，dependencies: @reui/cli, @reui/interface
├── tsconfig.json         继承 tsconfig.base.json，noEmit，paths 别名指向 cli/interface 源码
├── vitest.config.ts      jsdom 环境，coverage 阈值 90/90/90/90，排除 src/index.ts
├── docs/                 ★ 空目录
└── src/
    ├── index.ts          re-export EventBus / AuthService / event-namespace 工具
    ├── event-bus.ts      EventBus 单例（RFC-003 §3.1）
    ├── auth-service.ts   AuthService 单例（RFC-003 §3.4）
    └── event-namespace.ts parseEventName / KNOWN_NAMESPACES 纯函数（RFC-003 §3.5）
└── tests/
    ├── event-bus.test.ts
    ├── auth-service.test.ts
    └── event-namespace.test.ts
```

**实测：仅 3 个 src 文件（~340 行），3 个 test 文件**。RFC 列表中至少 6 个核心模块（MessageDispatcher / PostMessageRouter / NuiBridge / PluginManager / LayerSystem / WebSocketManager / HttpClient / SystemUIService / ExportRegistry / HeartbeatMonitor）**全部缺失**。本包当前阶段实质是「EventBus + AuthService + 命名空间解析的纯函数集」，距离 RFC 描述的「Runtime 宿主」有数量级差距。

### 1.3 依赖

| 维度 | 内容 |
|---|---|
| 运行时依赖 | `@reui/cli` workspace、`@reui/interface` workspace |
| 开发依赖 | `@types/node`、`@vitest/coverage-v8`、`jsdom`、`typescript`、`vitest` |
| 实际 import 的 workspace 包 | **没有**——`src/**` 与 `tests/**` 中没有任何 `from '@reui/interface'` 或 `from '@reui/cli'` 的语句 |
| 出口 | 仅 `.`（index.ts） |
| 被消费者 | 无（grep `@reui/runtime` 仅命中自身 package.json / index.ts） |

---

## 2. 关键发现（亮点）

1. **EventBus 设计与 RFC-003 §3.1 吻合度高**。`workspace/runtime/src/event-bus.ts:26-151` 三表结构（`listeners` / `wildcardListeners` / `pluginSubscriptions`）与 RFC-003 §3.1.1 数据结构一致；emit 实现「先精确后通配 + 异常隔离」（`event-bus.ts:86-99`）严格匹配 §3.1.4 伪代码。
2. **`emit` 的快照迭代解决了 handler 在派发期间增删订阅的竞态**。`event-bus.ts:90,97` 用 `[...exact]` / `[...set]` 复制后再 for-of，`event-bus.test.ts:141-160` 的「快照」用例验证了「派发中新增的 handler 第二轮才生效」，这是 RFC-003 §3.1.4 文字描述但伪代码未给出的实现细节，runtime 把它落地了。
3. **`subscribeForPlugin` 的反向索引解决了 RFC-003 §3.1.5 伪代码的痛点**。RFC 注释「实际实现中需要维护 pluginId → handler 的映射以便精确移除」（`rfc-003-runtime-services.md:198-200`）——runtime 通过 `PluginSubscription { event, handler }` 记录条目（`event-bus.ts:21-24,105-119`），`unsubscribePlugin` 能精确 `off(event, handler)`（`event-bus.ts:122-127`），优于 RFC 伪代码的「只删 pluginSubscriptions 不删 listeners」漏洞。
4. **AuthService Token 安全策略实现到位**。`auth-service.ts:8-9,113-118` 用注释明确「token 永不通过 PostMessageRouter 暴露」，且唯一的 `getToken()` 没有任何对外 API 注册（因为 PostMessageRouter 还没实现，但模块层面的不变量是清晰的）。这与 RFC-003 §3.4.4 / §8.3 「Token 不暴露给子页面」的安全验收要求一致。
5. **`getPermissions()` / `getRoles()` 防御式拷贝**。`auth-service.ts:98-103` 用 `[...this.permissions]` 返回新数组，`auth-service.test.ts:116-126` 的「returns defensive copy」用例守住了这条不变量，避免调用方意外破坏内部 Set。
6. **`event-namespace.ts` 纯函数化抽离**。`event-namespace.ts:38-72` 把命名空间解析做成无副作用的纯函数，配合 `KNOWN_NAMESPACES as const` 锁字面量类型，让 PostMessageRouter 未来注册时能直接复用，同时大幅降低单测成本（`event-namespace.test.ts` 完全不需要 mock Router/Plugin）。这一份「先抽工具、再写服务」的拆分思路是好工程感觉。
7. **测试遵循 `.codebuddy/rules/001-testing.mdc`**：`describe('Module.behavior')` 命名（`event-bus.test.ts:8`、`auth-service.test.ts:14`）、严格 AAA 注释、`__resetForTests()` 在 `beforeEach`/`afterEach` 双向重置避免单例泄漏（`event-bus.test.ts:11-18`、`auth-service.test.ts:17-24`）、`vi.spyOn(console, 'error')` 验证错误隔离（`event-bus.test.ts:107-125`），覆盖率配置阈值 90/90/90/90（`vitest.config.ts:20-25`）符合规则要求。
8. **`once` 用 `try { handler } finally { off }` 保证「即使 handler 抛错也会自动解绑」**（`event-bus.ts:71-80`），比朴素 `if (called) return` 模式更稳健。

---

## 3. 问题清单

> 标注约定：**Px** = 优先级（P0 阻断 / P1 重要 / P2 改进），其后 `文件:行号` + 理由。

### P0（阻断）

#### P0-1 整个 Runtime 宿主层缺失：MessageDispatcher / PostMessageRouter / NuiBridge / PluginManager / LayerSystem 全无实现

- **位置**：`workspace/runtime/src/`（仅 4 个文件，全部为 RFC-003 §3.1 / §3.4 / §3.5 范畴）
- **现状**：grep 全 workspace 后确认 `MessageDispatcher` / `PostMessageRouter` / `NuiBridge` / `PluginManager` / `LayerSystem` / `SystemUIService` / `ExportRegistry` / `WebSocketManager` / `HttpClient` 这 9 个类名**没有任何源码实现**（仅出现在 RFC 文档与 `@reui/cli` 的 permission 表格里）。
- **理由**：RFC-001 §3.2-§3.4 定义的「单一 message 入口 + 来源分流 + 版本与 capability 检查」是整个 ReUI 安全模型的根基；RFC-002 §3.3-§3.7 的 PluginManager 与 LayerSystem 是子插件能跑起来的前提；RFC-001 §3.7 的心跳监控是僵死插件清理的唯一手段。当前 runtime **完全无法承担「宿主」职责**——即便启动也只是 EventBus + AuthService 两个被动数据容器。AGENTS.md「关键约定」第 1/2/3/6 条（`reui:` 前缀分发、iframe 间不直连、单例服务唯一来源、Layer 归属明确）目前**没有任何代码强制执行**。
- **建议**：按 RFC 实现顺序补齐：
  1. 先 `MessageDispatcher`（RFC-001 §3.2 全文）+ `PostMessageRouter` 骨架（RFC-001 §3.3，含 version/capability 校验）
  2. `NuiBridge`（RFC-001 §3.4）+ `HeartbeatMonitor`（RFC-001 §3.7）
  3. `PluginManager` + `LayerSystem`（RFC-002 §3.4-§3.6）
  4. `WebSocketManager` + `HttpClient`（RFC-003 §3.2-§3.3）
  5. `SystemUIService`（RFC-006 §4.2）+ `ExportRegistry`（RFC-007 §4.3）
- 在补齐前，本包**不应被视为可用 runtime**——建议在 README/包描述里显式说明当前阶段仅交付被动数据容器，避免下游误用。

#### P0-2 `event-namespace.ts` 路由器没有任何调用方——RFC-003 §3.5 路由能力实质未连通

- **位置**：`workspace/runtime/src/event-namespace.ts:38-72`、整个 workspace
- **现状**：`parseEventName` 是纯函数，但没有 PostMessageRouter / handleEventSubscribe 调用它。grep 确认 src 中**没有任何文件 import 这个函数**（仅 `index.ts` re-export 与自身 test 引用）。
- **理由**：RFC-003 §3.5.2 的伪代码（`rfc-003-runtime-services.md:658-731`）规定：每个 `event:subscribe` 必须经命名空间路由后挂到 EventBus / NuiBridge / WSManager / SystemEventRegistry 之一。当前抽好的工具函数没有连到 Router，等价于「能识别合法 event 但不能真分发」。`isKnownNamespace` 列出的 5 个命名空间（`event-namespace.ts:13`）也未被任何 capability 检查消费。
- **建议**：与 P0-1 同步推进；当 PostMessageRouter 落地时必须使用 `parseEventName` + `isNamespaceError` 替代行内字符串解析，并把 5 个命名空间常量抽到 `@reui/interface`（参见 `review-interface.md` P1-2 提到的 `EVENT_NAMESPACES` 常量化建议）。

#### P0-3 `package.json` 标榜「EventBus / Auth / WebSocket / HTTP managers」但实际只有前两者——描述与现实不符

- **位置**：`workspace/runtime/package.json:5`
- **现状**：description 写「EventBus, Auth, WebSocket/HTTP managers (RFC-003)」，但 src 中没有 `WebSocketManager` / `HttpClient` 的任何痕迹。
- **理由**：包元数据是 monorepo 中其他包做依赖判断的真相源（review 接口包时也曾踩到 README 与实现脱节的问题）。当前文案会让 reviewer/集成者高估能力。
- **建议**：把 description 改成实际范围（如 `"ReUI Runtime — EventBus & AuthService (RFC-003 §3.1, §3.4). WebSocket/HTTP/PluginManager pending."`），等模块实现后再扩写。

---

### P1（重要）

#### P1-1 EventBus 没有按 RFC 区分通配符订阅的「权限受限」要求

- **位置**：`workspace/runtime/src/event-bus.ts:51-60,148-150,166-173`
- **现状**：`on('*', handler)` 与 `on('player:*', handler)` 都直接进入 `wildcardListeners`，没有任何调用方权限标记。
- **理由**：RFC-003 §3.1.3 表格明确「`*` 仅限管理插件使用」；RFC-002 §3.1.1 / §4.3.1 的 capability 模型也要求 PostMessageRouter 在路由 `event:subscribe` 时检查「事件命名空间是否在 plugin manifest 的 events 白名单内」。当前 EventBus 自身不区分「来源 = 插件 / 来源 = Runtime 内部」，未来 PostMessageRouter 一旦未做 capability 检查（或漏检），全局通配符会被任意插件订阅，构成水平越权（拿到所有插件间的事件流）。
- **建议**：
  1. 短期：给 `subscribeForPlugin` 加一个 `allowGlobalWildcard: boolean` 参数，且默认 false——禁止插件订阅 `*`。Runtime 内部代码继续用 `on()` 不受限。
  2. 长期：在 PostMessageRouter 落地时把「manifest.permissions/events」白名单作为路由前置条件（RFC-002 §4.3.1 的强制执行），与本处协同。

#### P1-2 `subscribeForPlugin` 在同一插件多次订阅同一 event/handler 时会产生重复 entry，进而在解绑时残留监听器

- **位置**：`workspace/runtime/src/event-bus.ts:105-119`
- **现状**：`pluginSubscriptions.get(pluginId).add(entry)` 中 `entry = { event, handler }` 是新对象引用，每次调用都会被加入 Set；但底层 `on` 的 `set.add(handler)`（`event-bus.ts:58`）对同一 handler 是幂等的（Set 去重）。结果：调 N 次相同订阅后 → listeners 中 1 条、pluginSubscriptions 中 N 条；卸载时 `unsubscribePlugin` 会对同一 handler 调 N 次 `off`，第一次成功，后面 N-1 次走 `set.delete(handler)` 但已经空了，是 no-op，无可见副作用。
- **理由**：当前不会导致泄漏，但**与「listeners 与 pluginSubscriptions 计数应一致」的不变量不符**——`pluginSubscriptionCount('inv')` 会返回 N，给运维/调试带来误导。RFC-003 §3.1 没明文规定，但作为单例服务的可观测性指标是必要的。
- **建议**：
  - 在 `subscribeForPlugin` 进入时先用 `(pluginId, event, handler)` 三元组去重——若已存在直接返回原 unsub，避免重复条目；
  - 或在 `on` 已经返回「已存在」语义时同步在 pluginSubscriptions 端做 short-circuit。
  - 顺手补一个用例：`subscribeForPlugin('inv', 'a', h); subscribeForPlugin('inv', 'a', h); expect(pluginSubscriptionCount('inv')).toBe(1)`。

#### P1-3 `subscribeForPlugin` 不支持通配符订阅时的资源回收语义

- **位置**：`workspace/runtime/src/event-bus.ts:105-119`、`148-150`
- **现状**：调用 `subscribeForPlugin('inv', 'player:*', h)` 时，`on()` 会把它放进 `wildcardListeners`；但 `unsubscribePlugin` 内部 `off(event, handler)` 也会走 `bucketFor(event)`（`event-bus.ts:62-68,148-150`）正确进入 wildcard 表——这部分实际没问题。**真正缺失的是用例覆盖**：`event-bus.test.ts:162-201` 只测了精确事件，没有「插件订阅 `player:*` 后 unsubscribePlugin 也能清理」的断言。
- **理由**：通配符订阅是 RFC-003 §3.1.3 的强能力，未来插件大概率使用 `roomName:*` 之类批量监听；如果回归测试缺失，后续重构很难捕捉到 wildcard bucket 选择错误（最常见的回归模式）。
- **建议**：补一条用例 `should clean up wildcard plugin subscription via unsubscribePlugin`，并在断言里同时校验 `wildcardListenerCount`。

#### P1-4 `parseEventName` 接受空命名空间但 RFC 表格未列出处理预期

- **位置**：`workspace/runtime/src/event-namespace.ts:39-45`
- **现状**：`':foo'` 走 `colonIdx <= 0` 返回 `INVALID_PARAMS`（test 在 `event-namespace.test.ts:40-43` 已覆盖），但 `'event'`（无冒号）也走同一分支返回的错误信息是「Event name must contain a non-empty namespace prefix」，与「无冒号」语义略偏。
- **理由**：错误码相同但 message 措辞容易让上游 SDK 把「整体没冒号」误归到「namespace 为空」。
- **建议**：分两类错误信息：
  - `colonIdx === -1` → `"Event name must contain a colon separator"`
  - `colonIdx === 0` → `"Event namespace must not be empty"`
  无需新增错误码，只是 message 区分度——便于 contract test 与生产日志分类。

#### P1-5 AuthService 的 update* 在「值未变化」时仍会广播——与 RFC-003 §3.4.2 描述「触发通知」一致，但缺少 RFC 文档对此 idempotent 行为的明文备书

- **位置**：`workspace/runtime/src/auth-service.ts:60-78`，注释 `auth-service.ts:11-13`
- **现状**：源码注释明确「即使值未变化也广播」，作者把它视为 idempotent 重置接口。然而 RFC-003 §3.4.2 「`updatePermissions` 触发 onPermissionChange 通知 + PluginManager 权限重评估」并未说「无变化也要触发」。在实际场景里 PluginManager 收到无变化的权限重评估意味着所有插件被无意义地重新审核。
- **理由**：在没有 PluginManager 的当前阶段不会出问题，但 PluginManager 一旦落地（RFC-002 §3.4.4「角色变更时的重评估」），频繁 noop 重算会带来明显代价。
- **建议**：保留「显式调用即广播」的 API 语义，但提供一个 `updatePermissionsIfChanged` 或在 PluginManager 端用「diff 后再调度」做剪枝；同时把当前选择写到 RFC-003 的实现注解里，避免未来 reviewer 反复争论。

#### P1-6 测试中存在「`it` 中多个意图」的轻度违规

- **位置**：
  - `workspace/runtime/tests/event-bus.test.ts:32-45`（`should support multiple handlers for the same event` —— 实际测了「两个 handler 都被调用」+「都拿到正确 payload」，可接受但贴近边界）
  - `workspace/runtime/tests/auth-service.test.ts:75-84`（`should support hasAnyPermission and hasAllPermissions` —— 一条用例同时测了 hasAny 的真/假与 hasAll 的真/假四种组合）
- **理由**：`.codebuddy/rules/001-testing.mdc`「一个用例一个意图，不允许在一个 `it` 里测多个 method」。`hasAnyPermission` 和 `hasAllPermissions` 是两个不同方法。
- **建议**：拆成 `should report any-match correctly` 与 `should report all-match correctly` 两条用例；EventBus 那条边界即可保留。

#### P1-7 `EventBus.subscribeForPlugin` 返回的 unsubscribe 调用后没有清理 listener bucket 的副作用——但这是 `on()` 自身职责，可能让人困惑

- **位置**：`workspace/runtime/src/event-bus.ts:114-118`
- **现状**：返回的 closure 调用 `unsub()` 会触发底层 `off`，再删除 entry。实现是对的；但代码读起来 `unsub()` 与 `set!.delete(entry)` 之间没有显式的「先 off 再删 entry」必要性注释——读者容易误以为可以并行。
- **理由**：保持代码可读性；该函数是热点（每个插件订阅都会经过）。
- **建议**：加一条短注释「先 off() 再清理反向索引；反过来会让 unsubscribePlugin 在并发下二次 off 同一个 handler」。仅文档级。

---

### P2（改进）

#### P2-1 `package.json` 缺少 `lint` / `test:types` / `size`（如适用）脚本

- **位置**：`workspace/runtime/package.json:16-22`
- **现状**：`lint` 占位为 `echo "(no lint configured yet)"`，无 `test:types`。`.codebuddy/rules/001-testing.mdc` 建议每包统一脚本集合。
- **建议**：补 ESLint 配置或显式说明本包不参与 lint；补 `test:types: vitest run --typecheck.only` 哪怕当前没 .test-d.ts 也保留入口。

#### P2-2 `vitest.config.ts` coverage exclude 仅排除 `src/index.ts`，未来加入纯类型文件会被错误纳入覆盖率

- **位置**：`workspace/runtime/vitest.config.ts:15-26`
- **建议**：与其他包统一为 `exclude: ['src/index.ts', 'src/types.ts', 'src/**/*.d.ts']`。

#### P2-3 `runtime/docs/` 是空目录但被纳入 git tree

- **位置**：`workspace/runtime/docs/`
- **建议**：要么放 `.gitkeep` 加 README 说明此处会承接 RFC 落地说明，要么从 git 剔除。

#### P2-4 `__resetForTests` / `__internal` 命名空间未在 index.ts 中标记为非公开 API

- **位置**：`workspace/runtime/src/event-bus.ts:42-44`、`auth-service.ts:54-56`、`workspace/runtime/src/index.ts:8-12`
- **现状**：`index.ts` 没有 re-export `__resetForTests`，但 `event-bus.ts` 中类静态方法 `__resetForTests` 是 public，外部 import `EventBus` 即可调用。
- **建议**：用 `/** @internal */` 标记 + 在 README/JSDoc 中明确「非测试代码不应调用」；或把它挪到 `src/__test-utils__.ts` 并配置 build 排除。当前代码层面写了「仅测试使用」的注释，但工具链不强制。

#### P2-5 `safeInvoke` / `notifyAll` 错误日志固定写 `console.error`，没有可注入的 logger

- **位置**：`event-bus.ts:175-182`、`auth-service.ts:142-151`
- **建议**：未来 SystemUIService / 集成 Fivemanage 日志（参见 `agents/skills/fivemanage/`）时希望将这些错误路由到中央 logger。预留一个模块级 `setLogger(fn)` 注入点会避免后续大改。

#### P2-6 `AuthService` 没有 `clear()` 一键重置 API

- **位置**：`workspace/runtime/src/auth-service.ts`
- **背景**：玩家登出 / 切角色场景下需要把 user / permissions / roles / token 全部还原。当前只能调四次 `update*(null/[])`。
- **建议**：加 `logout()`（语义化）或 `reset()`（中性），内部调四次 update，触发四组通知。

#### P2-7 `EventBus.emit` 在 wildcardListeners 数量大时是 O(N) 模式扫描

- **位置**：`event-bus.ts:94-98`
- **背景**：RFC-003 §8.2 性能验收要求「通配符订阅数量 ≤ 50 时无明显退化」。当前实现在每次 emit 时遍历所有 wildcardListeners，N 大于 50-100 后会有可见延迟。
- **建议**：观察期内不改；当性能成为瓶颈时换为「按命名空间前缀 group」的二级索引（emit 时只扫描 `${namespace}:*` 与 `*` 两组）。

---

## 4. 与各 RFC 的差距

### 4.1 与 RFC-001（通讯协议与核心通讯层）

| RFC 章节 | 期望 | 现状 | 差距 |
|---|---|---|---|
| §3.2 MessageDispatcher | 唯一 `message` 监听入口、`event.source` 分流、`reui:` 前缀过滤 | 不存在 | **完全缺失（P0-1）** |
| §3.3 PostMessageRouter | version 严格相等、capability 检查、method 路由表 | 不存在 | 完全缺失 |
| §3.4 NuiBridge | `handleGameMessage` + 经 EventBus 分发 `nui:*` | 不存在 | 完全缺失 |
| §3.6 握手流程 | `reui:handshake` + `reui:handshake-ack/reject` + 拒绝码 | 不存在 | 完全缺失 |
| §3.7 心跳机制 | HeartbeatMonitor、`reui:ping/pong`、超时清理 | 不存在 | 完全缺失 |
| §4.1 method 注册表 | 16 个 method handler | 不存在 | 完全缺失 |
| §5 安全考量 | iframe sandbox、来源验证、capability、攻击面分析 | 仅 AuthService 安全注释 | **runtime 层面无任何强制（P0-1）** |

### 4.2 与 RFC-002（插件系统）

| RFC 章节 | 期望 | 现状 | 差距 |
|---|---|---|---|
| §3.3 Runtime 加载入口 | bootstrap 脚本 + 启动顺序 | 不存在 | 完全缺失 |
| §3.4 PluginManager | 注册/卸载/互斥 panel/角色重评估/热重载 | 不存在 | 完全缺失 |
| §3.5 LayerSystem | HUD / Panel / Overlay 三层 + OverlayStack | 不存在 | 完全缺失 |
| §3.6 iframe 沙箱 | `sandbox="allow-scripts"`、pluginId 注入 | 不存在 | 完全缺失 |
| §3.7 插件状态机 | unloaded / loading / loaded / failed 转换 | 不存在 | 完全缺失 |
| §4.1 Schema 校验 | 加载前用 `@reui/cli` 的 Zod schema 校验 | 不存在 | **未消费 `@reui/cli`** —— package.json 里有依赖但 src 中 0 处 import |
| §4.2 嵌入式签名 | 生产环境必须验签 | 不存在 | 完全缺失（违反 AGENTS.md 关键约定第 5 条） |
| §4.3 运行时权限强制执行 | method → permission 映射 + PostMessageRouter checkCapability | 不存在 | 完全缺失 |
| §3.4.4 角色变更重评估 | onRoleChange → 重新审核每个插件 | AuthService 暴露了 onRoleChange，但无消费者 | 钩子在，订阅者不在 |

### 4.3 与 RFC-003（Runtime 单例服务与 SDK 模块）

| RFC 章节 | 期望 | 现状 | 差距 |
|---|---|---|---|
| §3.1 EventBus | 精确 + 通配 + 插件追踪 | ✅ 已实现，质量良好 | 见 P1-1/2/3 小问题 |
| §3.2 WebSocket Manager | 状态机、指数退避、离线队列 | 不存在 | 完全缺失 |
| §3.3 HTTP Client | 拦截器、重试、错误标准化 | 不存在 | 完全缺失 |
| §3.4 Auth Service | 被动模式、token 不外泄、变更通知 | ✅ 已实现，质量良好 | 见 P1-5 |
| §3.5 event:subscribe 路由 | parseEventName + 5 命名空间分流 | 工具函数已有，调用方不存在 | **路由能力未连通（P0-2）** |

### 4.4 与 RFC-006（Runtime 系统级 UI 服务）

| RFC 章节 | 期望 | 现状 | 差距 |
|---|---|---|---|
| §4.1 LayerSystem 扩展 System Layer | 第 4 层 + 渲染策略 | 不存在 | 完全缺失 |
| §4.2 SystemUIService | notify / confirm / toast 三个 API | 不存在 | 完全缺失 |
| §4.3 协议扩展 system:* | 4 个 method、2 个 push 事件、1 个错误码 | 不存在 | 完全缺失 |
| §4.4 PostMessageRouter 集成 | system:* 路由 + capability `system:dialog` | 不存在 | 完全缺失 |

### 4.5 与 RFC-007（插件导出与跨插件 / Lua RPC）

| RFC 章节 | 期望 | 现状 | 差距 |
|---|---|---|---|
| §4.3 ExportRegistry | 导出登记 + invoke 转发 + 死锁防护 | 不存在 | 完全缺失 |
| §4.4 PostMessageRouter 集成 exports:* | exports:invoke / exports:list 路由 | 不存在 | 完全缺失 |
| §4.6 Lua 桥接 resource | NUI callback `exports:invoke` + Lua exports.reui | 不存在（runtime 包不应直接持有，但 Runtime 启动时需挂监听） | 完全缺失 |
| §4.7 PluginManager 集成 | unload 时清理 ExportRegistry 注册项 | 不存在 | 完全缺失 |

---

## 5. 安全性评估

### 5.1 事件来源校验

- **RFC 要求**：RFC-001 §3.2 / §5.2 用 `event.source` 分流（iframe `sandbox="allow-scripts"` 让 origin 总是 `null`，不能用 origin 校验）。
- **现状**：MessageDispatcher 不存在，**没有任何来源校验**。一旦 runtime 接入真实环境，恶意/不可信 iframe 的 `postMessage` 将畅通无阻地与任何监听器交互。
- **风险等级**：阻断（P0-1）。
- **缓解建议**：实现 MessageDispatcher 时严格遵守「单一 listener + 仅信任 PluginManager.findBySource(event.source) 命中的窗口」（RFC-001 §3.2 第 226-249 行伪代码）。

### 5.2 签名与生产模式校验

- **RFC 要求**：AGENTS.md「关键约定」第 5 条 + RFC-002 §4.2「未签名包不得在 Runtime 中加载」。
- **现状**：runtime 不知道签名是何物。`@reui/cli` 已经实现 plugin manifest schema 与签名相关 schema（依赖关系来看），但 runtime 没有消费。
- **风险等级**：阻断。
- **缓解建议**：PluginManager 的 load() 第一步必须调用 `@reui/cli` 的 `verifyManifest(manifest, publicKey)`，开发模式可绕过但需打 `__DEV__` 警告（RFC-002 §4.2.5）。

### 5.3 跨插件隔离

- **RFC 要求**：iframe 间不直连（AGENTS.md 第 2 条）；通过 EventBus / ExportRegistry 中转。
- **现状**：EventBus 自身的实现层面**无法**判断「订阅来自插件 A」「emit 来自插件 B」——它只看 event 字符串。RFC-003 §3.5 通过 PostMessageRouter 在路由阶段为每个插件做命名空间隔离，runtime 缺这层。
- **风险等级**：缺失，需配合 P0-1 整体补齐。
- **缓解建议**：PostMessageRouter 一旦实现，订阅必须**强制走 `subscribeForPlugin(pluginId, ...)`**，禁止任何代码在「插件请求」路径上调 `bus.on()`（应该在 lint 规则或代码审查中强制）。

### 5.4 Token 暴露面

- **RFC 要求**：RFC-003 §3.4.4「Token 仅 Runtime 内存」「子页面无法通过任何 API 获取」；§8.3 验收点「子页面的 auth:getToken 请求被拒绝」。
- **现状**：AuthService 模块层面没暴露任何 `auth:getToken` method 注册（因为没有 PostMessageRouter）；`getToken` 的 JSDoc 也明确写了「严格仅 Runtime 内部使用」。这是当前体系里少数已落地的安全约束。
- **风险等级**：通过；但**取决于 PostMessageRouter 实现时不要错误注册 `auth:getToken`**——建议在 method 注册表里用 deny-list 显式断言「不存在 auth:getToken」。

### 5.5 通配符 `*` 滥用

- **RFC 要求**：RFC-003 §3.1.3「`*` 仅限管理插件使用」。
- **现状**：EventBus 自身允许任何调用方 `on('*', ...)`，RFC 要求的「仅管理插件」是路由层职责，但 EventBus 缺一道 defense-in-depth（参见 P1-1）。
- **风险等级**：低（路由层可补）；但建议补一层。

### 5.6 错误信息泄露

- **RFC 要求**：RFC-001 §4.2 错误码白名单。
- **现状**：`event-namespace.ts` 错误 message 直接拼接用户输入字符串（`"Unknown event namespace: \"${namespace}\""`、`event-namespace.ts:43,57`）。如果未来 message 被回写到 `reui:response` 的 error.message 直接返回给子页面，问题不大；但若 Runtime 把 message 送到游戏端日志或 Fivemanage，需要注意 `namespace` 中可能出现 ANSI 转义或控制字符。
- **风险等级**：低（理论风险）。
- **缓解建议**：在送日志前对用户输入字符串做长度截断 + 控制字符过滤；schema 层面也可让 event 名走白名单。

---

## 6. 改进建议（综合）

### 6.1 短期（不打破现有 API）

1. **加 README**（`workspace/runtime/README.md`），明确当前阶段交付范围 = EventBus + AuthService + 命名空间纯函数；明示其它模块属于待实现，避免下游误用。同时修正 `package.json` description（P0-3）。
2. **补全测试用例**：通配符的插件订阅清理（P1-3）、`subscribeForPlugin` 重复订阅幂等（P1-2）、AuthService logout 一键重置（P2-6）。
3. **错误信息细化**（P1-4）。
4. **测试拆分**（P1-6）。
5. **`__resetForTests` JSDoc 标 `@internal`**（P2-4）。

### 6.2 中期（实施 RFC-001/002）

按 RFC-003 §9.3 的实现顺序补齐：先 MessageDispatcher → PostMessageRouter → NuiBridge → HeartbeatMonitor → PluginManager → LayerSystem。每补一层，把 `parseEventName`、`AuthService.onPermissionChange` / `onRoleChange` 等已有钩子接到对应路由 / 重评估流程上，避免它们继续作为「孤岛」存在。

### 6.3 中期（实施 RFC-003 剩余 / RFC-006 / RFC-007）

WebSocket / HTTP / SystemUI / ExportRegistry 推荐分目录组织：

```
src/
├── core/                MessageDispatcher / PostMessageRouter / NuiBridge / HeartbeatMonitor
├── plugins/             PluginManager / LayerSystem / iframe-factory
├── services/            event-bus / auth-service / ws-manager / http-client
├── system-ui/           SystemUIService + dialog-renderer
├── exports/             ExportRegistry + lua-bridge-shim
└── index.ts             仅 re-export 公共类型 / 单例 getInstance
```

并把每个模块的单测目录与 `tests/{unit,integration,contract}` 分层一致（参见 `.codebuddy/rules/001-testing.mdc`）。

### 6.4 长期（性能与可观测性）

- 接入 logger（P2-5）；
- EventBus 通配符索引升级（P2-7）；
- 心跳监控落地后引入「插件健康度仪表盘」事件流，便于运维。

---

## 7. 总评

| 维度 | 评级 | 说明 |
|---|---|---|
| RFC-001 / 002 落地度 | ★☆☆☆☆ | 几乎为零，仅依赖路径预留 |
| RFC-003 §3.1 / §3.4 落地度 | ★★★★☆ | EventBus / AuthService 实现质量好，少量边界与可观测性可改进 |
| RFC-003 §3.2 / §3.3 / §3.5（连通） | ☆☆☆☆☆ | 完全缺失或工具函数无消费者 |
| RFC-006 / 007 落地度 | ☆☆☆☆☆ | 完全缺失 |
| 安全模型强制性 | ★☆☆☆☆ | 仅 Token 不外泄（被动一层）；其它由「类未实现」被动满足，非真正强制 |
| 测试规范遵循 | ★★★★☆ | AAA / 单例隔离 / 异常隔离 / 90% 阈值均到位，有少量「多意图用例」 |
| 文档与代码注释质量 | ★★★★☆ | EventBus / AuthService 注释写到了「为什么这样设计」（如快照迭代、idempotent 重置语义），符合规则要求 |

**核心结论**：当前 `@reui/runtime` 是一个**质量较高但范围极窄的服务库**——已实现的 EventBus 与 AuthService 在数据结构、API 形态、安全约束注释上都贴近 RFC-003，可作为后续 PostMessageRouter / PluginManager 落地时直接复用的「内部依赖」；但作为 ReUI 体系所宣称的「Runtime 宿主」，包内**8 成以上的核心模块仍然缺失**，AGENTS.md 列出的 8 条「关键约定」中目前只有「单例服务唯一来源（已实现的两个）」与「Token 不外泄」是被代码强制的，其余依赖未实现的 MessageDispatcher / PluginManager / LayerSystem 强制——本质上**整个体系的安全模型尚未在代码层面建立起来**。

下一阶段最关键的事项是：（1）在 `package.json` description 与 README 中如实声明当前范围；（2）按 RFC-001 §3.2-§3.7 顺序补齐通讯层骨架；（3）让 `event-namespace` / `subscribeForPlugin` / `onRoleChange` 这些已经写好的钩子被真正消费起来，避免「写了但没人用」继续累积。
