# `@reui/core` 测试方案与架构

> Status: **Accepted** · Phase: 配套 RFC-001 / RFC-003
> Source of truth：本文 + [`docs/designs/03-core-module-design.md`](../designs/03-core-module-design.md) + [`docs/rfcs/rfc-001-protocol-and-core-communication.md`](../rfcs/rfc-001-protocol-and-core-communication.md)
> 适用包：`workspace/core/`（`@reui/core`）

本文定义 `@reui/core` 的测试架构、规范、CI 接入与覆盖率策略。落地代码不在本文范围内，本文为后续实现的对齐基线。

---

## 1. 设计目标

| # | 目标 | 度量 |
|---|---|---|
| G1 | 保证 `Client` 协议正确性（握手 / request-response / push / ping-pong / 心跳） | 100% 协议分支覆盖 |
| G2 | 保证 7 个公开 API 模块（`event` / `http` / `ws` / `auth` / `nui` / `plugin` + `Client`）语义正确，且消息格式符合 RFC-001 | 行覆盖 ≥ 90%，分支覆盖 ≥ 90% |
| G3 | 保证错误处理路径（timeout / handshake-reject / permission-denied / capability-denied / network-error）可被开发者捕获 | 每个 `ErrorCode` 至少 1 个用例 |
| G4 | 防止协议字段漂移造成对 Runtime 的 silent break | 通过协议契约测试（Zod schema）保护 |
| G5 | 跑得快、零真实浏览器（单测 / 集成层面） | CI 单测阶段 ≤ 30s，使用 jsdom |
| G6 | 体积守护：构建产物 ≤ 10KB gzipped | size-limit 单独流水线 |

---

## 2. 测试金字塔

```
        ┌──────────────────────────┐
        │   E2E (samples/iframe)   │  暂不实施（见 §13 节决策）
        ├──────────────────────────┤
        │  Contract Tests          │  RFC-001 协议字段 Zod schema 校验
        ├──────────────────────────┤
        │  Integration             │  Client + 各 API 模块 + MockRuntime（主战场）
        ├──────────────────────────┤
        │  Unit                    │  纯函数 / 私有方法 / 错误映射
        └──────────────────────────┘
```

| 层 | 占比（建议） | 范围 |
|---|---|---|
| Unit | ≈ 60% | `resolvePluginId`、request id 生成、错误码映射、订阅去重逻辑 |
| Integration | ≈ 35% | 在 jsdom 中跑一个内存 `MockRuntime`，端到端验证 SDK 调用全链路 |
| Contract | ≈ 5% | 把 SDK 真实发出 / 接收的全部消息喂给 RFC-001 的 Zod schema |
| E2E | 0%（本期不做） | 待 RFC-002/003 落地后再讨论 |

---

## 3. 技术选型（已确认）

| 层 | 选型 | 备注 |
|---|---|---|
| 测试运行器 | **Vitest** | 与 Vite 同源，原生 ESM/TS，零额外配置 |
| DOM 环境 | **jsdom**（`environment: 'jsdom'`） | `MessageEvent` 行为与真实浏览器一致 |
| 断言 | Vitest 内置 `expect` | 不再引入 chai |
| Mock | Vitest 内置 `vi.fn` / `vi.useFakeTimers` | 全部用 fake timers 控制超时与心跳 |
| 协议契约 | **Zod**（与 `@reui/cli` 同风格） | Schema 抽到 `workspace/interface/`，Runtime / Core 共享真相源 |
| 类型测试 | **Vitest `expectTypeOf`** | 不引入 `tsd`，避免双工具链 |
| 覆盖率 | **Vitest + `@vitest/coverage-v8`** | reporter：`text` / `lcov` / `html` |
| 体积守护 | **size-limit + @size-limit/preset-small-lib** | 守住 < 10KB gzip |
| 覆盖率可视化 | **Codecov（codecov.io）** | 仅作 PR 评论 / 趋势可视化，**不做 hard gate**（详见 §9） |
| E2E | 暂不引入 | 待 Runtime 落地后再决策（见 §13） |

> **不选 Jest**：项目是 Vite/TS/ESM 体系，Jest 的 ESM 支持需要额外的 babel-jest 链路，迁移成本无收益。
> **不选 happy-dom**：其 `MessageEvent.source` 行为与真实浏览器存在差异，对 Client 测试不可靠。

---

## 4. 协议契约 schema 归属

> 这是本方案最重要的结构性决定之一。

`workspace/interface/` 作为 Runtime 与 Core 共享的协议真相源。RFC-001 的所有消息体（`reui:handshake` / `handshake-ack` / `handshake-reject` / `request` / `response` / `push` / `ping` / `pong` / `error`）以 Zod schema 形式定义在该包：

```
workspace/interface/
└── src/
    └── protocol/
        ├── messages.ts            # 全部消息 schema（Zod）
        ├── error-codes.ts         # ErrorCode 枚举
        └── index.ts               # 统一导出
```

- Runtime 与 Core 都从 `@reui/interface` 导入 schema 与对应的 `z.infer` 类型。
- 测试层（`workspace/core/tests/contract/`）直接复用这些 schema 做断言。
- 协议变更必须先改 `interface/`，由 PR 评审显式可见，杜绝两端"暗自漂移"。

> 实施提示：本文档不强制 schema 与运行时类型必须 100% 复用同一处定义；如运行时性能敏感，可让运行时用手写类型、schema 仅在测试 / Runtime 边界 / CLI 校验时启用。但**类型与 schema 的字段集合必须一致**，由 contract 测试兜底。

---

## 5. 包内目录结构

```
workspace/core/
├── src/
│   ├── client.ts
│   ├── event.ts
│   ├── http.ts
│   ├── ws.ts
│   ├── auth.ts
│   ├── nui.ts
│   ├── plugin.ts
│   ├── types.ts
│   └── index.ts
├── tests/
│   ├── unit/                              # 单元测试，文件名与 src 镜像
│   │   ├── client.resolve-plugin-id.test.ts
│   │   ├── client.request-id.test.ts
│   │   ├── error.test.ts
│   │   └── ...
│   ├── integration/                       # 集成测试（Client + API 模块）
│   │   ├── handshake.test.ts
│   │   ├── request-response.test.ts
│   │   ├── push-subscribe.test.ts
│   │   ├── heartbeat.test.ts
│   │   ├── event.test.ts
│   │   ├── http.test.ts
│   │   ├── ws.test.ts
│   │   ├── auth.test.ts
│   │   ├── nui.test.ts
│   │   └── plugin.test.ts
│   ├── contract/                          # 协议契约测试（消费 @reui/interface schema）
│   │   └── protocol.test.ts
│   ├── types/                             # 类型测试（expectTypeOf）
│   │   ├── event.test-d.ts
│   │   ├── http.test-d.ts
│   │   └── ...
│   ├── helpers/                           # 测试工具
│   │   ├── mock-runtime.ts                # 内存 Runtime（核心抽象）
│   │   ├── iframe-window.ts               # 构造 jsdom 中的 iframe 窗口
│   │   ├── flush-promises.ts
│   │   ├── factories.ts                   # 消息工厂
│   │   └── matchers.ts                    # 自定义 matcher（toContainMessageMatching 等）
│   └── setup.ts                           # 全局 setup（注册 matchers / polyfill）
├── vitest.config.ts
├── .size-limit.cjs
├── package.json
└── tsconfig.json
```

**约定**：

- 测试文件后缀：行为测试 `.test.ts`，类型测试 `.test-d.ts`。
- `tests/` 与 `src/` 镜像目录结构，便于按文件定位用例。
- 测试中所有外部时序（超时、心跳）一律使用 `vi.useFakeTimers()`，禁止真实 `setTimeout` 等待。

---

## 6. MockRuntime（测试基石）

`MockRuntime` 是整个 core 测试体系的核心抽象。它在内存中扮演 Runtime 角色，让 `Client` 跑在 jsdom 模拟的 iframe 环境里，无需启动真实 Runtime。

### 6.1 接口形状

```ts
// tests/helpers/mock-runtime.ts
export interface MockRuntimeOptions {
  origin?: string;                 // 默认 'https://runtime.reui.local'
  autoAck?: boolean;               // 默认 true，自动接受握手
  ackPayload?: Partial<HandshakeAckPayload>;
}

export class MockRuntime {
  /** 收到 iframe 发出的全部消息（按顺序） */
  readonly received: AnyMessage[] = [];
  /** 发回给 iframe 的全部消息（按顺序） */
  readonly sent:     AnyMessage[] = [];

  constructor(win: Window, opts?: MockRuntimeOptions);

  /** 注册某个 method 的 mock 处理器 */
  on(method: string, fn: (msg: RequestMessage) => unknown | Promise<unknown>): this;

  /** 主动向 iframe 推送 push 事件 */
  push(event: string, payload: unknown): void;

  /** 模拟握手拒绝 */
  rejectHandshake(code: string, reason: string): void;

  /** 心跳 ping，等待 iframe 回 pong */
  ping(): Promise<{ rttMs: number; received: boolean }>;

  /** 让指定 method 返回错误 */
  fail(method: string, error: { code: ErrorCode; message: string }): void;

  /** 清理监听 */
  dispose(): void;
}
```

### 6.2 实现要点

1. 在 `Window` 上 `addEventListener('message', ...)` 收集 iframe 的全部 outbound 消息进 `received`。
2. 向 iframe 投递时调用 `win.dispatchEvent(new MessageEvent('message', { data, source: parent, origin }))`；测试 setup 把 `window.parent` 替换为受控对象（`tests/helpers/iframe-window.ts`）。
3. 自动握手：收到 `reui:handshake` → 自动回 `reui:handshake-ack`（除非 `rejectHandshake` 已激活）。
4. 提供 `flushAll()`，配合 `vi.runAllTimersAsync()` 把整条链路推进到稳态。
5. **每个用例必须 `dispose()`**（用 `afterEach`），否则会跨用例泄漏 message listener。

### 6.3 消费方式

```ts
beforeEach(async () => {
  iframe   = setupIframeWindow();          // 构造 jsdom 的 iframe + 受控 parent
  runtime  = new MockRuntime(iframe.parent);
  vi.useFakeTimers();
  await client.init({ pluginId: 'test-plugin' });
});

afterEach(() => {
  runtime.dispose();
  iframe.dispose();
  vi.useRealTimers();
});
```

---

## 7. 测试规范（Conventions）

### 7.1 命名

```ts
describe('Client.handshake', () => {
  it('should resolve ready when runtime acks within timeout', async () => { ... });
  it('should reject ready with HANDSHAKE_REJECTED when runtime denies', async () => { ... });
});
```

- `describe`：用 **被测对象.行为域**，例如 `Client.request`、`event.on`。
- `it`：使用 `should <expected behavior> when <condition>`。
- 反例条件放 `when ...`，不要混进正常路径用例。

### 7.2 AAA 模式（强制）

每个用例严格三段：

```ts
it('should ...', async () => {
  // arrange
  ...

  // act
  ...

  // assert
  ...
});
```

禁止把断言穿插到 act 阶段。

### 7.3 时序

- 任何超时类断言一律 fake timers：`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`。
- 推进时间使用 `await vi.advanceTimersByTimeAsync(ms)`。
- 禁止使用 `vi.runAllTimers()`，避免无意中触发心跳循环导致用例不可重现。

### 7.4 断言粒度

对 `MockRuntime.received` 的断言要使用 **schema + 字段子集**，不要做整对象 `toEqual`：

```ts
expect(runtime.received).toContainMessageMatching({
  type: 'reui:request',
  method: 'http:request',
  params: { method: 'GET', url: '/api/x' },
});
```

提供自定义 matcher `toContainMessageMatching`（在 `tests/setup.ts` 注册），同时通过 Zod schema 校验整体合法性。这样字段顺序、新增字段都不会让用例脆弱。

### 7.5 一个用例一个意图

- 不允许在一个 `it` 里测多个 method。
- 不允许在 `beforeEach` 里写断言。
- `beforeEach` 只做 arrange：构造 `MockRuntime`、调用 `await init()`。

### 7.6 不可使用

- ❌ `setTimeout(..., 0)` + `await new Promise(r => setTimeout(r, 50))`：换 `await flushPromises()` 或 `vi.advanceTimersByTimeAsync`。
- ❌ 真实 fetch、真实 WebSocket：core 不直接连网络，所有网络都通过 Runtime 代理；测试里 mock 的是 Runtime 的响应，**不是 fetch**。
- ❌ `as any` 跳过类型：测试也要类型安全；私有字段用 `vi.spyOn` 或 `__internal` 命名空间。

### 7.7 Fixture & Factory

`tests/helpers/factories.ts` 必须提供工厂函数：

```ts
export const makeRequest = (over: Partial<RequestMessage> = {}): RequestMessage => ({...});
export const makePush    = (event: string, payload: unknown): PushMessage => ({...});
export const makeAck     = (over?: Partial<HandshakeAckPayload>): HandshakeAckMessage => ({...});
```

禁止在用例里硬编码 `{ type: 'reui:request', version: 1, ... }`，所有协议消息必须经工厂构造。

---

## 8. 关键测试用例清单（合入门槛）

下面列出的用例是 PR 合入的 **必须项**。

### 8.1 Client / 协议层

1. `init` 在握手 ack 后 resolve。
2. `init` 在握手 reject 后以 `ReUIError(HANDSHAKE_REJECTED)` reject，且 `code` / `method` 字段正确。
3. `init` 在 N ms 无 ack 时以 `TIMEOUT` reject。
4. `request` 在 init 完成前调用会等待握手再发出。
5. `request` 超时后清理 `pendingRequests`，避免内存泄漏（断言 `Map.size === 0`）。
6. 多个并发 `request` 各自得到正确响应（id 路由）。
7. `onPush` 首次订阅同一 event 只发出**一次** `event:subscribe`。
8. `offPush` 移除最后一个 handler 时发出 `event:unsubscribe`。
9. 收到 `reui:ping` → 在同一 tick 内回 `reui:pong`，timestamp 透传。
10. 非法消息（缺少 `reui:` 前缀、`source !== window.parent`、type 未知）一律忽略且不抛错。
11. `runtimeOrigin` 第一次握手用 `'*'`，后续一律使用 ack 中的 origin（断言 `postMessage` 第二次起的第二参数）。

### 8.2 资源解析

12. `resolvePluginId` 优先 options，其次 URL `?__reui_id=` 查询参数，否则抛错（错误信息包含修复指引）。

### 8.3 各 API 模块（每个模块同套路）

- 输入参数 → 发出的 request 字段正确（`method`、`params`）。
- 接收 response 后 resolve 出正确返回值。
- 推送类 API（`event.on` / `nui.onGameEvent` / `auth.onUserChange` / `ws.subscribe` / `plugin.onVisibilityChange` / `plugin.onBeforeUnload`）正确添加前缀。
- 取消订阅幂等：多次调用不报错、不重复发 unsubscribe。

### 8.4 错误处理

- 每个 `ErrorCode`（`TIMEOUT` / `NOT_READY` / `PERMISSION_DENIED` / `CAPABILITY_DENIED` / `METHOD_NOT_FOUND` / `RUNTIME_ERROR` / `NETWORK_ERROR` / `HANDSHAKE_REJECTED`）至少有一个集成用例。
- 抛出的错误必须 `instanceof ReUIError`，并且 `code` / `method` / `details` 字段可被开发者读取。

### 8.5 协议契约

- 把 RFC-001 列出的全部消息（handshake / handshake-ack / handshake-reject / request / response / push / ping / pong / error）写成 Zod schema，统一放在 `@reui/interface`。
- `tests/contract/protocol.test.ts` 跑遍所有集成场景，把 `MockRuntime.received` 与 `sent` 全部喂给 schema，任何一条不通过即 fail。
- 协议字段调整必须同步改 schema，让"协议变化"在 PR diff 里显式可见。

### 8.6 类型测试（`.test-d.ts`，使用 `expectTypeOf`）

- `event.on('foo', (data) => {})` 中 `data` 推断为 `unknown`，不是 `any`。
- `http.get<Player[]>(...)` 返回 `Promise<Player[]>`。
- `Unsubscribe` 是 `() => void`。
- `plugin.restoreState<T>()` 返回 `Promise<T | null>`。

---

## 9. 覆盖率门槛

| 指标 | 阈值 |
|---|---|
| Statements | **≥ 90%** |
| Branches   | **≥ 90%** |
| Functions  | **≥ 90%** |
| Lines      | **≥ 90%** |

未达阈值 CI 直接红。

`vitest.config.ts` 关键片段（实施时落盘）：

```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./tests/setup.ts'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'html'],
    include: ['src/**/*.ts'],
    exclude: ['src/index.ts', 'src/types.ts'],   // 纯 re-export / 类型定义
    thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
  },
},
```

> 排除 `index.ts` / `types.ts` 是因为它们只是 re-export 与类型声明，纳入会让覆盖率指标被无意义地稀释。

---

## 10. Codecov 接入策略

启用 Codecov（codecov.io），但 **仅作为 PR 上的可视化辅助，不作为 hard gate**。理由：

- 本地 / CI 主门槛是 Vitest 的 `coverage.thresholds`（见 §9），未达即失败，已经是真正的质量闸。
- Codecov 的价值在 PR diff 行级覆盖、跨 PR 趋势、按目录统计——这是本地 lcov 报告做不到的可视化辅助。
- 把 Codecov 设为 hard gate 会让 PR 卡在第三方服务故障上，增加运维风险。

### 10.1 `codecov.yml`（实施时落盘）

```yaml
coverage:
  status:
    project:
      default:
        target: auto
        threshold: 1%
    patch:
      default:
        target: 80%
        informational: true     # 仅展示，不阻塞 PR
comment:
  layout: "diff, files"
  behavior: default
  require_changes: true
```

### 10.2 上报方式

CI 脚本中调用 `codecov-action`（GitHub）或等价工具（工蜂流水线）上传 `coverage/lcov.info`：

```yaml
- run: pnpm -F @reui/core test --coverage
- uses: codecov/codecov-action@v4
  with:
    files: ./workspace/core/coverage/lcov.info
    flags: core
    fail_ci_if_error: false   # 第三方服务故障不阻塞 CI
```

### 10.3 退出条件

如果 2 个 sprint 后没有 reviewer 在依赖 Codecov PR 评论，移除上报，避免 vendor lock。

---

## 11. CI 流水线

### 11.1 PR 流水线（每个 PR 必跑）

```yaml
- pnpm install --frozen-lockfile
- pnpm -F @reui/core typecheck
- pnpm -F @reui/core lint
- pnpm -F @reui/core test --coverage
- pnpm -F @reui/core build
- pnpm -F @reui/core size               # size-limit
- upload coverage to codecov            # informational only
```

### 11.2 Nightly（可选）

```yaml
- pnpm -F @reui/core test --coverage --reporter=junit
# E2E 暂不接入；待 RFC-002/003 落地后再补
```

---

## 12. `package.json` scripts（建议）

```jsonc
{
  "scripts": {
    "test":       "vitest run",
    "test:watch": "vitest",
    "test:cov":   "vitest run --coverage",
    "test:types": "vitest run --typecheck.only",
    "size":       "size-limit",
    "lint":       "eslint src tests --max-warnings=0",
    "typecheck":  "tsc -p tsconfig.json --noEmit"
  }
}
```

---

## 13. 决策记录（Decision Log）

| # | 议题 | 决策 | 理由 |
|---|---|---|---|
| D1 | 测试运行器 | **Vitest** | 与 Vite 同源，零配置成本 |
| D2 | DOM 环境 | **jsdom** | `MessageEvent` 行为稳定，与真实浏览器一致 |
| D3 | E2E 范围 | **本期不做** | 待 RFC-002 / RFC-003 落地后，有完整 Runtime 与 samples 再讨论 |
| D4 | Codecov | **接入 codecov.io，仅可视化** | 不做 hard gate，避免第三方依赖；2 sprint 后 review 是否保留 |
| D5 | 覆盖率门槛 | **statements / branches / functions / lines 全部 ≥ 90%** | 跑 2 周后视真实分布再调 |
| D6 | 类型测试工具 | **仅 `expectTypeOf`** | 不引入 `tsd`，避免双工具链 |
| D7 | 协议 schema 归属 | **`workspace/interface/`（共享类型包）** | Runtime / Core 共同真相源；协议变化在 PR diff 显式可见 |

---

## 14. 上线步骤（实施顺序）

1. **协议契约先行**：在 `workspace/interface/` 新建 `protocol/` 目录，把 RFC-001 全部消息体写成 Zod schema，作为后续所有断言的基础。
2. **测试骨架**：`vitest.config.ts` / `tests/setup.ts` / `tests/helpers/mock-runtime.ts` / `tests/helpers/iframe-window.ts` / `tests/helpers/factories.ts` / `tests/helpers/matchers.ts`。
3. **Client 集成测试**：握手 → request → push → ping，覆盖约 70% 协议代码。
4. **API 模块测试**：每个模块一个 `*.test.ts`，复用 MockRuntime。
5. **错误路径**：补齐每个 `ErrorCode` 的用例。
6. **类型测试**：补齐 `*.test-d.ts`。
7. **覆盖率与 size-limit 接 CI**。
8. **Codecov 上报接入**（informational）。

---

## 15. 关联文档

- [`docs/designs/03-core-module-design.md`](../designs/03-core-module-design.md) — Core 模块设计（被测对象的真相源）
- [`docs/rfcs/rfc-001-protocol-and-core-communication.md`](../rfcs/rfc-001-protocol-and-core-communication.md) — 协议规范（契约测试的真相源）
- [`docs/rfcs/rfc-003-runtime-services.md`](../rfcs/rfc-003-runtime-services.md) — Runtime 单例服务（间接相关）
- [`docs/designs/04-communication-protocol.md`](../designs/04-communication-protocol.md) — 通讯协议设计补充
