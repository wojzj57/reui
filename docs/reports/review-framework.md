# `@reui/framework` 包代码审查报告

> 审查范围：`workspace/framework/`
> 对照规约：[`docs/rfcs/rfc-004-framework-ui-library.md`](../rfcs/rfc-004-framework-ui-library.md)、[`docs/designs/05-framework-ui-design.md`](../designs/05-framework-ui-design.md)、`AGENTS.md`、`.codebuddy/rules/001-testing.mdc`
> 审查人：reviewer-framework
> 审查日期：2026-06-01

---

## 1. 包概览

### 1.1 用途

`@reui/framework`（RFC-004）是面向插件作者的可选 React UI 组件库，承担三件事：

1. 提供统一的深色游戏风 Design Tokens 与 ThemeProvider；
2. 以 React Hooks 形式封装 `@reui/core` 的 SDK 调用（`useNuiEvent` / `useEvent` / `usePermission` / `useUser` / `useVisibility` 等）；
3. 提供布局 / 数据展示 / 输入 / 反馈 / 游戏五大类组件（Panel、ItemSlot、Hotbar 等）。

### 1.2 当前实际交付内容

```
workspace/framework/
├── package.json           # @reui/framework 0.0.0, type=module, deps={}, devDeps={vitest, coverage-v8, ts, @types/node}
├── tsconfig.json          # extends tsconfig.base.json, types=[node]
├── vitest.config.ts       # environment='node', 覆盖率阈值 90/90/90/90
└── src/
    ├── index.ts                       # 仅 re-export ./theme
    └── theme/
        ├── index.ts                   # re-export tokens + theme-utils
        ├── tokens.ts                  # DesignTokens 类型 + defaultTheme 常量
        └── theme-utils.ts             # deepMerge / camelToKebab / tokensToCssVars / flattenTokens
└── tests/
    ├── tokens.test.ts                 # 4 用例
    └── theme-utils.test.ts            # 18 用例
```

实质上**只交付了 RFC-004 §3.1 / §3.2 的纯逻辑底座**（DesignTokens 类型、默认值、deepMerge、CSS 变量摊平）。`src/index.ts` 文档注释也明确写了"React 组件与 Hooks 待 React 工具链落地后再补齐"。

### 1.3 依赖

- 运行时依赖：**无**（`dependencies: {}`）；尚未声明 `react` / `react-dom` / `@reui/core` 的 `peerDependencies`。
- 开发依赖：仅 `vitest` / `@vitest/coverage-v8` / `typescript` / `@types/node`。无 `@types/react` / `react`。
- 没有 SCSS 构建链、没有 vite.config.ts、没有 Storybook、没有 lint 配置（`scripts.lint` 是占位 echo）。

---

## 2. 关键发现（亮点）

1. **纯函数已抽离、便于无 React 测试**。`theme-utils.ts` 的 `deepMerge` / `camelToKebab` / `tokensToCssVars` 都是纯函数，可在 `node` 环境下直接测试，符合 RFC-004 §3.2 的"主题逻辑可独立验证"思路。源码注释在 `theme-utils.ts:1-14` 把这一意图写得很清楚。
2. **deepMerge 实现严谨**。
   - `theme-utils.ts:23-28` 用 `Object.getPrototypeOf(v) === Object.prototype` 排除 `Date` / `RegExp` / 自定义类实例，避免把它们误判为可深合并对象；
   - 显式跳过 `undefined`（`theme-utils.ts:40`），与 RFC-004 §3.2 表格"undefined 跳过"一致；
   - 数组走 else 分支被整体替换，与"数组 → 用户值完整替换"一致；
   - 不修改 `base` / `override` 入参，并由 `tests/theme-utils.test.ts:65-70` 用 `JSON.stringify` 显式守护。
3. **Token 默认值与 RFC-004 §3.1 表格逐字对齐**。颜色（`#4F9EF8` / `#4ADE80` 等）、间距、圆角、字号、动画、阴影各类 6/4/6/4/3 项数量与表格完全吻合，并由 `tests/tokens.test.ts` 反向验证（包含 `tokensToCssVars` 总数等于 16+6+4+6+4+3 = 39 的硬性断言，`theme-utils.test.ts:111`）。
4. **测试遵守仓库规范**。文件位于独立 `tests/` 目录、文件名镜像 `src/`、`describe` 用 `<对象>.<行为域>` 风格、用例命名 `should ... when ...`，与 `.codebuddy/rules/001-testing.mdc` 的"测试规范"一致。
5. **覆盖率门槛已落地**。`vitest.config.ts:13-18` 把 lines/branches/functions/statements 都设为 90，并将纯 re-export 文件 `src/index.ts` / `src/theme/index.ts` 排除，符合规则。
6. **类型工具简洁**。`DeepPartial` 的实现保留了"叶子原始值不变"的语义（`theme-utils.ts:19-21`），未使用 `any`。

---

## 3. 问题清单

### 3.1 P0 —— 阻塞 RFC 验收

#### P0-1：CSS 变量前缀与 RFC 规范不一致（与 `tokens.colors.bgPrimary → --reui-color-bg-primary` 矛盾）

- 现象：`tokensToCssVars` 直接走 `walk(tokens, '--reui')`，遇到顶层 key 为 `colors` / `spacing` / `fontSize` 时直接拼接，得到 `--reui-colors-bg-primary` / `--reui-spacing-md` / `--reui-font-size-md`。
- 期望（RFC-004 §3.1，第 138-143 行）：
  ```
  tokens.colors.bgPrimary   →  --reui-color-bg-primary    (单数 color)
  tokens.fontSize.sm        →  --reui-font-size-sm
  tokens.animation.fast     →  --reui-animation-fast
  tokens.shadow.md          →  --reui-shadow-md
  ```
- 同时 `docs/designs/05-framework-ui-design.md:380-381` 也明确写了 `--reui-color-accent`、`--reui-color-bg-primary`（单数）。
- 影响：未来 SCSS（RFC-004 §4.1 中的 `_mixins.scss` 已写 `var(--reui-color-border)` / `var(--reui-color-accent)`）和文档中给出的 CSS 变量名都将匹配不上 `tokensToCssVars` 实际产出的 `--reui-colors-*`。**这是 RFC 验收第 7.2 条"CSS Custom Properties 正确注入，主题切换即时生效"的硬性失败点**。
- 同时测试用 `expect(vars['--reui-colors-bg-primary'])`（`tests/theme-utils.test.ts:97`）反向锁定了错误产物，等于把缺陷写进了契约——CI 看似绿但运行时 SCSS 引用 `var(--reui-color-bg-primary)` 会全部失效。
- 涉及位置：
  - `workspace/framework/src/theme/theme-utils.ts:69-88`（实现）
  - `workspace/framework/tests/theme-utils.test.ts:97-99,103-105`（错误的契约测试）
- 建议修复方案：
  1. 在顶层做一次"category 单复数归一化"映射：`colors → color`、`fontSize → font-size`、`spacing → spacing`、`radius → radius`、`animation → animation`、`shadow → shadow`；
  2. 或者更稳妥：`tokensToCssVars` 在第一层即按 category 分发，由一张明确的 `CATEGORY_PREFIX` 常量表决定前缀，避免靠"机械 walk 整棵树"产生不可控产出；
  3. 同步修测试改为 `--reui-color-bg-primary` / `--reui-font-size-md`。

#### P0-2：`peerDependencies` 完全缺失

- 现象：`workspace/framework/package.json:27-33` 中 `dependencies` 与 `peerDependencies` 都为空。RFC-004 §4.3 / §8.3 明确要求：
  ```jsonc
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@reui/core": "workspace:*"
  }
  ```
- 影响：
  - 与 `@reui/core` 的耦合关系不显式，违反 AGENTS.md 第 3 条"单例服务唯一来源 / 子页面只能通过 `@reui/core` 代理调用"——意味着将来 Hooks 实现时容易被误以为可以直接 postMessage（绕过 Core）。
  - 没有 `react` peerDep + 没有 `@types/react` 即意味着第二阶段（基础组件）一旦上 PR，typecheck 会立即崩溃，是一个可预见的大坑。
- 涉及位置：`workspace/framework/package.json`。
- 建议：当前 0.0.0 阶段就把 `peerDependencies` 占位声好（即使运行时还没有任何 React 代码也不影响），并在 `devDependencies` 中加入 `react`、`react-dom`、`@types/react`、`@types/react-dom` 以让 React 部分一开工就不阻塞。

### 3.2 P1 —— 显著影响后续开发

#### P1-1：`vitest.config.ts` 的 `environment: 'node'` 与仓库测试规范冲突

- 仓库规则 `.codebuddy/rules/001-testing.mdc` 明确"DOM 环境：jsdom（`environment: 'jsdom'`）"。
- 现状：`workspace/framework/vitest.config.ts:5` 设为 `'node'`。
- 影响：第二阶段一旦引入 React + React Testing Library 测组件，必须切回 `jsdom`。当前这个值是个"隐藏的迁移负担"，且任何"想顺手测一下 DOM 行为（如 ThemeProvider 注入到 div style）"的开发者都会先撞坑。
- 建议：直接改成 `'jsdom'`。Node 环境对当前的纯函数测试也完全兼容，没有功能损失，但能消除未来切换的成本。

#### P1-2：`flattenTokens` 实现绕路、且未导出语义清晰的 API

- 现象：`theme-utils.ts:93-100`：
  ```ts
  export function flattenTokens(tokens: DesignTokens): Record<string, string> {
    const out: Record<string, string> = {};
    walk(tokens as unknown as Record<string, unknown>, '', out);
    const trimmed: Record<string, string> = {};
    for (const k of Object.keys(out)) trimmed[k.replace(/^-+/, '')] = out[k]!;
    return trimmed;
  }
  ```
  实现先用空字符串前缀走 `walk`，每个 key 都被前置一个 `-`，再用正则把头部多余的 `-` 剥掉。这个绕弯做法在 path 为多层嵌套时容易出错（虽然当前 token 只有两层，恰好可用）。
- 影响：可读性差、不健壮（一旦有人嵌套三层就会出现 `colors-` 开头的污染）；同时 `flattenTokens` 公共 API 也没有放进 RFC-004 任何条款，**它属于"私下加的工具函数"**。如果属于刻意保留的调试入口，应该放到 `__internal/` 命名空间或加 `@internal` JSDoc 标签，避免被插件作者误用作为正式 API。
- 涉及位置：`workspace/framework/src/theme/theme-utils.ts:93-100`，`src/theme/index.ts:5-6`（通过 `export *` 暴露）。
- 建议：要么删除（当前没有任何下游消费它），要么重写为：
  ```ts
  function walk2(node, path, out) { /* path 为数组，join 时再处理前导 - */ }
  ```
  并显式用 `@internal` 标注。

#### P1-3：测试组织缺少 `tests/unit` / `tests/contract` / `tests/integration` 等子目录

- `.codebuddy/rules/001-testing.mdc` 规定测试目录结构：
  ```
  tests/
  ├── unit/          ← 单元测试，文件名与 src 镜像
  ├── integration/
  ├── contract/
  ├── types/
  ├── helpers/
  └── setup.ts
  ```
- 现状：`tests/` 目录直接平铺两个文件，无 `unit/` 子目录、无 `helpers/`、无 `setup.ts`。
- 影响：单纯的目录约束问题，但当 Hooks / 组件测试加入后，没有这层结构会快速变成"全部文件挤在 tests/ 根目录"。建议趁现在仅 2 个文件时迁移成本最低。

#### P1-4：`@reui/framework` 在 monorepo 中无法被任何包发现

- 现象：`package.json` 没有标记 `"private": true` 之外的可发现性属性，自身也没有 `workspaces` 关联。同时仓库其他包（如 runtime / core）目前没有人 `import '@reui/framework'`，因此本包目前是"可独立运行测试但不接入主线"。
- 与 RFC-004 §4.3 给出的最终目标 `peerDependency: "@reui/core": "workspace:*"` 也对不上，整体说明：本包仍处于初始化阶段。
- 影响：当 RFC-007（exports/RPC）或样例插件需要引用 `@reui/framework` 的 `useEvent` 时，目前没有任何 import 路径可用（`./theme` 子路径在 exports 里有，但根 `.` 路径也只是 ts 源 re-export 而非编译产物）。
- 建议：在 RFC-005 CLI 工具链落地后，至少对接一个 sample 子插件去 `import { defaultTheme } from '@reui/framework/theme'`，验证 monorepo workspace 协议链路。

### 3.3 P2 —— 长期改进

#### P2-1：`exports` 字段把源 `.ts` 当作产物暴露

- 现象：`package.json:7-19` 中 `main` / `module` / `types` / `exports` 全部指向 `./src/index.ts`、`./src/theme/index.ts`。
- 影响：
  - 在 monorepo 内通过 Vite/TS 引用没问题；
  - 但 RFC-004 §4.3 规划的产物是 `./dist/reui-framework.js`，未来切换会涉及 `package.json` 大改，且 `sideEffects: ["*.css", "*.scss"]` 还没声明，影响 tree-shaking。
- 建议：把 `sideEffects` 字段先按 RFC-004 规范填上，dist 字段保留 src 即可（仓库内开发态用），但加一条"// TODO(RFC-004 §4.3): 切换到 dist"。

#### P2-2：`scripts.lint` 是 `echo`、没有 ESLint

- 仓库测试规则要求 `lint: "eslint src tests --max-warnings=0"`。
- 现状：`package.json:24` 是 `"lint": "echo \"(no lint configured yet)\""`，直接放水。
- 影响：CI 必跑流程中 `pnpm -F @reui/framework lint` 会一律绿过，无任何 lint 兜底。
- 建议：引入仓库统一的 ESLint 配置（与 core/cli 对齐），即便规则严格度低也好过 echo。

#### P2-3：`flattenTokens` 测试只有 1 条用例

- `tests/theme-utils.test.ts:130-136` 仅断言两条字段，没有覆盖"前缀剥离不会越界"等边界。考虑到 P1-2 建议直接删除 `flattenTokens`，此项可一并处理。

#### P2-4：`tokens.test.ts` 覆盖度偏弱

- 当前只验证 6 大类存在 + 4 个颜色字面值 + spacing 像素正则 + easing 是 cubic-bezier。
- 缺少：
  - 各 spacing 字段都是 `\d+px` 的循环断言（`xs`-`xxl` 6 个）；
  - 颜色字段在合法的 hex / rgba 形态；
  - 防止默认主题被改动时无声偏离 RFC（建议至少给 4-6 个 token 加"金标对照"）。
- 当前并不阻塞，建议补足。

#### P2-5：`README.md` 缺失

- `workspace/framework/` 根目录无 README；其他兄弟包是否有需横向对比，但作为对外提供的 npm 包，缺少 README 与 RFC-004 §7.5"工程验收"对"package.json 正确声明、与 Core SDK 集成"间接相关。

---

## 4. 与 RFC-004 的差距

| RFC-004 章节 | 要求 | 现状 | 差距等级 |
|---|---|---|---|
| §3.1 Design Tokens | 类型 + 默认值 6 大类 | ✅ 完整 | — |
| §3.1 → CSS 变量映射 | `--reui-color-*` / `--reui-font-size-*` 等单数前缀 | ❌ 实际产出 `--reui-colors-*` / `--reui-font-size-*` | **P0** |
| §3.2 ThemeProvider | React Context + `<div style={cssVars}>` + `useTheme` | ❌ 完全未实现（注释表明"待 React 工具链落地"） | 阶段性允许 |
| §3.2 deepMerge | 对象递归 / 数组替换 / undefined 跳过 | ✅ 完整 | — |
| §3.3 组件清单 | 5 大类 30+ 组件 | ❌ 0 个组件 | 阶段性允许 |
| §3.4 Panel/ProgressBar/ItemSlot 设计 | Props 接口 + 拖拽实现 | ❌ 未实现 | 阶段性允许 |
| §3.5 Hooks（6 个） | useNuiEvent / useNuiState / useEvent / usePermission / useUser / useVisibility | ❌ 全部未实现 | 阶段性允许 |
| §3.6 a11y | 焦点陷阱 / ARIA / `:focus-visible` | ❌ 未实现 | 阶段性允许 |
| §4.1 SCSS + CSS Vars | SCSS 编译链 + CSS Custom Properties 运行时 | ❌ 完全未配置 | 阶段性允许 |
| §4.2 BEM + `.reui-` 前缀 | 命名约定 | ❌ 未到组件阶段 | 阶段性允许 |
| §4.3 构建产物 + peerDeps + sideEffects | `vite.config.ts` lib 模式 + peerDeps + sideEffects | ❌ 未配置；peerDeps 缺失 | **P0**（peerDeps） |
| §5 性能策略 | 虚拟滚动 / GPU 动画 / `React.memo` | ❌ 未到此阶段 | 阶段性允许 |
| §6 测试 | Vitest + RTL + Storybook + 视觉回归 | 当前仅有 Vitest 纯逻辑 | 阶段性允许 |
| §7.5 工程验收 | TS strict / Storybook / package.json 字段 | tsconfig 通过 base extends 已 strict；其余未到位 | 阶段性允许 |

**总结**：当前提交对应 RFC-004 §8.4 的 **Phase 1（Design Tokens + ThemeProvider 基础设施）**，且 Phase 1 内部仅完成了"非 React 部分"。"阶段性允许"指的是 RFC-004 §8.4 把工作分了 6 个 phase，本包目前合理地停在 Phase 1，但 P0/P1 两类问题（CSS 变量前缀、peerDeps、vitest env）即便在 Phase 1 阶段也应该立刻修，因为它们都会反向锁定后续阶段的契约。

---

## 5. API 易用性与一致性评估

### 5.1 已发布 API 一览（仅 theme 相关）

| 导出 | 类型 | 评价 |
|---|---|---|
| `DesignTokens` | type | ✅ 命名清晰、分类合理 |
| `ColorTokens` / `SpacingTokens` / ... | type | ✅ 子类型与父类型互锁，可组合性好 |
| `defaultTheme` | const | ✅ 与 RFC §3.1 一一对应 |
| `DeepPartial<T>` | type | ✅ 实现正确，命名是社区标准 |
| `deepMerge<T>(base, override)` | function | ✅ 行为符合 RFC §3.2 |
| `camelToKebab(input)` | function | ⚠️ 私有意义重于公共 API，建议加 `@internal` 或不导出 |
| `tokensToCssVars(tokens, prefix?)` | function | ❌ **P0-1：前缀逻辑错误** |
| `flattenTokens(tokens)` | function | ⚠️ **P1-2：实现绕路且非 RFC 公共 API** |

### 5.2 一致性观察

- 所有函数命名 camelCase、所有类型 PascalCase，与 `@reui/core` / `@reui/interface` 保持一致。
- `defaultTheme` 命名简洁（不加 `Default` 前缀类型），与 RFC §3.2 例子 `import { defaultTheme } from './default'` 略有出入（RFC 把它放在 `default.ts`，实现放在 `tokens.ts`）。**这点不算问题**——`defaultTheme` 与 `DesignTokens` 类型在同文件天然耦合，强行拆出 `default.ts` 反而是过度组织。建议把这条偏离写进设计文档备注，避免后续 reviewer 反复纠结。
- 当前没有"主题切换"相关的可变 API，因为 ThemeProvider 还没实现。RFC §3.2 的 `setTheme` 在示例里也是空函数 `setTheme: () => {}`，因此本身就是个未来工作。

### 5.3 易用性风险

- 当 RFC §3.2 把 `<ThemeProvider>` 落地后，开发者会写：
  ```tsx
  <ThemeProvider theme={{ colors: { accent: '#FF0' } }}>
  ```
  此时若 P0-1 没修，由于 SCSS 引用 `var(--reui-color-accent)` 但实际生成的是 `--reui-colors-accent`，开发者将看到"传了 theme 但没生效"，**且没有任何 runtime 报错**——这是排查成本最高的一类 bug。务必在合并 ThemeProvider 之前把 P0-1 修了。

---

## 6. 改进建议（按优先级排序）

1. **立即修 P0-1**：把 `tokensToCssVars` 的 category 前缀按 RFC §3.1 改成单数 `color`、补 `font-size` 等映射；同步纠正测试断言。提供一张 `CATEGORY_PREFIX` 映射表会比正则替换更可读：
   ```ts
   const CATEGORY_PREFIX: Record<keyof DesignTokens, string> = {
     colors: 'color',
     spacing: 'spacing',
     radius: 'radius',
     fontSize: 'font-size',
     animation: 'animation',
     shadow: 'shadow',
   };
   ```
2. **立即补 P0-2**：声明 `peerDependencies` 与 `sideEffects`，把未来阶段的 React/Core 耦合显式化。
3. **改 vitest env**：`environment: 'jsdom'`（仓库统一约束）。
4. **整理 `tests/` 目录**：迁移到 `tests/unit/`，并提前建好 `tests/helpers/`、`tests/setup.ts` 占位，避免后续 React 测试杂乱。
5. **删除或下沉 `flattenTokens`**：当前没有消费方，留着只会引入语义上的歧义。
6. **添加最小 README + ESLint 占位配置**：便于在 CI 流水线里把"工程验收"项目逐项打勾。
7. **下一阶段**（进入 RFC-004 §8.4 Phase 2 时）：
   - 引入 `@reui/core` 真实 `peerDep`，写 `useNuiEvent`/`useEvent` 做端到端 Hook 集成；
   - **强约束 Hooks 仅通过 `@reui/core` 与 Runtime 通信**（AGENTS.md 第 3 条），不允许在 framework 内直连 `window.postMessage`；
   - 引入 `react` / `react-dom` / `@testing-library/react` / `@testing-library/jest-dom`，配齐 jsdom + a11y 测试；
   - 给 `ThemeProvider` 写"自定义主题被正确写入 DOM style 属性"的集成测试，覆盖 P0-1 修复后的真实运行链路。

---

## 附录 A：本次审查触及文件

- `workspace/framework/package.json:1-34`
- `workspace/framework/tsconfig.json:1-11`
- `workspace/framework/vitest.config.ts:1-21`
- `workspace/framework/src/index.ts:1-9`
- `workspace/framework/src/theme/index.ts:1-7`
- `workspace/framework/src/theme/tokens.ts:1-136`
- `workspace/framework/src/theme/theme-utils.ts:1-100`
- `workspace/framework/tests/tokens.test.ts:1-36`
- `workspace/framework/tests/theme-utils.test.ts:1-137`
- `docs/rfcs/rfc-004-framework-ui-library.md`
- `docs/designs/05-framework-ui-design.md`
- `tsconfig.base.json`
- `.codebuddy/rules/001-testing.mdc`
- `AGENTS.md`
