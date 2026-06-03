# @reui/cli 包代码评审报告

- **评审范围**：`workspace/cli/`
- **评审依据**：RFC-002（插件系统）、RFC-005（CLI 工具链与开发体验）、`.codebuddy/rules/001-testing.mdc`
- **评审者**：reviewer-cli
- **评审日期**：2026-06-01
- **当前版本**：`0.0.0`（package.json）

---

## 1. 包概览

### 1.1 模块结构

```
workspace/cli/
├── src/
│   ├── index.ts                       # 包入口，re-export
│   ├── permission.ts                  # 运行时权限匹配（RFC-002 §4.3）
│   ├── project.ts                     # signProject / verifyProject 流水线（RFC-005 §3.2）
│   ├── scanner.ts                     # 插件目录扫描（注入式 fs）
│   ├── signer.ts                      # HMAC-SHA256 嵌入式签名（RFC-002 §4.2）
│   ├── validator.ts                   # Zod 校验 + override + 角色检查
│   └── schema/
│       ├── index.ts
│       ├── plugin-manifest.ts         # Zod Schema（single source of truth）
│       └── plugin-manifest.d.ts       # 纯类型声明（手写镜像）
├── tests/
│   ├── permission.test.ts
│   ├── project.test.ts
│   ├── scanner.test.ts
│   ├── signer.test.ts
│   └── validator.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 1.2 当前提供的能力

| 能力 | 实现位置 | 状态 |
|---|---|---|
| Zod Schema (plugin.json) | `src/schema/plugin-manifest.ts` | ✅ 已实现 |
| `validateManifest` | `src/validator.ts:32` | ✅ |
| `applyOverrides`（runtime.config.json） | `src/validator.ts:68` | ✅ |
| `checkRoleAccess` | `src/validator.ts:97` | ✅ |
| HMAC-SHA256 签名 / 验证 | `src/signer.ts` | ✅ |
| `hasPermission` / `canAccessPlugin` / `requiredPermissionFor` | `src/permission.ts` | ✅ |
| 插件目录扫描（注入式 fs） | `src/scanner.ts` | ✅ |
| `signProject` / `verifyProject`（项目级流水线） | `src/project.ts` | ✅ |

### 1.3 依赖

- 运行时依赖：仅 `zod ^3.23.8`
- 开发依赖：`@types/node`、`@vitest/coverage-v8`、`typescript`、`vitest`
- 平台依赖：`node:crypto`（HMAC、`timingSafeEqual`）、`node:fs`、`node:path`

### 1.4 命令 / 二进制

**当前未提供任何 CLI 命令或 `bin` 入口**：
- `package.json` 无 `bin` 字段
- 无 `commander` 依赖
- 无 `cli.ts` 入口文件
- 无 `vite-plugin/` 目录

仅暴露纯函数 API（库形态），与 RFC-005 计划的 `reui sign` / `reui verify` / `reui validate` / `reui init` / `reui list` 命令尚未对接。

---

## 2. 关键发现（亮点）

1. **职责分层非常清晰**：`scanner`（IO）/ `validator`（schema）/ `signer`（crypto）/ `project`（流水线）/ `permission`（运行时检查）边界明确，`project` 把"扫描+校验+签名"组合为纯数据流水线，CLI 入口只需负责着色/退出码。这与 RFC-002 §4 的"三层安全模型"以及 RFC-005 §3.2 的"读取 → 校验 → 签名/验证 → 汇总报告"高度一致。
2. **签名实现严谨**：
   - 仅对 SecuredFields 子集签名（`src/signer.ts:47-57`），与 RFC-002 §4.2.1 表格完全对齐；
   - 通过 `normalizeForSigning` 对 `permissions` / `roleRestriction` 排序，避免数组顺序差异引入签名漂移（`src/signer.ts:66-76`）；
   - 验证使用 `timingSafeEqual`（`src/signer.ts:141`），抵御时序攻击，符合 RFC-002 §4.2.2；
   - 解析 hex 前后做了长度校验，避免 `timingSafeEqual` 因长度不同抛错。
3. **入参不被修改**：`attachLock` / `signManifest` 都返回新对象（`src/signer.ts:109-114`，并被 `tests/signer.test.ts:135-139` 显式断言），符合"不污染源 plugin.json"的预期。
4. **scanner 软失败设计良好**：单插件 `plugin.json` 缺失/损坏不会中断整轮扫描，统一聚合到 `errors[]`，匹配 RFC-002 §3.3 的"格式错误立即跳过，不影响其他插件"。
5. **fs 注入**：`scanner.ts` 的 `ScanFs` 接口让单元测试无需写真实磁盘 fixture，符合 `.codebuddy/rules/001-testing.mdc` 的"避免硬编码协议消息字面量、便于 mock"原则。
6. **测试质量**：覆盖率门槛 90%（`vitest.config.ts:13-18`）已配置；测试文件结构遵循"AAA"，`signer.test.ts` 对篡改、错误算法、错误长度等关键安全路径有明确断言。
7. **schema 默认非 strict**：注释明确说明"为前向兼容允许未知字段"（`src/schema/plugin-manifest.ts:96-98`），与 RFC-002 §4.1"未知字段被忽略不报错（前向兼容）"一致。
8. **空密钥防御**：`computeSignature` / `signProject` 显式拒绝空密钥（`src/signer.ts:82-84`、`src/project.ts:62-64`），避免"用空字符串签出可被任何人重算的签名"这种严重错误。

---

## 3. 问题清单

> 严重等级：P0 = 阻断性 / 安全 / 直接违反 RFC；P1 = 重要不一致或差距；P2 = 体验/小问题。

### P0

#### P0-1：`@reui/cli` **完全没有 CLI / bin 入口**，与 RFC-005 §3.1 / §3.2 显著不符
- 位置：`workspace/cli/package.json:1-36`
- 现象：包名为 `@reui/cli`，但既没有 `bin` 字段也没有 `commander`，更没有 `cli.ts`。`reui sign` / `reui verify` / `reui validate` / `reui init` / `reui list` 全部未实现。
- 影响：RFC-005 §7.1（CLI 验收标准）所有条目均不通过；附录 B 中的"CI/CD 工作流"无法执行；`AGENTS.md` 顶部"使用 `@reui/cli` 的 Zod Schema 校验"前半句对（schema 在），后半句"签名后才生效"在 CI 流水线中无法以 `reui sign` 形式执行。
- 建议：补 `src/cli.ts` 与 `bin: { reui: './dist/cli.js' }`；命令薄壳直接调 `signProject` / `verifyProject` / `validateManifest`，业务逻辑已就绪。

#### P0-2：**Vite 插件 `vitePluginReUI` 未实现**
- 位置：缺失 `src/vite-plugin/` 整个目录
- 现象：`src/index.ts:13-18` 没有 export 任何 vite 入口；`package.json` 无 `./vite` 子路径导出；无 `vite` peerDependency；无 `chokidar`/`glob`。
- 影响：RFC-005 §3.3、§7.2 全部未通过。RFC-002 §6.4（开发体验验收）"Vite 插件 (`vitePluginReUI()`) 在 serve 模式下实时校验 plugin.json 变更"未达成。
- 建议：新增 `src/vite-plugin/index.ts`，复用 `scanPlugins + validateManifest`；`buildStart` 调 `signProject`；`configureServer` 注册 watcher 与 `server.ws.send` HMR。

#### P0-3：版本号 `0.0.0` 且 `private: true`
- 位置：`workspace/cli/package.json:3-4`
- 现象：包标记为 private，且语义版本为 0.0.0；同时 `package.json` 缺少 `bin`、`exports."./vite"`、`peerDependencies.vite` 等 RFC-005 §3.1 计划字段。
- 影响：无法 `npm publish`，下游无法将 `@reui/cli` 作为发布包消费；当前只能在 monorepo 内 workspace 协议引用。
- 建议：进入 Phase 5 之前，补齐 `bin` / `peerDependencies` / `files` 字段；CI 中加 `pnpm publint` 或类似检查。

#### P0-4：`.d.ts` 与 `.ts` schema **手工双写，已经存在不一致风险**
- 位置：`src/schema/plugin-manifest.d.ts:58` 已经将 `Layer` 这一别名移除（只剩 `DisplayType`），但 `plugin-manifest.ts:199` 仍保留 `@deprecated` 的 `Layer` 类型导出；又比如 `.d.ts` 中没有 `Lock`/`SignedPluginManifest` 的镜像，而 RFC-005 §3.1 的 `index.ts` 导出清单期望 `Lock` 类型可被消费。
- 影响：`.d.ts` 与 `.ts` 已经在公共 API 形状上不同步；下游"只看 `.d.ts`"和"用 Zod 推断"两种使用方式会得到不一致的类型，且未来更易漂移。
- 建议：删除 `plugin-manifest.d.ts`，改用 Zod `z.infer` 直接产出类型（已经在 `plugin-manifest.ts:193-205` 做了一份）。如必须保留独立类型声明，建议加一个 typecheck 兜底测试，强制 `expectTypeOf<PluginManifest>().toEqualTypeOf<DTSPluginManifest>()`。

#### P0-5：`coverage.exclude` 把 `src/schema/index.ts` 与 `src/index.ts` 排除，但**未覆盖 `src/schema/plugin-manifest.d.ts` 之外的 `.d.ts`**——这是次要的，但 **更严重的是 `vitest.config.ts` 写的 `src/**/*.d.ts` 在 v8 默认就不会被纳入**，意味着排除规则其实没有起到额外效果，配置可读性差且容易误导后续维护者
- 位置：`workspace/cli/vitest.config.ts:12`
- 影响：低，但说明没有人验证过这条配置的实际效果。
- 建议：删除 `'src/**/*.d.ts'`；规则文档说 `src/index.ts` 与 `src/types.ts` 排除，建议保持与规则一致，删除 `src/schema/index.ts` 排除（它实际就是一行 re-export，纳入也不会拉低覆盖率）。

### P1

#### P1-1：Schema 缺少 RFC-002 §3.1.1 中定义的 `_lock` 字段类型
- 位置：`src/schema/plugin-manifest.ts:99-188`（PluginManifestSchema）
- 现象：`PluginManifestSchema` 没有 `_lock` 的可选定义；`signer.ts` 的 `SignedPluginManifest = PluginManifest & { _lock: ManifestLock }` 通过类型交叉额外加上，但 Zod 校验阶段无法识别 `_lock` 是否符合 lock schema。
- 影响：`scanPlugins({ signed: true })` 拿到 `dist/plugin.json` 后，`validateManifest` 不会校验 `_lock` 形态；`verifyProject` 当前手动检查 `lock.algorithm`（`src/project.ts:153`）实属补救。如果生产中 `_lock` 字段被损坏（例如算法字段为非字符串、signature 为对象），目前会进入运行时崩溃路径。
- 建议：在 `PluginManifestSchema` 中加 `_lock: z.object({ version: z.literal(1), signedAt: z.string().datetime(), algorithm: z.literal('hmac-sha256'), signature: z.string().regex(/^[0-9a-f]+$/) }).optional()`，并把 `signer.ts` 的 `ManifestLock` 改为 `z.infer`。

#### P1-2：Schema 校验**不阻止 `entry` 引用 `dist/`、绝对 URL 或绝对 Windows 路径 `C:\...`**
- 位置：`src/schema/plugin-manifest.ts:27-41`（SafePath）
- 现象：当前 `SafePath` 仅拒绝 `/` `\` 开头与 `..`、null byte。但：
  1. Windows 绝对路径 `C:/foo` / `C:\foo` 不会被识别为绝对路径而被放行；
  2. `entry: "https://evil.example/x.html"` 不会被拒绝（不以 `/` 开头）；
  3. 同时 `permissions` 里的路径穿越被严格防御了（regex），`entry` 反而比 `permissions` 宽松。
- 影响：RFC-002 §4.1 "防止替换为恶意 HTML"在某些极端 manifest 下可被绕过签名前的 schema 阶段（依然会被签名覆盖检测出来，所以不是 P0）。
- 建议：增加 `refine`：拒绝 Windows 盘符 `^[A-Za-z]:[\\/]`、拒绝 `://` 协议串、要求以 `[a-zA-Z0-9_-]` 开头。

#### P1-3：`devEntry` 允许任意端口与 `*.localhost`，但不限制协议
- 位置：`src/schema/plugin-manifest.ts:124-143`
- 现象：仅判断 hostname。`ftp://localhost` / `file://localhost/x` 等协议都会通过 `URL` 解析（`URL` 把它们当作合法 URL，hostname 为 `localhost`）。
- 影响：sandbox 内 iframe 加载 `file://` 等可能引起异常或绕过 HMR 假定。
- 建议：refine 中加 `url.protocol === 'http:' || url.protocol === 'https:'`。

#### P1-4：高权限识别集合**与 RFC-005 §3.2.1 不一致**
- 位置：`src/project.ts:38`
- 现象：`HIGH_PRIVILEGE = new Set(['runtime.all', 'plugins.all'])`，但 RFC-005 §3.2.1 明确把 `runtime.*`、`plugins.*` 通配符也视为高权限的等价物（"`reui sign --yes` 跳过高权限确认"案例中 `runtime.all` 与 `plugins.all` 是举例，权限语义层面 `runtime.*` 与 `runtime.all` 等价 —— 见 `src/permission.ts:12-13`）。
- 影响：用户可写 `permissions: ["runtime.*"]` 绕过高权限交互确认，但实际授权 与 `runtime.all` 完全等价。
- 建议：扩展集合为 `['runtime.all', 'runtime.*', 'plugins.all', 'plugins.*']`，或读 RFC-005 配置 `sign.highPrivilegePermissions`（默认提供这四项）。

#### P1-5：`signer.normalizeForSigning` 注释自承"假设 `JSON.stringify` 按声明顺序"，但**没有显式锁住 key 顺序**，如未来有人用 spread 重构，签名可能漂移
- 位置：`src/signer.ts:86-88`
- 现象：当前正确（V8 行为稳定），但隐含约束未防御。
- 建议：使用确定性序列化（如手写按 key 数组拼接，或引入 `safe-stable-stringify`），消除"对 V8 内部实现的依赖"。即使不改实现，也建议加一条测试：`computeSignature` 在按不同顺序构造 secured 对象时（用 `Object.assign` 故意改 insertion order）签名仍一致。

#### P1-6：`verifyManifest` 对**篡改后的 lock.algorithm 字段误差异较大**
- 位置：`src/signer.ts:130`
- 现象：`if (!lock || lock.algorithm !== 'hmac-sha256') return false;` —— 算法不被支持时返回 false 而非区分错误码；调用方 `verifyProject` 在 `src/project.ts:153` 重复了这次检查，但是结果分类只有 `unsupported-algorithm` 一种，如果 `verifyManifest` 内部因为算法错误返回 false，外部已经无法区分"算法错误"与"签名比对失败"。
- 影响：错误信息粒度低；测试中 `signer.test.ts:170-175` 实际依赖了"算法错误就 false"的行为，但用户视角分不清"被篡改"与"算法不支持"。
- 建议：把 `verifyManifest` 改为返回 discriminated union（`{ ok: true } | { ok: false; reason: 'no-lock' | 'bad-algorithm' | 'bad-hex' | 'mismatch' }`），让 `verifyProject` 直接消费 reason 而不再二次检查。

#### P1-7：`scanner.ts` 中 `MISSING` 错误的语义混乱
- 位置：`src/scanner.ts:103-115`
- 现象：扫描器在"目录里没有 plugin.json"时既会 `continue`，又会 `errors.push({ kind: 'MISSING' })`，注释明确说"不视为错误"——同时却把它写入 `errors`，让 `signProject` / `verifyProject` 都不得不再过滤一次（`src/project.ts:70`、`src/project.ts:133`）。
- 影响：双重职责：调用方必须知道 `MISSING` 是软错误；任何新调用方都会忘记过滤。
- 建议：把 MISSING 从 `errors` 中拿掉，改为两类 `errors`（READ/JSON）+ 一个独立 `skipped: { basePath, reason }[]` 字段；或直接静默跳过。

#### P1-8：`scanner.ts` 缺少 RFC-005 §3.2.1 提到的"嵌套子目录处理"
- 位置：`src/scanner.ts:91-100`
- 现象：仅扫描一级子目录，子目录的子目录（例如 `plugins/category/inv/plugin.json`）不会被发现。
- 影响：与 RFC-002 附录 B 的目录结构（一级即可）一致，目前不算违反。但 RFC-005 §6.1 测试计划"目录扫描、嵌套处理"明确写了"嵌套处理"。
- 建议：决策上选其一—— a) 维持一级（更新 RFC-005 测试计划文字）；b) 增加可选 `recursive: boolean` 参数。当前代码未文档化此约束。

#### P1-9：`PermissionString` 校验**接受 `runtime.*` 这种"两段式通配符"，但 schema 不阻止 `*` 单独存在**
- 位置：`src/schema/plugin-manifest.ts:62-65`
- 现象：regex `/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/` 实际拒绝单独 `*`、`**` —— 这一点正确。但是允许 `runtime.all` 同时也允许 `runtime.*`，两者授权语义相同，但前者是 `permission.ts:12` 的 hardcoded 路径，后者是通用通配符路径，**hasPermission 实现里这两条互不知道**：
  ```ts
  if (granted.includes('runtime.all') && required.startsWith('runtime.')) return true;  // 第 1 条
  // 通配符回退里能识别 runtime.*    // 第 2 条
  ```
  巧合下两条都能放行 `runtime.network`，但是只持有 `runtime.all` 的插件能否调用 `runtime`（无后缀）？空 required 在第 12 行被特例放行。如果 required 写错为 `runtime`（无 `.`），`granted=['runtime.all']` 命中第 12 行（startsWith 通过——'runtime'.startsWith('runtime.') 是 **false**），所以会被拒绝。这是正确的，但说明 hardcoded 'runtime.all' 不是必要的——把它当作通配符 `runtime.*` 等价处理即可。
- 影响：保留两套等价规则增加心智负担；RFC-002 §4.3.2 的范例代码用了相同写法。
- 建议：要么简化为通配符规则（`runtime.all` 不再特殊处理，靠 schema/约定让其变为 `runtime.*`），要么在文档显式区分。当前不是 bug，仅需评审。

### P2

#### P2-1：`scripts.lint` 是占位符
- 位置：`workspace/cli/package.json:24`
- 现象：`"lint": "echo \"(no lint configured yet)\""`
- 影响：`.codebuddy/rules/001-testing.mdc` PR 流水线要求 `pnpm -F <pkg> lint` 必跑。当前命令永远 0，等于跳过 lint。
- 建议：接入 ESLint / `@typescript-eslint`，与其他包统一。

#### P2-2：测试中存在重复用例
- 位置：`tests/scanner.test.ts:116-138` 与 `tests/scanner.test.ts:140-162` 内容、describe 名称完全相同
- 影响：CI 时间浪费；维护时极易漏改其中一份。
- 建议：删除其中一份。

#### P2-3：测试用例命名 / AAA 不严格
- 位置：`tests/permission.test.ts:14-16`、`tests/permission.test.ts:22-25` 等
- 现象：规则要求 `it('should <expected behavior> when <condition>', ...)`、AAA 显式注释；当前 `permission.test.ts` 多数用例为 `should match exact permission`，缺 `when ...` 部分；多数没有 `// arrange` `// act` `// assert` 注释。`signer.test.ts`、`validator.test.ts` 类似。
- 影响：违反 `.codebuddy/rules/001-testing.mdc` §测试规范第 1、2 条。
- 建议：补齐命名 / 注释，或在规则中明确"AAA 注释为推荐而非强制"。

#### P2-4：Lock 字段在 schema/`PluginManifestSchema` 中**未定义**导致测试需要 `as unknown as` 强转
- 位置：`tests/project.test.ts:69`、`tests/signer.test.ts:172`
- 现象：测试为绕过类型必须 `as unknown as 'inv'` / `as unknown as 'hmac-sha256'`。规则禁止 `as any`，`as unknown as` 是变体。
- 影响：与 `001-testing.mdc` 第 6 条的"测试也要类型安全"精神冲突。
- 建议：把 lock 加到 schema 后，对错误形状的 lock 直接构造合法的 `ManifestLock & { algorithm: string }` 即可避免强转。

#### P2-5：缺少 Zod 错误信息**国际化或更人性化**
- 位置：`src/validator.ts:37-41`
- 现象：直接用 Zod 默认 message。RFC-005 §3.2.3 输出示例：
  ```
  ✗ broken-plugin - INVALID
      • entry: Path traversal (..) not allowed
  ```
  —— 这个消息恰好与 `SafePath` 中的 `refine` message 一致，**但是 Zod 的 enum 错误信息是 `Invalid enum value. Expected 'hud' | ...`，与 RFC-005 §3.2.3 例子里的"层级错误"不太对齐**。
- 影响：体验问题，不是 bug。
- 建议：CLI 端做一层 message 美化（红绿色 + 建议），不污染 schema。

#### P2-6：`computeSignature` / `signManifest` 不要求 `secretKey` 最小长度
- 位置：`src/signer.ts:81-90`
- 现象：仅判断空字符串；`secretKey = "x"` 也能签出 64 位 hex。
- 影响：HMAC 在密钥极短时安全性下降；CI 误把 `KEY=' '` 当作合法。
- 建议：增加 `if (secretKey.length < 16) throw ...`（与 RFC-002 §4.2.3 配合）。

#### P2-7：`scanner.ts` 的 `MISSING` 在 `signed=true` 时**对 `dist/plugin.json` 缺失也不报错**
- 位置：`src/scanner.ts:107-115`
- 现象：注释说"signed=true 但目录有 plugin.json 但没有 dist/plugin.json，由调用方用 validate + diff 来诊断"——但调用方 `verifyProject` 也跳过 MISSING（`src/project.ts:133`）。结果就是：未签名的插件在 `reui verify` 中**不会被报告**。
- 影响：与 RFC-005 §3.2.2 输出示例的 `✗ admin-panel - SIGNATURE MISMATCH` 假设矛盾——按当前实现，`admin-panel` 缺 dist 时，`verify` 命令会**安静通过**。
- 建议：`signed=true` 模式下仍然提示 MISSING，供 verify 报告"未构建产物"，避免误判"全部签名 ok"。

#### P2-8：跨平台路径
- 位置：`src/scanner.ts:70`、`src/scanner.ts:102`
- 现象：使用 `node:path.join`，在 Windows 下生成 `\` 分隔；测试 fixture（`tests/scanner.test.ts`）混用 `/` 与 `\`，`makeFs` 已做 `replace(/\\/g, '/')` 兼容；但实际运行中 `dist/plugin.json` 写盘时若由 CLI 调用方拼路径，需要格外注意。
- 影响：Windows 跨平台无明显 bug，只是测试 fixture 隐晦。
- 建议：暴露 `manifestPath` 给调用方（如 `signProject` 返回 `signed[i].manifestPath`），避免下游再次拼路径。

#### P2-9：`reui.config.json` 配置加载未实现
- 位置：缺失
- 现象：RFC-005 §3.4 要求 `reui.config.json` 提供共享配置，CLI 与 Vite 插件都读它。当前代码无 loader、无 schema。
- 影响：`reui sign` 等命令将无法读取项目级默认；现有 `signProject` API 直接接收 `secretKey`，没有 fallback。
- 建议：单独提一个 `src/config.ts` 模块，提供 `loadReuiConfig(cwd)` 与对应 Zod schema。

#### P2-10：`@types/node` 版本与 RFC-005 期望脱钩
- 位置：`workspace/cli/package.json:31`
- 现象：依赖 `@types/node ^20`，但若未来 Node 22 LTS 上线、CI 使用 22，可能 typings 漂移。
- 影响：低。
- 建议：在 monorepo 根 pin 同一 `@types/node` 版本，或加 `engines.node`。

---

## 4. 与 RFC-002 / RFC-005 的差距

### 4.1 与 RFC-002（插件系统）

| RFC-002 条目 | 现状 | 差距 |
|---|---|---|
| §3.1.1 PluginManifest schema 全字段 | ✅ id/name/version/entry/devEntry/layer/display/permissions/roleRestriction/enabled/defaultHotkey 均有 | `_lock` 在 schema 里**没有定义**（P1-1） |
| §3.3 加载流水线（Schema → override → filter → role → iframe） | `validateManifest` ✅、`applyOverrides` ✅、`checkRoleAccess` ✅；filter/iframe 在 runtime 包 | CLI 侧已齐全 |
| §4.1 Zod Schema | ✅ 与 RFC 示例一致 | `entry` 路径限制比 RFC 示例略宽（P1-2）；devEntry 协议未限（P1-3） |
| §4.2.1 SecuredFields 列表 | ✅ id/version/entry/layer/permissions/roleRestriction/enabled 完全对齐 | 无 |
| §4.2.2 签名算法 | ✅ HMAC-SHA256 + timing-safe + 规范化 | 排序确定性靠 V8 假设（P1-5） |
| §4.2.3 密钥管理 | API 仅接受密钥字符串 | 没有"从 `REUI_SIGN_KEY` 读取 / 拒绝弱密钥"层（P2-6） |
| §4.3 运行时权限强制 | `hasPermission` / `canAccessPlugin` / `requiredPermissionFor` 完整 | `runtime.all` 与 `runtime.*` 双轨等价（P1-9，可选） |

### 4.2 与 RFC-005（CLI 工具链）

| RFC-005 条目 | 现状 | 差距 |
|---|---|---|
| §3.1 包结构（含 `commands/` `vite-plugin/` `templates/`） | 仅 `core`-级模块 | **commands/ vite-plugin/ templates/ 全部缺失** |
| §3.1 双入口（`bin: reui` + `import { reui } from '@reui/cli/vite'`） | 无 bin、无 vite 子路径 | **P0-1 / P0-2 / P0-3** |
| §3.2.1 `reui sign` | 仅库函数 `signProject` | CLI 命令未接入；`--key`/`--yes`/交互确认未实现 |
| §3.2.2 `reui verify` | 仅库函数 `verifyProject` | 退出码、报告未实现；`MISSING` 处理（P2-7） |
| §3.2.3 `reui validate` | `validateManifest` 单 manifest 函数 | `--strict` 未实现；批量扫描未接 |
| §3.2.4 `reui init` | **未实现** | 无 scaffold.ts、无 templates |
| §3.2.5 `reui list` | **未实现** | — |
| §3.3 Vite 插件 | **未实现** | — |
| §3.4 `reui.config.json` | **未实现** | — |
| §4 热重载流程 | CLI 侧无关；Vite 插件部分未接 | — |
| §5 开发模式特性 | CLI 无关 | — |
| §6.1 单元测试覆盖 | validator/signer/scanner/permission/project 均有 | scaffold/vite-plugin 未实现，故未覆盖 |
| §7 验收标准 | 仅 §7 中"`signProject` 等价于 sign"语义 OK | CLI / Vite / 热重载 / 开发模式所有 checkbox 均未通过 |
| §8.3 外部依赖（commander/chalk/glob） | **均未引入** | 实现 CLI 时需补 |

### 4.3 与 `AGENTS.md` 关键约定

| 约定 | 现状 |
|---|---|
| 4. plugin.json 必须通过 `@reui/cli` Zod Schema 校验 | ✅ schema 实现完成 |
| 5. 插件交付物在生产环境必须经过 `@reui/cli` 签名 | ⚠️ 算法已有，但**没有 CLI 命令**让"经过签名"成为部署流程一环 |

---

## 5. 签名与安全评估

| 维度 | 评估 |
|---|---|
| **算法选择** | HMAC-SHA256，符合 RFC 选型；hex 编码 64 字符。✅ |
| **签名覆盖范围** | SecuredFields 与 RFC-002 §4.2.1 完全一致；name/display/defaultHotkey/devEntry 不在签名内（按 RFC 设计）。✅ |
| **规范化** | 字段排序（permissions / roleRestriction）+ 字段顺序固定（对象字面量）。⚠️ 依赖 V8 stringify 的 insertion-order 行为（P1-5），未来重构风险。 |
| **时序安全** | `timingSafeEqual`，缓冲长度先校验再比较。✅ |
| **密钥处理** | 仅在签名/验签函数内部使用；不打印；空字符串拒绝。⚠️ 没有"长度下限"与"环境变量加载"，且**库外暴露的 `signProject` 仍接受字符串入参**——库使用方若打印整个 options 对象会泄露密钥。 |
| **不修改源 manifest** | `attachLock` 返回新对象，`signProject` 通过 `signed: SignedOutput[]` 返回，不写盘。✅ |
| **篡改检测覆盖面** | tests/signer.test.ts 验证：错误密钥、错误算法、错误 hex 长度、空 hex、改动 secured 字段、改动非 secured 字段。✅ 完整 |
| **重放攻击** | 当前签名不含 nonce / lifetime，仅 `signedAt`；RFC-002 也未要求。`signedAt` 没有纳入签名。无 RFC 缺口，但若未来加 expiry 需注意。 |
| **算法切换/降级保护** | `verifyManifest` 硬编码 `algorithm !== 'hmac-sha256'` 拒绝；如未来加新算法需配 algorithm allowlist。✅ 当前安全 |
| **schema 缺 `_lock` 类型** | P1-1：JSON 中放进任意形状的 `_lock` 不会被 schema 拒绝，仅靠 `verifyProject` 二次手检。⚠️ |
| **服务端 vs 客户端密钥流转** | 库本身只暴露纯函数，调用方决定密钥来自何处。RFC-002 §4.2.3 强调"密钥仅服务端"，库无法强制；建议在 README 里**显式警告**"不要把密钥打入构建产物 / 不要在客户端代码 import signProject"。 |

**结论**：签名算法实现严谨，覆盖了 RFC-002 §4.2 全部安全属性；唯一系统性风险是"依赖 V8 stringify 顺序"（P1-5）和"`_lock` 没有 schema 校验"（P1-1）。在没有 CLI 入口的情况下，`@reui/cli` 提供的安全原语对接到生产部署链路尚有缺失。

---

## 6. DX（开发体验）评估

| 维度 | 评估 | 说明 |
|---|---|---|
| 错误反馈 | 中等 | `ValidationResult` 形态友好，但 message 直接是 Zod 默认，没有"修复建议"。 |
| 文档 | 中等 | 源码内 JSDoc 详细且引用 RFC 章节；缺少 README.md、CHANGELOG。 |
| Pure-function 设计 | 优 | 每个函数都可单测；fs 注入良好；PR 时极易 review。 |
| 跨平台 | 良 | Windows 路径在 scanner 测试里隐式处理；如果后续接 CLI，要明确 `process.cwd` / `path.resolve` 用法。 |
| Shell 兼容 | 未触达 | 没有 CLI 命令，谈不上 PowerShell / Bash 兼容；后续接入时要注意 `--yes`、彩色输出（chalk 5.x ESM-only）、`process.exitCode` 而非 `process.exit()`。 |
| 类型安全 | 良 | Zod 推断 + handwritten d.ts 双轨（P0-4 风险）。`as unknown as` 在测试中出现。 |
| Lint | **缺失** | P2-1。 |
| 监听 / 热重载 | **未实现** | RFC-005 §3.3.2 / §4 全部未做。 |
| Scaffold | **未实现** | RFC-005 §3.2.4 完全没做。 |
| Vitest 配置 | 良 | 90% 阈值；覆盖范围合理；`coverage` exclusion 有冗余但无害（P0-5）。 |
| 测试质量 | 良 | 关键路径覆盖完整；命名 / AAA 注释不严格（P2-3）；scanner.test 重复（P2-2）。 |

**结论**：库形态的 DX 是优秀的；但作为 RFC-005 承诺的"日常使用的命令行工具 + Vite 插件深度集成"完成度只有约 30%（仅纯函数库，缺命令行壳、Vite 插件、配置加载、模板）。

---

## 7. 改进建议

> 按优先级排列，建议作为后续 PR 拆分依据。

### P0 修复（必做）

1. **新增 CLI 入口** `src/cli.ts` + `bin: { reui: './dist/cli.js' }`，依赖 `commander`：
   - `reui validate [--strict]`
   - `reui sign [<pluginId>] [--key|--key-env] [--yes]`
   - `reui verify [--key|--key-env]`
   - `reui list [--json]`
   - `reui init <name> [--layer] [--template]`
   命令薄壳直接调 `signProject` / `verifyProject` / `validateManifest`。
2. **新增 `src/vite-plugin/index.ts`**：
   - `serve`：watcher + Zod 校验 + `server.ws.send('reui:plugin-config-changed', ...)`
   - `build`：buildStart 调 `signProject`、`this.error` / `this.warn`
   - `package.json` 加 `peerDependencies.vite` + `exports."./vite"`。
3. **`PluginManifestSchema` 加 `_lock` 可选字段**（与 `signer.ManifestLock` 共享 z.infer 类型），把 `verifyProject` 中的手检改为 schema 校验。
4. **删除 `plugin-manifest.d.ts`**（或改为脚本生成 + CI 校验同步），消除手工双写。
5. **去除版本号 `0.0.0` 与 `private: true`**，补 `bin` / `exports."./vite"` / `peerDependencies` / `files`。

### P1 修复（强烈建议）

6. **`SafePath` 收紧**：拒绝 Windows 盘符 `^[A-Za-z]:[\\/]`、拒绝 `://` URL 协议、要求以 `[a-zA-Z0-9_]` 起始。
7. **`devEntry` 协议白名单**：`http:` / `https:` only。
8. **高权限识别集合扩展**：把 `runtime.*`、`plugins.*` 也视为高权限（`src/project.ts:38`）。
9. **`verifyManifest` 改为 discriminated union**：返回 `{ ok, reason }`，让上层产出更细的 issue 类型。
10. **scanner 的 MISSING 拆分到独立通道**（不污染 `errors`）。
11. **签名密钥强度检查**：长度 ≥ 16；`signProject` 抛 `SignKeyTooWeakError`。
12. **签名确定性序列化**：引入 `safe-stable-stringify` 或自写 deterministic stringify，消除对 V8 行为的依赖。

### P2 修复（机会）

13. 接入 ESLint + `@typescript-eslint`（与 monorepo 其他包一致）。
14. 删除 `tests/scanner.test.ts:140-162` 重复用例。
15. 测试命名补 `when ...`、补 AAA 注释；逐步对齐 `001-testing.mdc`。
16. Verify 命令在 `signed=true` 模式下显示"未构建产物"。
17. 暴露 `signProject` 返回 `manifestPath` 字段，避免调用方再拼路径。
18. 增加 README.md 与 CHANGELOG.md，并在 README 中明确警告"密钥不可进入客户端构建"。
19. 提供 `loadReuiConfig`（`reui.config.json` Zod schema 与 loader）。
20. 增加 size-limit 守护（`@reui/cli` 不强制，但有助约束依赖膨胀）。

### 测试补强建议

- 增加**类型测试**（`tests/types/*.test-d.ts`），用 `expectTypeOf` 校验 `PluginManifest`（z.infer）与 d.ts 类型一致（如保留 d.ts）。
- 增加**确定性序列化**测试（同字段不同 insertion order 仍签出同 hash）。
- 增加**Windows 路径**测试（`SafePath` 对 `C:\` `C:/` 的拒绝）。
- 增加**协议白名单**测试（`devEntry: file://...` / `ftp://localhost` 应被拒）。
- 增加**错误密钥长度**测试（`computeSignature(m, 'x')` 抛错）。

---

## 8. 验收映射小结

| RFC 验收条目 | 状态 |
|---|:---:|
| RFC-002 §6.1 plugin.json Zod Schema 拒绝非法配置 | ✅ |
| RFC-002 §6.2 篡改安全字段后签名验证失败 | ✅ |
| RFC-002 §6.2 密钥仅存于服务端（库本身不强制，文档缺失） | ⚠️ |
| RFC-002 §6.4 `reui validate` 命令报错 | ❌ 命令未实现 |
| RFC-002 §6.4 `reui sign` 命令签出 dist/plugin.json | ❌ |
| RFC-002 §6.4 Vite 插件 serve 实时校验 | ❌ |
| RFC-005 §7.1 CLI 全部条目 | ❌ |
| RFC-005 §7.2 Vite 插件全部条目 | ❌ |
| RFC-005 §7.3 热重载 | ❌（Vite 端缺） |
| RFC-005 §7.4 开发模式特性 | ❌（CLI 端无 DevTools/HMR） |

**总体完成度**：核心库（schema + signer + validator + scanner + project + permission）实现质量高、覆盖完整；但 RFC-005 所承诺的"双模式工具"中，"日常 CLI 工具"与"Vite 插件"两条主线尚未启动。当前版本可视为 RFC-005 §8.5 的 Phase 1 + Phase 2 的库基础，距离整体可发布仍需 Phase 3-7（Vite 插件 / scaffold / DevTools）。

---

*评审完成。报告聚焦研究与建议，未对源代码做任何修改。*
