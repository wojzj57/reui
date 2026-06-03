# `@reui/core` 审查报告

> 审查者：reviewer-core
> 审查范围：`workspace/core/`（package.json / tsconfig.json / vitest.config.ts / .size-limit.cjs / src/** / tests/**）
> 对照基准：RFC-001（`docs/rfcs/rfc-001-protocol-and-core-communication.md`）、RFC-003（`docs/rfcs/rfc-003-runtime-services.md`）、`docs/plans/01-core-test-plan.md`、`.codebuddy/rules/001-testing.mdc`
> 审查目标：握手 / 心跳 / 请求-响应 / 订阅推送的协议正确性、来源校验与禁止直接监听 message 的安全约束、错误处理一致性、超时与重试、与 `@reui/interface` 协议契约一致性、测试覆盖与体积守护。

---

## 1. 包概览

### 1.1 用途

`@reui/core` 是子页面（iframe 插件）引入的 postMessage SDK，封装了与 Runtime 之间所有协议交互。当前阶段（RFC-001 落地版本）只交付通讯核心 `Client`，RFC-003 的 6 个公开 API 模块（`event` / `http` / `ws` / `auth` / `nui` / `plugin`）尚未实现，但已在 `src/index.ts:4-6` 留有显式占位注释。

### 1.2 模块结构

```
workspace/core/
├── package.json          私有包，dependencies: @reui/interface (workspace:*)
├── tsconfig.json         noEmit, paths 别名指向 ../interface/src
├── vitest.config.ts      jsdom 环境 + v8 coverage + 90% 全维门槛
├── .size-limit.cjs       10KB gzip 限制（指向 dist/index.js — 见 P1 §3.2）
├── src/
│   ├── index.ts          单例导出 + 顶层 init
│   ├── client.ts         Client 主体（握手 / request / push / ping）
│   ├── constants.ts      时序常量（HANDSHAKE_TIMEOUT_MS / RETRY_DELAYS_MS / REQUEST_TIMEOUT_MS / SDK_VERSION）
│   └── error.ts          ReUIError 统一错误类
└── tests/
    ├── setup.ts          注册 toContainMessageMatching matcher
    ├── helpers/          mock-runtime / iframe-window / factories / matchers / flush-promises
    ├── unit/             error.test.ts、client.resolve-plugin-id.test.ts
    ├── integration/      handshake / request-response / push-subscribe / heartbeat / message-validation
    └── contract/         protocol.test.ts（喂给 anyMessageSchema）
```

### 1.3 依赖

| 维度       | 内容 |
|------------|------|
| 运行时依赖 | `@reui/interface`（唯一） |
| 开发依赖   | `vitest 2.1.4` / `@vitest/coverage-v8` / `jsdom 25.0.1` / `size-limit 11.1.6` + `@size-limit/preset-small-lib` / `zod 3.23.8`（仅供契约测试） / `typescript 5.6.3` |
| 入口       | `src/index.ts`（types/import 同源），运行时 ESM；尚未配置 build 产物 |
| 被消费者   | 子页面（iframe 插件），通过 `import { init, ... } from '@reui/core'` 使用 |

### 1.4 与 RFC-001 / RFC-003 的边界

- 本期仅实现 RFC-001 §3.5（Client 类）+ §3.6（握手）+ §3.7 SDK 侧 pong 自动响应 + §4.2 错误码映射；
- 不包含 RFC-001 §3.7 中 Runtime 侧的 `HeartbeatMonitor`（属 runtime 包职责）；
- 不包含 RFC-003 §4 的 6 个公开 API 模块（event / http / ws / auth / nui / plugin），index.ts 已显式声明此为后续阶段。

---

## 2. 关键发现（亮点）

1. **协议代码骨架与 RFC-001 §3.5 高度一致**：handshake / handshake-ack / handshake-reject / request / response / push / ping / pong / notify 9 类消息全部覆盖；type 字符串、字段位置、`version` 透传与 RFC 文本一一对齐。
2. **来源验证严格遵循 RFC-001 §3.5 / §5.1**：`client.ts:385` 使用 `event.source === window.parent` 而非 `event.origin`，与 sandbox iframe 'null' origin 的现实约束一致；前缀过滤（`type.startsWith('reui:')`）与 RFC §3.1 强一致。
3. **targetOrigin 切换正确**：握手前用 `'*'`（`client.ts:206-216`），握手成功后切换到 `ack.payload.runtimeOrigin`（`client.ts:241`），后续 request / notify / pong 全部使用受信 origin（`client.ts:283 / 300 / 478`），完全符合 RFC-001 §3.6 时序图与 §988 验收清单。
4. **握手重试遵循 RFC-001 §3.6 的 1s/2s/4s 指数退避 + 3 次上限**：常量在 `constants.ts:20`，重试调度在 `client.ts:182-217`，重试耗尽时抛 `ReUIError('TIMEOUT', 'handshake', ...)` 并将 state 置为 `'failed'`。
5. **超时清理 / 资源回收做得干净**：
   - 请求超时回收 pending（`client.ts:262`），避免内存泄漏；
   - dispose 同时 reject 全部 pending（`client.ts:489-492`）、清理 handshake / retry 两类定时器、移除 message listener；
   - 测试 `pendingSize`、`subscriptionSize`、`currentRuntimeOrigin` 内省字段为断言资源无泄漏提供契约。
6. **订阅去重 + 失败回滚**：首次订阅才发 `event:subscribe`（`client.ts:329-345`），失败时回滚本地 handler，避免遗留孤儿订阅；最后一个 handler 移除才发 `event:unsubscribe`，幂等。
7. **单一 message 监听器 + Singleton**：仅 `attachMessageListener` 一处 `addEventListener('message')`，子页面没有也不需要自行监听原生 message —— 完美满足 AGENTS.md「关键约定」第 1 条。
8. **测试栈结构与 `docs/plans/01-core-test-plan.md` 完全契合**：`tests/{unit,integration,contract,helpers}` 镜像计划 §5 目录布局；factories 强制 RFC-001 字段单一来源；自定义 matcher `toContainMessageMatching` 替代 `toEqual` 全对象比对，符合规则 §4「断言粒度」。
9. **覆盖率达标且接近 100%**：基于 `coverage/lcov.info`：
   - `client.ts` lines 317/319 ≈ 99.4%、branches 100/107 ≈ 93.5%、functions 28/28 = 100%；
   - `constants.ts`、`error.ts` 全覆盖；
   - 唯二未覆盖的可执行行是 `client.ts:127-128`（`requestTimeoutMs` 自定义路径），低风险。
10. **错误模型一致**：所有用户侧 reject 路径都包了 `ReUIError`，`code` / `method` / `details` 三元组对开发者可读；`Object.setPrototypeOf` 兼顾打包/转译场景下的 `instanceof`（`error.ts:29`）。

---

## 3. 问题清单

> 优先级约定：P0 = 阻断；P1 = 应在合并前修复；P2 = 改进项 / 后续可处理。

### 3.1 P1：`size-limit` 守护链路缺失（不可执行）

`workspace/core/.size-limit.cjs:4` 把 `path` 指向 `dist/index.js`，但：

- `package.json` 没有 `build` 脚本；
- `tsconfig.json:5` 设置 `noEmit: true`；
- 工作区无 `dist/` 目录。

后果：

- `pnpm -F @reui/core size` 直接报 file not found；
- RFC-001 / 测试方案 §1 / `.codebuddy/rules/001-testing.mdc` 反复强调的 ≤ 10 KB gzip 守护**完全没有真正生效**；
- 一旦 RFC-003 把 6 个 API 模块塞进 `src/`，体积可能轻易越过 10 KB 而无人察觉。

建议：补一个面向 size-limit 的最小构建脚本（`tsup` / `esbuild`），或让 size-limit 直接读 `src/index.ts` 走 `webpack`/`esbuild` 内建打包（`@size-limit/preset-small-lib` 自带支持），并在 PR 流水线 §11.1 中实际跑 `pnpm size`。

### 3.2 P1：`SDK_VERSION` 写死 `'0.0.0-dev'`，与 package.json 漂移

`src/constants.ts:8` 的 `SDK_VERSION = '0.0.0-dev'`：

- 当前 `package.json:3` 是 `"version": "0.0.0"`，已经不一致；
- 握手 payload 的 `sdkVersion` 由它驱动（`client.ts:212`），Runtime 端要做版本协商时会拿到错误信息；
- 注释承诺 "构建脚本可在发布前覆盖"，但**没有**任何脚本做这件事，后续发布会把 `0.0.0-dev` 带入生产。

建议：
- 短期：让 build 步骤注入 `process.env.npm_package_version` 替换字面量，或借助 `define`；
- 长期：与 P1 §3.1 的 build 链路合并解决。

### 3.3 P1：`init` 自定义超时未在 `dispose()` / 失败重试时复位

`client.ts:126-131` 把 `options.handshakeTimeoutMs` / `options.requestTimeoutMs` 写入实例字段，但 `dispose()` 只复位 `runtimeOrigin / state / requestSeq / readyPromise / resolveReady / rejectReady`（`client.ts:496-501`），**没有把这两个字段恢复成 `HANDSHAKE_TIMEOUT_MS` / `REQUEST_TIMEOUT_MS` 默认值**。

后果：

- 测试代码靠 `Client.__resetForTests()` →`dispose()` + `_instance = null` 来复位；因为 `__resetForTests` 把 `_instance` 置 `null`，下次 `getInstance()` 重新构造，绕过了字段污染问题，所以测试不暴露此 bug。
- 但生产路径下 `dispose()` + 再次 `init({})` 不会触发新建实例（单例只在 `_instance === null` 时才 new），上一次自定义的短超时会**沉默地继承**到下一次会话。

建议：
- 方案 A：`dispose()` 末尾把这两个字段写回默认值；
- 方案 B：把 `requestTimeoutMs` / `handshakeTimeoutMs` 改为不可变的"每次 init 决定"局部 ref（在 `init` 入口先读 options，再传给 startHandshake / request 闭包）。
- 方案 A 改动小，推荐。

### 3.4 P2：`request()` 不支持 per-call 超时 override

RFC-001 §4.2 没强制要求，但实际场景中 `http:request` 的网络长尾、`auth:checkPermissions` 等的快速路径需要不同超时。当前所有 method 共享单一 `requestTimeoutMs`，未来 RFC-003 实现各 API 模块时会被迫绕弯（在模块层自实现 `Promise.race` 二级超时，违反"超时由 Client 统一管理"的契约）。

建议：把 `request<T>(method, params?, opts?: { timeoutMs?: number })` 作为 P3.x 阶段的扩展点提前规划，文档说明默认值。

### 3.5 P2：入站消息无 Zod 校验，分支防御依赖 `as` 断言

`handleMessage` 仅做 type 字符串前缀判断，便直接 `as HandshakeAckMessage` / `as ResponseMessage` 强转给后续 handler（`client.ts:393-411`）。

- 正常链路下 Runtime 已通过 `@reui/interface` schema 把控，理论上不会下发畸形消息；
- 但 SDK 侧没有最后一道防线，若 Runtime bug 或恶意 Runtime（理论上不存在，但安全模型不应排除）下发字段缺失的 ack，进入 `completeHandshake` 时 `ack.payload.runtimeOrigin` 可能为 `undefined`，后续 `runtimeOrigin || '*'`（`client.ts:241`）退回 `'*'`，行为是降级到不安全但能跑——隐蔽地丢失了 origin 锁定。
- contract 测试目前仅校验 **outbound** 消息（`MockRuntime.received`）符合 schema，**inbound** 没有断言对端必须合法。

建议（按重要性递减）：
1. 在 `handleMessage` 的每个 case 入口加 `xxxSchema.safeParse(data)`，失败时静默丢弃 + `console.warn`；
2. 或仅对关键消息（ack / response）做必填字段断言，其他保持现状以控体积；
3. 把 contract 测试扩展为同时校验 `MockRuntime.sent`（inbound 流）。

### 3.6 P2：`init()` 多次失败 → 再 init 时 `requestSeq` 不重置

`init()` 里只在 `state === 'failed'` 时把 state 重置为 `'idle'`，并未重置 `requestSeq`（`client.ts:113-117`）。`dispose()` 重置了 `requestSeq`，但二者并非总成对调用——失败后用户直接 retry init 是允许的路径（已有用例 `handshake.test.ts:207`）。

后果：失败重试后下一个 request id 仍然从历史值 +1 开始，不影响功能正确性，但不利于线上日志按 seq=1 找会话起点。

建议：在 "init 重试" 入口也 reset `requestSeq = 0`，与"全新会话"语义一致。

### 3.7 P2：`HandshakeRejectCode` → `ErrorCode` 类型转换使用 `as`

`client.ts:433` 写：

```ts
this.failHandshake(new ReUIError(code as ErrorCode, 'handshake', reason));
```

`HandshakeRejectCode = 'UNKNOWN_PLUGIN' | 'VERSION_MISMATCH' | 'PERMISSION_DENIED'`，确实是 `ErrorCode` 子集，但用 `as` 强转绕过了类型系统的兜底——一旦未来 `HANDSHAKE_REJECT_CODES` 中加入新值而 `ERROR_CODES` 漏改，编译器不会报错。

建议：在 `@reui/interface` 中加一行类型断言 `const _check: ErrorCode = '' as HandshakeRejectCode;`（编译期约束子集关系），并把 `as ErrorCode` 改为直接赋值（去掉 cast）。

### 3.8 P2：测试中存在与项目规则冲突的写法

`.codebuddy/rules/001-testing.mdc` §6 第一条明文禁止 `setTimeout(..., 0) + await new Promise(r => setTimeout(r, 50))` 风格。

`tests/integration/request-response.test.ts:74-77`：

```ts
runtime.on('slow', async () => {
  await new Promise<void>((r) => setTimeout(r, 50));
  return 'slow-result';
});
```

虽然 vi.useFakeTimers 接管后被 `vi.advanceTimersByTimeAsync(50)` 推进，**功能上是 OK 的**，但形式上违反规则原文。建议改为显式 `vi.waitFor` 或在 helper 提供 `delay(ms)` 工具，与规则保持字面一致，避免后续模仿者把它复制到不接管 timers 的场景。

### 3.9 P2：`init` 的同步错误路径返回 reject Promise，但状态被破坏

`client.ts:119-124`：

```ts
try {
  this.pluginId = this.resolvePluginId(options);
} catch (err) {
  return Promise.reject(err);
}
```

注意此分支发生在第 109 行的「已 ready 直接返回 readyPromise」之后、第 133 行 `state = 'connecting'` 之前。即只在 `idle` 或刚从 `failed` 复位时进入。问题在于：

- 若上一次 init 已 `connecting`，已经有 readyPromise；新 caller 不会进入此 catch（被前面的 short-circuit 拦截），OK；
- 若是 `failed` → 上面把 state 置回 `idle` + `readyPromise = null`，然后 `resolvePluginId` 抛错——此时**没有把 state 重新标记成 failed**，导致下一次 init 还是从 `idle` 进入。这刚好是用户期望的"修了 options 后再试"，所以语义正确。

但用例 `client.resolve-plugin-id.test.ts:70-81` 连续调用了两次 `client.init()` 都期待 reject——**这是巧合可用**，因为 resolvePluginId 不依赖 state，且每次都失败一次。建议把同步抛错的语义在注释里写明（"不污染 state，调用方可修正后重试"），并新增一个用例显式断言"reject 后再 init 仍然能被 resolve"。

### 3.10 P2：`SDK_VERSION` 与 `PROTOCOL_VERSION` 概念混淆

`client.ts:212` 在握手 payload 里塞 `sdkVersion: SDK_VERSION`，但 RFC-001 §3.6 时序图（rfc-001-md:635-645）只承诺握手 payload 含 `pluginId` 与 `sdkVersion`，并未要求 Runtime 据此做版本判定（VERSION_MISMATCH 由 `version` 字段驱动）。当前实现没问题，但 sdkVersion 本质是日志/诊断字段——建议在注释里写清楚（避免未来误改成版本协商主键）。

### 3.11 P2：`onPush` 失败后无重试通道

`client.ts:336-345`：首次订阅 `event:subscribe` 失败时回滚本地 handler 并 `console.warn`。开发者必须自行调度第二次 `onPush` 才能再次尝试 —— 没有提供"延迟重试"或"待 Runtime 恢复后自动续订"通道。

RFC-001 §6 没强制要求，记录为 P2。文档侧建议补一行说明，引导开发者写重试包装。

---

## 4. 与 RFC-001 / RFC-003 的差距

### 4.1 与 RFC-001 完全对齐的部分

| RFC 条目 | 实现位置 | 状态 |
|----------|----------|------|
| §3.5 Client 类骨架 | `src/client.ts` | ✅ 完整 |
| §3.5 `resolvePluginId` 顺序 | `client.ts:155-169` | ✅ options → URL → 抛错 |
| §3.6 握手时序 / `'*'` → runtimeOrigin 切换 | `client.ts:206 / 241 / 283` | ✅ |
| §3.6 1s/2s/4s 指数退避 / 3 次上限 / TIMEOUT 错误 | `client.ts:182-217 / constants.ts:20` | ✅ |
| §3.6 拒绝场景 `UNKNOWN_PLUGIN` / `VERSION_MISMATCH` / `PERMISSION_DENIED` | `handleReject` + 测试 | ✅ |
| §3.7 SDK 侧 ping → pong 自动响应（透传 timestamp） | `client.ts:470-480` | ✅ |
| §3.5 `event.source === window.parent` 鉴别 + reui: 前缀过滤 | `client.ts:385-390` | ✅ |
| §4.2 错误码（13 项） | 通过 `@reui/interface` 共享 | ✅ |
| §4.3 `ReUIError` 标准类 | `src/error.ts` | ✅ 含 details 字段 |

### 4.2 RFC-001 中尚未落地的部分

- **§5 安全层规约的"禁止子页面自行监听原生 message"约束**：源代码本身不可能强制 —— 这是开发者契约。RFC-003 阶段实现 6 个 API 模块时应**显式不再 `window.addEventListener('message')`**，全部走 `Client.onPush`。建议在 RFC-003 实现 PR 中加一条 ESLint 规则（`no-restricted-syntax`）拦截子页面级别的 message 监听。

### 4.3 RFC-003 的预期但未实现的部分（属于阶段计划，非缺陷）

- `event` / `http` / `ws` / `auth` / `nui` / `plugin` 6 个公开 API 模块均未交付。`src/index.ts:4-6` 已显式声明此为下一阶段任务。
- RFC-003 §6 `ErrorCode` 中的 `PAYLOAD_TOO_LARGE` 未在 `@reui/interface` 的 `ERROR_CODES`（13 项）中声明 —— 这是 **interface 包的差距**，但会在 core 实现 RFC-003 时立刻暴露（HTTP / WS 网关需要该错误码）。建议交叉提请 reviewer-interface 跟进。

---

## 5. 测试与体积评估

### 5.1 测试组织

| 维度 | 实际 | 计划要求 | 评价 |
|------|------|----------|------|
| 框架 | Vitest 2.1.4 | Vitest | ✅ |
| DOM 环境 | jsdom 25 | jsdom | ✅ |
| 目录布局 | unit / integration / contract / helpers | 同 | ✅ 一一对应 plan §5 |
| Fake timers | 全部测试 `vi.useFakeTimers()` + `advanceTimersByTimeAsync` | 强制 | ✅ |
| Factory | `tests/helpers/factories.ts` 9 类消息全覆盖 | 必需 | ✅ |
| 自定义 matcher | `toContainMessageMatching` 替代 `toEqual` | 必需 | ✅ |
| AAA 模式 | `// arrange / // act / // assert` 三段式 | 必需 | ✅ 几乎所有用例 |
| 类型测试 | 缺失 `*.test-d.ts`（plan §8.6 要求） | 应有 4 类断言 | ❌ 暂未提供，记 P2 |

### 5.2 用例覆盖（对比 plan §8.1-8.4）

| 编号 | 描述 | 状态 |
|------|------|------|
| 8.1.1 | 握手 ack → resolve | ✅ `handshake.test.ts:46` |
| 8.1.2 | 握手 reject → ReUIError | ✅ `handshake.test.ts:80` |
| 8.1.3 | 握手 N ms 超时 → TIMEOUT | ✅ `handshake.test.ts:135` |
| 8.1.4 | request 在 init 前等待 | ✅ `request-response.test.ts:161`（NOT_READY 反向）+ 各 init-ready 序列 |
| 8.1.5 | request 超时清理 pending | ✅ `request-response.test.ts:112` |
| 8.1.6 | 并发 request id 路由 | ✅ `request-response.test.ts:72` |
| 8.1.7 | onPush 首次订阅只发一次 | ✅ `push-subscribe.test.ts:43` |
| 8.1.8 | 最后一个 handler 触发 unsubscribe | ✅ `push-subscribe.test.ts:72` |
| 8.1.9 | ping → 同 tick 内 pong | ✅ `heartbeat.test.ts:38` |
| 8.1.10 | 非法消息忽略不抛 | ✅ `message-validation.test.ts:44 / 60 / 72 / 79` |
| 8.1.11 | runtimeOrigin 切换 | ✅ `handshake.test.ts:63` |
| 8.2 | resolvePluginId 三档 | ✅ `client.resolve-plugin-id.test.ts` |
| 8.4 错误码每码一例 | TIMEOUT / NOT_READY / METHOD_NOT_FOUND / RUNTIME_ERROR / VERSION_MISMATCH / UNKNOWN_PLUGIN / CAPABILITY_DENIED / EVENT_DENIED / INVALID_PARAMS 均有覆盖 | ✅ |
| 8.4 错误码每码一例（缺） | `PERMISSION_DENIED` / `NETWORK_ERROR` / `PLUGIN_NOT_FOUND` / `HANDSHAKE_REJECTED` 未见集成用例 | ⚠️ 部分缺 |
| 8.5 contract | `protocol.test.ts` 跑 schema | ⚠️ 仅 outbound smoke，未把所有集成场景的 received/sent 全喂 schema |
| 8.6 类型测试 | 缺 `*.test-d.ts` | ❌ |

### 5.3 覆盖率（基于现有 `coverage/lcov.info`）

| 文件 | Lines | Branches | Functions | 备注 |
|------|-------|----------|-----------|------|
| `src/client.ts` | 317/319 ≈ 99.4% | 100/107 ≈ 93.5% | 28/28 = 100% | 未覆盖 line 127-128（自定义 handshakeTimeoutMs）|
| `src/constants.ts` | 5/5 = 100% | n/a | n/a | |
| `src/error.ts` | 13/13 = 100% | 3/3 = 100% | 2/2 = 100% | |
| `src/index.ts` | 排除 | — | — | 计划 §9 排除项 |

全部维度均 ≥ 90%，`vitest.config.ts:26-31` 的 thresholds 通过。建议补一个最小用例覆盖 `handshakeTimeoutMs` override（消除第 127-128 行未覆盖痕迹）。

### 5.4 体积守护

- `.size-limit.cjs` 配置存在，目标 10 KB gzip；
- **但 `pnpm size` 当前不可执行**（见 §3.1），等价于守护链路缺失；
- `src/client.ts` 当前约 525 行 / `error.ts` 32 行 / `constants.ts` 24 行，代码量小，gzip 后大概率 < 4 KB；当前架构不会触发 10 KB 红线，但 RFC-003 把 6 个模块塞进来后必须落实。

### 5.5 CI 接入状态

- 仓库根目录无 `.github/`、`.gitlab-ci.yml`，无 woa pipeline 配置；
- `package.json` 已经按 plan §12 列出了完整 `scripts`，但没有任何 CI 实际去触发 `pnpm test:cov` / `pnpm size`。

---

## 6. 改进建议（按落地顺序）

### 6.1 短期（与 P1 配套，建议 RFC-001 验收前完成）

1. **接通 size-limit 链路（P1 §3.1）**：在 `package.json` 加 `"build": "tsup src/index.ts --format esm --dts"`（或同等 esbuild 配置），让 `.size-limit.cjs` 真正能跑；同时把 `SDK_VERSION` 通过 `define` 注入 package.json version（解决 P1 §3.2）。
2. **修 `dispose()` 不复位超时字段（P1 §3.3）**：在 `client.ts:496-501` 末尾加：
   ```ts
   this.requestTimeoutMs = REQUEST_TIMEOUT_MS;
   this.handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS;
   ```
3. **补齐错误码用例（plan §8.4 漏项）**：增加 `PERMISSION_DENIED` / `NETWORK_ERROR` / `PLUGIN_NOT_FOUND` / `HANDSHAKE_REJECTED` 的集成用例（每个一行 `runtime.fail(...)` 即可）。
4. **强化 contract 测试**：把 `MockRuntime.received` 与 `MockRuntime.sent` 在每个集成用例的 `afterEach` 里统一喂给 `anyMessageSchema.array().parse(...)`，本地测试时间影响可忽略。
5. **HandshakeRejectCode 子集类型保护（P2 §3.7）**：在 `@reui/interface` 加上编译期断言，并删除 `client.ts:433` 的 `as ErrorCode`。

### 6.2 中期（RFC-003 实现前）

1. **`request` 支持 per-call timeout**（P2 §3.4），为 6 个 API 模块的差异化场景提前留接口；
2. **加入入站 Zod 校验**（P2 §3.5），至少对 ack / response 做 `safeParse`；
3. **补齐 `*.test-d.ts`**（plan §8.6）：4 类类型断言（event handler unknown / http 泛型 / Unsubscribe / restoreState 泛型）；
4. **把 `init` 重试时 `requestSeq = 0`**（P2 §3.6），让会话语义清晰；
5. **接入 CI**（plan §11.1）：在 `.github/workflows/` 或 woa 流水线里跑 typecheck → test:cov → size，把 90% 阈值与 10 KB 守护落地。

### 6.3 长期（与 RFC-003 同步）

1. **6 个公开 API 模块**按 RFC-003 §4 落地，全部通过 `Client.request` / `Client.onPush` 复用；
2. **`@reui/interface` 补 `PAYLOAD_TOO_LARGE` 错误码**（差距 §4.3）；
3. **添加 ESLint 规则**禁止子页面侧 `window.addEventListener('message')`（差距 §4.2），把 AGENTS.md 关键约定 1 落到工具链；
4. **补齐 `samples/` 端到端验证**（plan §13 D3 决策的退出条件之一）。

---

## 7. 总结

`@reui/core` 当前阶段（RFC-001 通讯核心）实现质量**整体优秀**：协议骨架、来源校验、超时重试、资源清理、错误模型、测试覆盖、文档注释都达到合并标准。`Client` 与 RFC-001 §3.5 / §3.6 / §3.7 的对齐度极高，没有结构性偏差。

合并前**必须修复**的项集中在工程闭环：

- size-limit 链路缺失（P1 §3.1）
- SDK_VERSION 漂移（P1 §3.2）
- dispose 不复位自定义超时（P1 §3.3）
- plan §8.4 错误码用例尚有 4 项缺失
- contract 测试只 smoke 覆盖，未对所有集成场景 in/outbound 做 schema 兜底

其余 P2 改进项可在 RFC-003 实现 PR 中并行解决。RFC-003 的 6 个 API 模块尚未落地是当前阶段计划，不构成审查反对意见。

---

## 8. 附录

### 8.1 关键文件 / 行号速查

- 来源校验：`workspace/core/src/client.ts:385`
- 握手主体：`workspace/core/src/client.ts:182-247`
- 重试退避：`workspace/core/src/client.ts:197-202` + `workspace/core/src/constants.ts:20`
- targetOrigin 切换：`workspace/core/src/client.ts:206 / 241 / 283`
- request 超时清理：`workspace/core/src/client.ts:260-266`
- onPush 失败回滚：`workspace/core/src/client.ts:336-345`
- ping → pong 透传：`workspace/core/src/client.ts:470-480`
- dispose 资源回收：`workspace/core/src/client.ts:485-502`
- 入口单例 + 顶层 init：`workspace/core/src/index.ts:23-31`
- size-limit 配置：`workspace/core/.size-limit.cjs:1-9`
- 覆盖率门槛：`workspace/core/vitest.config.ts:26-31`

### 8.2 与其他审查角色的交叉建议

- **reviewer-interface**：缺 `PAYLOAD_TOO_LARGE` 错误码（差距 §4.3）；可考虑增加 `HandshakeRejectCode ⊂ ErrorCode` 编译期断言（§3.7）。
- **reviewer-runtime**：Runtime 端的 `HeartbeatMonitor`、`PostMessageRouter` 与本包构成对称契约；建议联合验证：当 Runtime 修改 `runtimeOrigin` 字段为空时，core 当前会回退 `'*'`（§3.5），是否符合 Runtime 期望需对齐。
- **reviewer-framework**：本期暂无直接耦合，待 RFC-003 / RFC-004 共同推进时再交叉。
