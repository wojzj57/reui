# `@reui/interface` 审查报告

> 审查者：reviewer-interface
> 审查范围：`workspace/interface/`（package.json / tsconfig.json / src/**）
> 对照基准：RFC-001（`docs/rfcs/rfc-001-protocol-and-core-communication.md`）
> 审查目标：协议契约完整性、Zod schema 严谨度、类型导出清晰度、`reui:` 前缀强制性、被 core/runtime 一致消费的程度

---

## 1. 包概览

### 1.1 用途

`@reui/interface` 是 Runtime 与 `@reui/core` 共享的 **协议真相源**（per AGENTS.md「关键约定」第 3 条 / RFC-001）。它把 RFC-001 §3.1 定义的 9 种 postMessage 消息形态、§4.2 的错误码集合与 §3.1 的协议版本号集中在一处，输出 Zod schema 与 TypeScript 类型。

按项目约定：协议变更必须先改 `@reui/interface` 再改其他包。

### 1.2 模块结构

```
workspace/interface/
├── package.json         私有包，dependencies: zod ^3.23.8
├── tsconfig.json        继承 ../../tsconfig.base.json，rootDir=src，types=[]
└── src/
    ├── index.ts         re-export './protocol'
    └── protocol/
        ├── index.ts     re-export './error-codes' + './messages'
        ├── error-codes.ts  ERROR_CODES (13 项) + HANDSHAKE_REJECT_CODES (3 项) + 对应类型
        └── messages.ts     PROTOCOL_VERSION + 9 个 zod schema + 1 个 anyMessageSchema 聚合
```

### 1.3 依赖

| 维度 | 内容 |
|------|------|
| 运行时依赖 | `zod ^3.23.8`（schema 校验唯一外部依赖） |
| 开发依赖 | `typescript ^5.6.3`、`vitest ^2.1.4` |
| 出口（exports） | `.`（= src/index.ts）与 `./protocol`（= src/protocol/index.ts），均为 ESM-only，types 与 import 同源 |
| 被消费者 | `@reui/core`（src/{index,client,error}.ts）与 `@reui/runtime`（仅 package.json + tooling 路径别名，**src 尚未实际 import**） |

---

## 2. 关键发现（亮点）

1. **协议常量 / 类型 / Zod schema 一一对位，单一真相源落实到位。** `messages.ts` 中每条 `xxxSchema` 都通过 `z.infer` 反推出对应 `XxxMessage` 类型，避免了 schema 与 TS 类型双写漂移。`workspace/interface/src/protocol/messages.ts:26,38,45,55,66,75,88,94,104,112,121,129,152` 均使用同一手法，覆盖 RFC-001 §3.1 的全部 9 种消息类型 + handshake-ack 的 payload 子模式。
2. **`PROTOCOL_VERSION` 既导出常量又导出类型。** `messages.ts:10-13` 用 `as const` + `typeof PROTOCOL_VERSION` + `z.literal(PROTOCOL_VERSION)`，让运行时严格相等检查（RFC-001 §3.1 严格匹配策略）和编译期类型收窄共用同一个数字字面量，是单值真相源的最佳实践。
3. **错误码与握手拒绝码分级管理。** `error-codes.ts:7-32` 把全部 13 个错误码（`ERROR_CODES`）与可在 `reui:handshake-reject` 中出现的 3 个子集（`HANDSHAKE_REJECT_CODES`）分别声明并以 `as const` 锁定字面量类型，再用 `z.enum(HANDSHAKE_REJECT_CODES)` 在 `handshakeRejectSchema` 上做白名单收窄（`messages.ts:52`）。这是 RFC-001 §3.1 拒绝码语义子集的精确落地。
4. **响应消息使用 `discriminatedUnion('success', …)`，错误体内嵌 `z.unknown()`。** `messages.ts:90-94` 用 `success` 字段做 discriminator，让 `success: true` 的成功响应和 `success: false` 的错误响应共享同一 `type: 'reui:response'` 字面量，与 RFC-001 §3.1 接口定义完全一致；`successResponseSchema.result` 和 `errorResponseSchema.error.details` 用 `z.unknown()` 留给业务层自己 narrow，避免 interface 包过度耦合上层语义。
5. **`anyMessageSchema` 注释清晰说明为何用 `z.union` 而非 `z.discriminatedUnion('type')`。** `messages.ts:133-152` 提示 `reui:response` 的 type 字面量重复，因此顶层只能用 `z.union`，并提示其用途为 contract test，反映了作者对 Zod 行为的准确把握。
6. **Subpath export `./protocol` 让消费方可以浅路径 import。** `package.json:10-19` 同时暴露 `.` 与 `./protocol`，两条路径 types 与 import 一致，便于未来按子域细化。
7. **被 `@reui/core` 完整消费。** `core/src/client.ts:17-25` 一次性 import `PROTOCOL_VERSION` + 5 个消息类型；`core/src/error.ts:11` 仅引入 `ErrorCode` 类型；`core/tests/helpers/factories.ts:1-15` 全量 import 工厂所需的 12 个类型与 `PROTOCOL_VERSION` 单常量；`core/tests/contract/protocol.test.ts:2` 用 `anyMessageSchema` 做契约测试。这与项目「factories 必须从 schema 派生类型」的测试规范（`.codebuddy/rules/001-testing.mdc`）形成正反馈。

---

## 3. 问题清单

> 标注约定：**Px** = 优先级（P0 阻断 / P1 重要 / P2 改进），紧随其后是 `文件:行号` 与理由。

### P0（阻断）

无。当前 schema 集合可被 `@reui/core` 完整生产；本次审查未发现会让协议失效或导致 RFC-001 §3.1/§4.2 语义错位的硬阻断问题。

### P1（重要）

#### P1-1 `requestSchema` 缺少 `id` 格式约束 — 与 RFC-001 §3.1 「id 格式: `{pluginId}:{sequence}`」 不一致

- **位置**：`workspace/interface/src/protocol/messages.ts:59-66`
- **现状**：`id: z.string().min(1)` 只要求非空字符串。
- **理由**：RFC-001 §3.1 行 131 与 附录 B 行 1081 / 1083 都明确 id 形如 `{pluginId}:{sequence}`，且 `core/src/client.ts:258` 也按此格式生成。如果 schema 不收窄，未来 contract test 无法捕捉到「id 不带 `:` 分隔符」的实现回归（例如错误地用 UUID 替代）。
- **建议**：在 `requestSchema.id` 上增加 `regex(/^[^:]+:\d+$/)` 之类的格式校验，或者把规则上升到 `responseSchema.id`（成功 / 错误两条都需要）。如果担心 v1 太严格，可先放在 contract test 的 `expect.toMatch(...)` 而不是 schema 上，但要在 schema 文件添加 TODO 注释以防遗忘。

#### P1-2 `pushSchema` 的 `event` 缺少命名空间前缀校验 — 与 RFC-001 §3.1 「事件命名空间」表不一致

- **位置**：`workspace/interface/src/protocol/messages.ts:98-104`
- **现状**：`event: z.string().min(1)`，未限定前缀。
- **理由**：RFC-001 §3.1（行 187-202）规定 push 事件必须以 `event:` / `nui:` / `ws:` / `auth:` / `plugin:` 之一开头，附录 C（行 1093-1113）进一步用此前缀做 Router 内部分流。当前 schema 让任意字符串都能通过，未来 Runtime 端如果误发不带命名空间的 push，contract test 无从拦截；@reui/core 的 `onPush` 也无法在编译期收窄 event。
- **建议**：在 `pushSchema.event` 上加 `regex(/^(event|nui|ws|auth|plugin):.+/)`，并把 5 个前缀提升为 `EVENT_NAMESPACES` 常量数组（与 `ERROR_CODES` 同样的 `as const` 模式），让 router 与 SDK 共用，便于将来扩展（与 RFC-007 的 `exports:` 命名空间预留接口）。

#### P1-3 `notifySchema` 缺少 `id` 字段，但 SDK 把 notify 与 request 的 method 同等对待 — 协议合理，但缺少 RFC 文档要求的「method 名称白名单」校验

- **位置**：`workspace/interface/src/protocol/messages.ts:106-112` + RFC-001 §4.1
- **现状**：`method: z.string().min(1)` 不收窄到 RFC-001 §4.1 的方法注册表。
- **理由**：interface 包是协议真相源，应当能在测试期间断言「method 必须是已注册方法之一」。当前 `requestSchema.method` 与 `notifySchema.method` 都只校验非空，对 typo（`http:requst`、`auth:hasPemission`）束手无策。
- **建议**：在 `messages.ts` 中导出 `KNOWN_METHODS` 常量（按 RFC-001 §4.1 的表格）并提供两份 schema：
  - 严格版（`strictRequestSchema` 用 `z.enum(KNOWN_METHODS)`）— contract test 与生产 Runtime Router 使用；
  - 宽松版（当前 `requestSchema`）— 给 RFC-007 这种「插件自定义 method」场景用。
  - 如果担心 v1 阶段未稳定，至少在 `messages.ts` 中加 `// TODO(rfc-001): tighten method to known set once §4.1 stabilizes`。

#### P1-4 `requestSchema.params` 与 `notifySchema.params` 用 `z.unknown().optional()` 但缺省时不会出现在序列化对象中 — 测试断言的字段子集策略需要明确

- **位置**：`workspace/interface/src/protocol/messages.ts:64-65`、`110-111` + `core/src/client.ts:281,298`
- **现状**：core 使用 `...(params === undefined ? {} : { params })` 选择性写入；schema 用 `optional()` 允许该键缺席。
- **理由**：`z.unknown().optional()` 的语义是「字段存在但允许 undefined」与「字段缺席」二者皆通过；项目测试规范（`.codebuddy/rules/001-testing.mdc` §「断言粒度」）要求用「schema + 字段子集」方式断言。当前是行为正确的，但 contract test 在判断「params 是否被写入」时不能依赖 schema 单独完成，需要补充 `expect.objectContaining` 或额外断言。
- **建议**：在 `messages.ts` 中以 JSDoc 明确「params 缺席等价于无参数」的约定，避免后续维护者把 schema 改成 `z.unknown()`（去掉 optional）从而错误地强制要求 key 存在。优先级 P1，因为这是契约语义留白容易引发回归的地方。

#### P1-5 `package.json` 没有 `lint` / `test:cov` / `size` 等本仓约定脚本 — 与 `.codebuddy/rules/001-testing.mdc` 的 scripts 模板偏离

- **位置**：`workspace/interface/package.json:20-26`
- **现状**：仅有 `test` / `test:watch` / `test:cov` / `typecheck` / `lint`（后者占位为 echo）。`tests/` 目录不存在，因此 `test` 实际上不会跑任何用例。
- **理由**：本仓 testing 规则要求「每个 workspace 包独立维护 tests/ 目录」并配齐脚本。`@reui/interface` 是协议真相源，没有自己的 contract test（虽然 core 在跑 `anyMessageSchema.parse(...)` 间接覆盖了），缺乏第一手保护：未来如果 core 临时把 import 换成本地拷贝，schema 静默退化无法被 CI 捕获。
- **建议**：
  1. 新增 `workspace/interface/tests/contract/messages.test.ts`，针对每个 schema 至少断言「合法样本通过」+「非法样本被拒」（特别是 `version !== 1`、`type` 拼写错误、错误码白名单越界）。
  2. 新增类型测试 `tests/types/messages.test-d.ts`，用 `expectTypeOf` 锁定 `HandshakeMessage['version']` 等关键字面量类型，防止 `as const` 被无意删除。
  3. 在 `package.json` 增加 `test:types` 脚本以与其他包对齐。

### P2（改进）

#### P2-1 `messages.ts` 缺少 strict mode（`.strict()`）— 多余字段不会被拒绝

- **位置**：`workspace/interface/src/protocol/messages.ts` 全部 schema
- **现状**：默认 `z.object({...})` 行为是 strip 多余字段，不会报错。
- **理由**：协议是抗伪造与抗版本漂移的关键防线。如果未来插件构造了 `{type:'reui:request', version:1, id:'x:1', method:'foo', __forge__:true}`，Runtime 直接 parse 通过且 strip 掉伪字段，但相关 telemetry 也会被吞掉。建议在 contract test 中至少跑一次 `.strict()` 版本，或者在 interface 包暴露 `strictAnyMessageSchema` 供 Runtime 端使用。
- **建议**：在 `messages.ts` 末尾追加：
  ```ts
  export const strictAnyMessageSchema = z.union([...]).pipe(
    z.unknown().refine(/* no extra keys */),
  );
  ```
  或者更简洁地为每个子 schema 提供 `.strict()` 版本。优先级 P2，因为生产代码并未依赖此能力。

#### P2-2 `anyMessageSchema` 注释说明的 `discriminatedUnion('type')` 限制可在未来 zod 4 解锁 — 现注释未给出迁移钩子

- **位置**：`workspace/interface/src/protocol/messages.ts:133-152`
- **理由**：注释解释了「为何不用 discriminatedUnion」，但 zod 自 3.22 起支持 nested discriminator 的解决方案（`z.discriminatedUnion('type', [..., responseSchema])` 在某些版本中会因 `responseSchema` 本身是 union 而失败）。建议在注释里追加「升级 zod 后可以重新评估」的迁移钩子，便于将来 perf 优化（`z.union` 的 parse 是线性扫描，`discriminatedUnion` 是 O(1)）。
- **建议**：补一行注释：`// TODO: revisit once zod supports nested-union discriminators efficiently.`

#### P2-3 `HandshakeAckPayload.config.layer` 用 `z.string()`，未约束到 4 个合法 layer 名

- **位置**：`workspace/interface/src/protocol/messages.ts:33-37`
- **理由**：AGENTS.md「关键约定」第 6 条规定 layer 必须是 HUD / Panel / Overlay / System 之一。当前 schema 没收窄，让 ack 携带任意字符串。考虑到 layer 定义可能由 RFC-002 / RFC-006 进一步细化，目前定为 P2，但应当在 RFC-002 落地时强制收窄。
- **建议**：等 RFC-002 把 layer 名集合冻结后，新增 `LAYERS` 常量并 `z.enum(LAYERS)`。

#### P2-4 `HandshakeAckPayload.permissions` / `config.allowedEvents` 元素类型为 `z.string()`，没有 minLength

- **位置**：`workspace/interface/src/protocol/messages.ts:32,36`
- **理由**：与其他字符串字段（如 `pluginId`、`sdkVersion`、`runtimeOrigin`）都使用 `z.string().min(1)` 不一致。应保持一致防止空字符串被当作有效权限。
- **建议**：把数组元素类型从 `z.string()` 改为 `z.string().min(1)`。

#### P2-5 `package.json` 的 `version: "0.0.0"` 与 `description` 提到「Source of truth for RFC-001」，但缺少 `keywords` / `repository` 字段

- **位置**：`workspace/interface/package.json:1-34`
- **理由**：因为 `private: true`，对发布无影响；但作为 monorepo 内文档化媒介，加上 `keywords: ['reui','protocol','rfc-001']` 和 `repository.directory` 有助于工具链（IDE、`pnpm why`、IDE 文档悬浮）展示更多上下文。优先级 P2。
- **建议**：补 `keywords`、`sideEffects: false`（schema 文件均为纯模块），便于消费方做 tree-shaking 评估。

#### P2-6 `ErrorCode` / `HandshakeRejectCode` 缺少与 RFC-001 §4.2 错误码列表的「双向校验」机制

- **位置**：`workspace/interface/src/protocol/error-codes.ts`
- **理由**：当前完全靠人工对账。如果 RFC-001 §4.2 新增 `RATE_LIMITED` 而 `ERROR_CODES` 漏写，CI 不会发现。
- **建议**：在 `tests/contract/error-codes.test.ts` 中加一个轻量元测试，从 RFC 文档 markdown 表格 grep 出所有 `\| \w+ \|` 的错误码并和 `ERROR_CODES` 做 setEqual 断言。也可作为「文档驱动测试」的范例落地到 P1-5 推荐的 `tests/` 目录中。

#### P2-7 `tsconfig.json` 没有 `composite: true` / `declaration: true` — 在未来 build 模式下可能踩坑

- **位置**：`workspace/interface/tsconfig.json:1-9`
- **理由**：当前消费方都通过 `paths` 别名直接读 `src/index.ts`，没有走构建产物。一旦未来打算在生产构建用 `tsc -b`（项目引用），interface 必须开 `composite: true` 才能作为依赖被引用。
- **建议**：`tsconfig.base.json` 中是否已开启需确认；如未开启，可在本包的 `compilerOptions` 中显式加 `"composite": true, "declaration": true, "declarationMap": true`，提前为 build pipeline 让路。优先级 P2，目前不阻断。

#### P2-8 `HandshakeRejectPayload.code` 与 `ErrorResponse.error.code` 共享同一错误码空间但语义不同 — 当前未文档化

- **位置**：`workspace/interface/src/protocol/{error-codes.ts,messages.ts}`
- **理由**：`HANDSHAKE_REJECT_CODES` 是 `ERROR_CODES` 的子集（仅 3 项），但 `HANDSHAKE_REJECTED` 错误码同时存在于 `ERROR_CODES` 中（行 19）。这两者关系并未在 JSDoc 中说明：到底 `HANDSHAKE_REJECTED` 是 SDK 把 reject payload 包装成 `ReUIError` 时使用的统一码，还是其他场景？
- **建议**：在 `error-codes.ts` 顶部 JSDoc 增加一段，澄清以下三点：
  1. `HANDSHAKE_REJECTED` = SDK 内部把 `reui:handshake-reject` 翻译为 `ReUIError` 的统一外部错误码；
  2. `payload.code` (3 个) = Runtime 在 reject payload 上携带的具体原因码；
  3. SDK `ReUIError.details` 应保留原始 reject payload 让上层访问。

---

## 4. 与 RFC-001 的差距

| RFC-001 章节 | 状态 | 说明 |
|---|---|---|
| §3.1 BaseMessage（type 前缀 `reui:`、version 严格相等） | ✅ 完整 | `z.literal('reui:xxx')` + `z.literal(PROTOCOL_VERSION)` 双重锁定，无法构造非 `reui:` 前缀的合法消息。 |
| §3.1 9 种消息类型 | ✅ 完整 | handshake / handshake-ack / handshake-reject / request / response(success/error) / push / notify / ping / pong 全部齐备。 |
| §3.1 事件命名空间（5 种 push 前缀） | ⚠️ 部分缺失 | schema 未强制 push.event 必须以 `event|nui|ws|auth|plugin:` 开头（见 P1-2）。 |
| §3.1 `id = {pluginId}:{sequence}` | ⚠️ 部分缺失 | 仅约束非空字符串（见 P1-1）。 |
| §3.1 协议版本严格匹配（`!== 1` 拒绝） | ✅ 完整 | `versionSchema = z.literal(PROTOCOL_VERSION)` 让其他版本号在 parse 时即失败。 |
| §3.1 layer 名集合 | ⚠️ 部分缺失 | `z.string()` 未收窄到 4 个合法 layer（见 P2-3，等 RFC-002 推动）。 |
| §4.1 方法注册表 | ⚠️ 缺失 | 未提供 `KNOWN_METHODS` 白名单（见 P1-3）。 |
| §4.2 错误码集合 | ✅ 完整 | 13 个错误码全数列出，与 RFC 表格一一对应；建议加文档驱动测试（见 P2-6）。 |
| §3.1 reui:handshake-reject 三种 reason code | ✅ 完整 | `HANDSHAKE_REJECT_CODES` 精确匹配 RFC 行 123。 |
| §6 测试计划（contract 测试） | ⚠️ 缺失 | interface 自身没有 tests/ 目录（见 P1-5）；目前依赖 core 的 `protocol.test.ts` 间接覆盖。 |
| §7.4 代码质量验收（无 `any` 类型逃逸 / JSDoc） | ✅ 通过 | 全文未出现 `any`，关键字段都有 JSDoc 注释（如 `PROTOCOL_VERSION` 升版规则）。 |

---

## 5. 改进建议（具体可执行）

按优先级排序，每项给出可直接落地的修改提示：

1. **【P1-5 / 立即】为 `@reui/interface` 创建 `tests/` 目录**，至少包含：
   - `tests/contract/messages.test.ts`：对 9 个 schema 写「合法样本通过 / 非法样本被拒」用例（模板可参考 `core/tests/helpers/factories.ts` 的工厂复用）。
   - `tests/contract/error-codes.test.ts`：断言 `ERROR_CODES` 与 RFC-001 §4.2 表格的元素一致（用 fs 读 RFC 文件 + 正则提取）。
   - `tests/types/messages.test-d.ts`：用 `expectTypeOf<HandshakeMessage['version']>().toEqualTypeOf<1>()` 锁定字面量。
   - `package.json` 增加 `test:types` 脚本与本仓 testing rules 对齐。

2. **【P1-2 / 紧接 §3.1 命名空间表】抽出常量并强约束 `pushSchema.event`**：
   ```ts
   export const EVENT_NAMESPACES = ['event', 'nui', 'ws', 'auth', 'plugin'] as const;
   export type EventNamespace = (typeof EVENT_NAMESPACES)[number];
   const pushEventPattern = new RegExp(`^(${EVENT_NAMESPACES.join('|')}):`);
   // pushSchema.event = z.string().regex(pushEventPattern, 'event must start with a known namespace')
   ```
   同步把 router 端的「分流 switch」改为基于 `EVENT_NAMESPACES` 遍历，避免双写。

3. **【P1-1 / 最小成本提升】给 `requestSchema.id` 与 `responseSchema.id` 加 `regex(/^[^:\s]+:\d+$/)`** —— 一行收窄即可让 contract test 自动捕捉错误的 ID 生成逻辑。

4. **【P1-3 / 与 RFC-007 协调】导出 `KNOWN_METHODS` 常量并提供 `strictRequestSchema`** ——
   - `KNOWN_METHODS` 列出 RFC-001 §4.1 的 15 个 method（event:* 3, http:* 1, ws:* 2, auth:* 3, nui:* 1, plugin:* 5）；
   - 将来 RFC-007 引入 `exports:invoke` 时再扩展。
   - 现阶段 Runtime Router 用 strict 版本，core 测试用 loose 版本。

5. **【P2-1 / 安全侧硬化】生成 `strictAnyMessageSchema`**，对每个 schema 调 `.strict()`，把多余字段视为错误。Runtime 收消息时用 strict 版本，避免被插件夹带。

6. **【P2-4 / 一致性】把 `permissions` 与 `allowedEvents` 元素改为 `z.string().min(1)`** —— 与 `pluginId`、`sdkVersion` 等已有字段统一。

7. **【P2-6 / 文档驱动测试】写一个轻量解析器读 `docs/rfcs/rfc-001-protocol-and-core-communication.md`** 的 §4.2 表格，与 `ERROR_CODES` 做 setEqual 断言；放到 `tests/contract/error-codes.test.ts`。这种「文档与代码双向锁」是协议包独有的优势用法。

8. **【P2-7 / 构建准备】跟 team-lead / runtime 维护者协调是否在本仓启用 TS Project References**，如启用则给本包补 `composite: true`。

9. **【P2-8 / JSDoc】在 `error-codes.ts` 顶部明确 `HANDSHAKE_REJECTED` 与 `HANDSHAKE_REJECT_CODES` 的关系** —— 防止后续维护者把两者混用。

10. **【P2-2 / TODO 留痕】`anyMessageSchema` 上方注释追加 `// TODO: re-evaluate discriminatedUnion once response schema flattens`** —— 给将来 perf 优化留下钩子。

---

## 6. 小结

`@reui/interface` 当前的实现质量在「单文件协议真相源」标准下属于良好水位：

- **结构正确**：常量 / 类型 / schema 三位一体，单一来源；
- **被一致消费**：core 全链路（src + tests）都从此包 import，runtime 已声明依赖只待源码上线；
- **风格规范**：`as const` / `z.literal` / `discriminatedUnion` 选用恰当，无 `any` 逃逸；
- **缺口集中在「严格度」与「自有测试」两个维度**：未对 push event、request id、known method、layer 等进行白名单/格式收窄；自身 `tests/` 目录尚未建立，护栏完全寄存在 core 包的 contract 测试中。

建议优先落地 P1-5（建 tests）、P1-2（push event 命名空间）、P1-1（id 格式）三项；其余 P1/P2 可在 RFC-002/RFC-007 推进时随节奏跟进。

— reviewer-interface
