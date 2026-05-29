# RFC-005: CLI 工具链与开发体验

- **状态**: 草案
- **作者**: ReUI Team
- **创建日期**: 2026-05-27
- **依赖**: RFC-002（插件系统与安全机制）
- **并行开发**: 可与 RFC-004 并行

---

## 1. 背景与动机

ReUI 框架采用 Runtime + 子插件（iframe）架构。随着插件生态的增长，开发者面临以下挑战：

1. **配置校验缺乏自动化**：plugin.json 格式错误只能在运行时发现，调试成本高。
2. **签名流程繁琐**：生产部署前需要手动对插件清单签名（RFC-002 定义的 `_lock` 机制），缺乏工具支持。
3. **新插件创建门槛高**：开发者需手动创建目录结构、配置文件、依赖引用，容易遗漏。
4. **开发体验割裂**：代码热更新（HMR）、配置热重载、状态保持等能力分散在不同层面，缺少统一的工具链整合。
5. **CI/CD 缺乏集成点**：持续集成流水线无法对插件进行自动化校验和签名。

`@reui/cli` 旨在提供一个**双模式工具包**：既是开发者日常使用的命令行工具（校验、签名、脚手架），又作为 Vite 插件深度集成到构建流程中，实现从开发到部署的全链路覆盖。

## 2. 目标与非目标

### 2.1 目标

- 提供完整的 CLI 命令集：`sign`、`verify`、`validate`、`init`、`list`
- 提供 Vite 插件 `vitePluginReUI()`，在 serve/build 两种模式下分别承担实时校验和自动签名
- 支持 `reui.config.json` 项目级配置，统一 CLI 和 Vite 插件的行为参数
- 实现插件热重载完整流程：通知 → 状态保存 → 销毁 → 重新加载 → 状态恢复
- 提供开发模式增强特性：HMR 联动、console 日志、DevTools 快捷键、宽松超时
- 保证安全性：高权限操作需交互确认，密钥通过环境变量传递，源码不被签名修改

### 2.2 非目标

- 不实现插件包发布/注册中心（未来 RFC 范围）
- 不实现可视化 GUI 工具（仅 CLI + Vite 集成）
- 不替代 Runtime 的权限运行时检查机制（Layer 3 由 Runtime 负责）
- 不处理游戏端 Lua 逻辑的构建或部署
- 不实现插件依赖解析（插件之间无依赖关系，见设计文档）

## 3. 详细设计

### 3.1 包结构与双模式设计

`@reui/cli` 位于 `workspace/cli/`，以双模式发布：

```
workspace/cli/
├── src/
│   ├── index.ts              # 库入口（导出 Vite 插件 + 核心 API）
│   ├── cli.ts                # CLI 入口（bin 命令）
│   ├── schema/
│   │   ├── plugin-manifest.ts  # Zod Schema 定义（single source of truth）
│   │   └── plugin-manifest.d.ts # 纯类型声明（供下游包引用）
│   ├── core/
│   │   ├── validator.ts      # 校验逻辑（基于 Zod）
│   │   ├── signer.ts         # 签名逻辑（HMAC-SHA256）
│   │   ├── scanner.ts        # 目录扫描（glob 扫描 plugins/）
│   │   └── scaffold.ts       # 插件脚手架生成
│   ├── vite-plugin/
│   │   └── index.ts          # Vite 插件实现
│   └── commands/
│       ├── sign.ts           # reui sign 命令
│       ├── verify.ts         # reui verify 命令
│       ├── validate.ts       # reui validate 命令
│       ├── init.ts           # reui init 命令
│       └── list.ts           # reui list 命令
├── templates/                # 脚手架模板
│   ├── react/
│   ├── vanilla/
│   └── vue/
├── package.json
└── tsconfig.json
```

#### package.json 关键配置

```json
{
  "name": "@reui/cli",
  "version": "1.0.0",
  "bin": {
    "reui": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./vite": {
      "import": "./dist/vite-plugin/index.mjs",
      "require": "./dist/vite-plugin/index.js",
      "types": "./dist/vite-plugin/index.d.ts"
    }
  },
  "dependencies": {
    "zod": "^3.23.0",
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "glob": "^10.0.0"
  },
  "peerDependencies": {
    "vite": "^5.0.0 || ^6.0.0"
  },
  "peerDependenciesMeta": {
    "vite": { "optional": true }
  }
}
```

#### 核心 API 导出

```typescript
// src/index.ts — 库入口
export { PluginManifestSchema, SecuredFieldsSchema, extractSecuredFields, normalizeForSigning } from './schema/plugin-manifest';
export type { PluginManifest, SecuredFields, DisplayType, Layer, Display, Lock } from './schema/plugin-manifest';

export { validateManifest, validateManifestFile } from './core/validator';
export { signManifest, verifyManifest } from './core/signer';
export { scanPlugins } from './core/scanner';
export { reui as vitePluginReUI } from './vite-plugin';
```

双入口设计使得：
- **CLI 场景**：`npx reui sign` 直接调用 `dist/cli.js`，无需 Vite 环境
- **构建场景**：`import { reui } from '@reui/cli/vite'` 集成到 Vite 配置中
- **编程调用**：`import { validateManifest } from '@reui/cli'` 供 Runtime 或测试使用

### 3.2 CLI 命令

CLI 基于 `commander` 构建，所有命令共享配置加载逻辑（读取 `reui.config.json`）。

#### 3.2.1 reui sign

对插件清单进行 HMAC-SHA256 签名，输出含 `_lock` 字段的 `dist/plugin.json`。

```bash
# 对所有插件签名
reui sign --key <secret>

# 通过环境变量传递密钥（推荐用于 CI/CD）
REUI_SIGN_KEY=mysecret reui sign

# 对单个插件签名
reui sign inventory --key <secret>

# 非交互模式（CI/CD，跳过高权限确认）
reui sign --key <secret> --yes

# 指定插件目录
reui sign --dir plugins/
```

**行为规范：**

1. 扫描 `pluginsDir` 下所有 `plugin.json`
2. 对每个清单执行 Zod Schema 校验，校验失败则报错并跳过
3. 检测高权限 permissions（`runtime.all`、`plugins.all`），非 `--yes` 模式下交互确认
4. 提取安全字段 → 规范化序列化 → HMAC-SHA256 → 生成 `_lock`
5. 将签名后的完整 JSON 写入 `dist/plugin.json`（**源文件不修改**）
6. 输出签名摘要

**输出示例：**

```
[ReUI] Scanning plugins/ ...

  ✓ hud (v1.0.0)
      permissions: []
      roleRestriction: []
      → signed → dist/plugin.json ✓

  ✓ inventory (v2.1.0)
      permissions: [runtime.network, runtime.message, plugins.hud]
      roleRestriction: []
      → signed → dist/plugin.json ✓

  ⚠ admin-panel (v1.0.0)
      permissions: [runtime.all, plugins.all]
      roleRestriction: [admin]
      ⚠ HIGH PRIVILEGE: runtime.all, plugins.all
      Confirm signing? (Y/n) y
      → signed → dist/plugin.json ✓

[ReUI] 3 plugins signed successfully.
```

**密钥优先级：** `--key` 参数 > `REUI_SIGN_KEY` 环境变量 > `reui.config.json` 中 `sign.keyEnv` 指定的环境变量名。

#### 3.2.2 reui verify

验证已签名的 `dist/plugin.json` 是否被篡改。

```bash
reui verify --key <secret>
REUI_SIGN_KEY=mysecret reui verify
```

**行为规范：**

1. 扫描 `pluginsDir` 下所有 `dist/plugin.json`（已签名产物）
2. 对每个文件检查 `_lock` 字段存在性
3. 重新计算安全字段签名并与 `_lock.signature` 进行时间安全比较
4. 报告篡改详情（可能被修改的字段）

**输出示例：**

```
[ReUI] Verifying plugin signatures...
  ✓ hud - signature valid
  ✓ inventory - signature valid
  ✗ admin-panel - SIGNATURE MISMATCH
      The file has been modified after signing.
      Modified fields detected: permissions
      Run `reui sign admin-panel` to re-sign.

[ReUI] 2/3 plugins verified. 1 tampered.
```

**退出码：** 全部通过返回 0，有篡改返回 1（适用于 CI 流水线断言）。

#### 3.2.3 reui validate

仅做 Zod Schema 校验，不需要签名密钥。适用于开发阶段快速检查配置正确性。

```bash
reui validate
reui validate --strict  # 启用严格模式（拒绝未知字段）
```

**行为规范：**

1. 扫描 `pluginsDir` 下所有 `plugin.json`（源文件）
2. 对每个文件执行 Zod Schema 校验
3. 默认宽松模式：未知字段忽略不报错（前向兼容）
4. `--strict` 模式：未知字段视为错误（用于严格控制）

**输出示例：**

```
[ReUI] Validating plugins...
  ✓ hud - valid
  ✓ inventory - valid
  ✗ broken-plugin - INVALID
      • entry: Path traversal (..) not allowed
      • permissions.0: Permission must be dot-separated lowercase
      • version: Must be semver format
  ✓ admin-panel - valid

[ReUI] 3/4 plugins valid. 1 error(s).
```

**校验规则（Zod Schema）：**

- `id`：必填，`/^[a-z][a-z0-9-]*$/`
- `version`：必填，semver 格式
- `entry`：必填，相对路径，禁止 `..` 穿越
- `devEntry`：可选，必须是 `localhost` 或 `127.0.0.1` 地址
- `layer`：必填，枚举 `hud | panel | overlay`
- `permissions`：数组，每项匹配 `/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/`
- `roleRestriction`：字符串数组
- `display`：可选对象，含 `width`、`height`、`position`、`zOffset`

#### 3.2.4 reui init

创建新插件的脚手架，快速搭建标准目录结构。

```bash
reui init my-shop --layer panel --template react
reui init status-bar --layer hud --template vanilla
reui init admin --layer overlay --template vue
```

**参数：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `name` | 插件 ID（必填） | — |
| `--layer` | 层级 | `panel` |
| `--template` | 模板类型 | `reui.config.json` 中配置或 `react` |
| `--dir` | 输出目录 | `pluginsDir/<name>/` |

**模板内容（react）：**

```
plugins/my-shop/
├── plugin.json             # 预填充 id/name/layer/entry
├── index.html              # 标准 HTML 模板
├── src/
│   ├── main.tsx            # React 入口 + @reui/core 初始化
│   ├── App.tsx             # 示例组件
│   └── components/
├── package.json            # 含 @reui/core, @reui/framework 依赖
├── vite.config.ts          # 预配置构建
└── tsconfig.json
```

**生成的 plugin.json 示例：**

```json
{
  "id": "my-shop",
  "name": "My Shop",
  "version": "1.0.0",
  "entry": "dist/index.html",
  "devEntry": "http://localhost:3010",
  "layer": "panel",
  "permissions": [],
  "roleRestriction": [],
  "enabled": true
}
```

#### 3.2.5 reui list

列出所有扫描到的插件及其当前状态。

```bash
reui list
reui list --json  # JSON 格式输出（适合脚本处理）
```

**输出示例：**

```
[ReUI] Plugins in plugins/:

  ID              VERSION   LAYER    PERMISSIONS                SIGNED
  hud             1.0.0     hud      —                          ✓
  inventory       2.1.0     panel    runtime.network +2         ✓
  admin-panel     1.0.0     overlay  runtime.all, plugins.all   ✗ (no _lock)
  broken-plugin   —         —        INVALID MANIFEST           —

[ReUI] 4 plugins found. 2 signed, 1 unsigned, 1 invalid.
```

### 3.3 Vite 插件

`vitePluginReUI()` 提供构建时集成，分为 serve 模式（开发）和 build 模式（生产）两种行为。

#### 3.3.1 插件选项

```typescript
export interface ReUIVitePluginOptions {
  /** 插件目录路径（相对于项目根目录），默认 "plugins/" */
  pluginsDir?: string;

  /** 签名密钥（build 时必须提供，serve 时可选） */
  signKey?: string;

  /** 是否在 serve 模式下实时校验 plugin.json，默认 true */
  validateOnServe?: boolean;

  /** 是否在 build 时自动签名，默认 true */
  signOnBuild?: boolean;

  /** 高权限 permissions，build 签名时会输出警告 */
  highPrivilegePermissions?: string[];
}
```

#### 3.3.2 Serve 模式行为

开发服务器启动时：

1. **初始校验**：扫描 `pluginsDir` 下所有 `plugin.json`，执行 Zod 校验并输出结果
2. **文件监听**：通过 Vite watcher 监听 `**/plugin.json` 变更
3. **实时反馈**：文件修改后立即校验，输出到终端
4. **HMR 通知**：向 Runtime 发送 `reui:plugin-config-changed` 自定义 HMR 事件

```typescript
// configureServer hook
server.watcher.add(path.join(resolvedPluginsDir, '**/plugin.json'));
server.watcher.on('change', async (filePath) => {
  if (filePath.endsWith('plugin.json')) {
    const result = await validateManifestFile(filePath);
    // 输出校验结果到终端...

    // 通知 Runtime HMR
    server.ws.send({
      type: 'custom',
      event: 'reui:plugin-config-changed',
      data: { pluginId: pluginName, valid: result.valid },
    });
  }
});
```

**开发时终端输出示例：**

```
$ pnpm dev

  [ReUI] ✓ hud/plugin.json valid
  [ReUI] ✓ inventory/plugin.json valid
  [ReUI] ✓ admin-panel/plugin.json valid

  VITE v6.x  ready in 320ms

  ... 修改 inventory/plugin.json ...

  [ReUI] ✓ inventory/plugin.json valid
  [HMR] reui:plugin-config-changed
```

#### 3.3.3 Build 模式行为

构建启动时（`buildStart` hook）：

1. **批量校验**：扫描所有插件，校验失败则 `this.error()` 中止构建
2. **高权限警告**：检测高权限并通过 `this.warn()` 输出（不中止）
3. **自动签名**：对每个插件执行签名，输出到 `dist/plugin.json`
4. **密钥检查**：`signOnBuild` 开启但无 `signKey` 时中止构建并提示

```
$ REUI_SIGN_KEY=secret pnpm build

  [ReUI] ✓ Signed: hud → dist/plugin.json
  [ReUI] ✓ Signed: inventory → dist/plugin.json
  [ReUI] ⚠ Plugin "admin-panel" has high-privilege permissions: [runtime.all, plugins.all]
  [ReUI] ✓ Signed: admin-panel → dist/plugin.json

  ✓ built in 1.2s
```

#### 3.3.4 使用方式

```typescript
// vite.config.ts (Runtime 项目)
import { defineConfig } from 'vite';
import { reui } from '@reui/cli/vite';

export default defineConfig({
  plugins: [
    reui({
      pluginsDir: 'plugins/',
      signKey: process.env.REUI_SIGN_KEY,
      validateOnServe: true,
      signOnBuild: true,
      highPrivilegePermissions: ['runtime.all', 'plugins.all'],
    }),
  ],
});
```

### 3.4 配置文件 (reui.config.json)

项目根目录的 `reui.config.json` 为 CLI 和 Vite 插件提供共享配置：

```json
{
  "pluginsDir": "plugins/",
  "sign": {
    "keyEnv": "REUI_SIGN_KEY",
    "confirmHighPrivilege": true,
    "highPrivilegePermissions": ["runtime.all", "plugins.all"]
  },
  "validate": {
    "strictMode": false
  },
  "templates": {
    "default": "react",
    "devServerPortStart": 3010
  }
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `pluginsDir` | `string` | 插件扫描根目录，相对于项目根 |
| `sign.keyEnv` | `string` | 密钥环境变量名 |
| `sign.confirmHighPrivilege` | `boolean` | 签名高权限插件时是否交互确认 |
| `sign.highPrivilegePermissions` | `string[]` | 被视为高权限的 permissions 列表 |
| `validate.strictMode` | `boolean` | 是否启用严格模式拒绝未知字段 |
| `templates.default` | `string` | `reui init` 默认模板 |
| `templates.devServerPortStart` | `number` | 脚手架生成的 devEntry 起始端口号 |

**配置加载优先级：** CLI 参数 > 环境变量 > `reui.config.json` > 内置默认值

## 4. 热重载机制

### 4.1 开发时 HMR (devEntry)

利用 plugin.json 的 `devEntry` 字段，开发时 iframe 加载 Vite dev server URL：

```json
{
  "entry": "dist/index.html",
  "devEntry": "http://localhost:3001"
}
```

**工作原理：**

1. Runtime 检测到 `mode === 'development'` 且 `devEntry` 存在
2. iframe.src 设置为 `devEntry`（而非本地 `entry` 文件）
3. iframe sandbox 追加 `allow-same-origin`（Vite HMR WebSocket 需要此权限）
4. Vite dev server 向 iframe 内页面推送 HMR 更新
5. 代码修改后 iframe 内局部热更新，无需重建 iframe

**限制与安全说明：**

- `devEntry` 仅允许 `localhost` 或 `127.0.0.1`（Zod refine 强制）
- `allow-same-origin` 仅在开发模式追加，生产环境**绝对不包含**
- 开发模式下 iframe 可访问父页面 DOM，仅在本地开发时可接受

### 4.2 插件热重载流程

Runtime 支持运行时重新加载单个或全部插件，无需刷新整个页面：

```
触发重载
    │
    ▼
┌─────────────────────────────────┐
│ 1. 通知插件 plugin:beforeUnload │
│    payload: { reason: 'reload' }│
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 2. 等待插件保存状态              │
│    (最多 5s grace period)        │
│    等待 unload-ready ACK 或超时  │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 3. 销毁旧 iframe                │
│    - 移除 DOM 节点              │
│    - 清理 PostMessage 路由      │
│    - 清理 EventBus 订阅         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 4. 请求游戏端重新读取 manifest  │
│    NUI Callback: reui:readManifest│
│    (获取最新 plugin.json)        │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 5. 角色检查                      │
│    checkRoleAccess(manifest,     │
│    currentRoles)                 │
│    不通过 → 终止，不创建新 iframe│
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 6. 创建新 iframe + 重新握手     │
│    新实例进入 loading → ready    │
└─────────────────────────────────┘
```

**触发方式：**

| 触发方式 | 场景 | 实现 |
|----------|------|------|
| 游戏端命令 | `/reui reload <pluginId>` | Lua → SendNUIMessage |
| 开发快捷键 | `Ctrl+Shift+R` | Runtime 监听键盘事件（仅开发模式） |
| API 调用 | 管理面板通过权限触发 | PostMessage 路由处理 |
| 文件监听 | Vite HMR 事件 `reui:plugin-config-changed` | Vite 插件 → Runtime |

**rescanPlugins（目录重扫描）：**

- **开发模式**：通过 NUI Callback 请求客户端 Lua 直接扫描 `plugins/` 目录（跳过签名）
- **生产模式**：通过 NUI Callback 请求服务端重新扫描并验签后下发更新列表

重扫描会发现新增插件（自动加载）和已删除插件（自动卸载），已存在的插件不受影响。

### 4.3 状态保持 (saveState/restoreState)

热重载时，插件可通过 `@reui/core` 提供的 API 保存和恢复状态：

```typescript
// 子页面侧（使用 @reui/core）
import { plugin } from '@reui/core';

// 监听即将卸载通知
plugin.onBeforeUnload(async (reason) => {
  if (reason === 'reload') {
    // 保存状态到 Runtime 临时存储
    await plugin.saveState({
      scrollPosition: 100,
      selectedTab: 'weapons',
      formData: { /* ... */ },
    });
  }
});

// 插件启动时恢复状态
const savedState = await plugin.restoreState();
if (savedState) {
  applyState(savedState);
}
```

**实现细节：**

- `plugin.saveState(data)` 通过 PostMessage 将序列化状态发送给 Runtime
- Runtime 将状态存储在内存 Map 中（key = pluginId）
- `plugin.restoreState()` 在新 iframe 握手完成后从 Runtime 获取缓存的状态
- 状态在下一次重载前有效，非持久化存储
- 状态大小限制：建议不超过 1MB（防止内存膨胀）

**超时处理：**

- Runtime 发送 `plugin:beforeUnload` 后最多等待 **5 秒**
- 超时后强制继续卸载流程（防止无响应插件阻塞操作）
- 插件应在 5s 内完成所有异步状态保存

## 5. 开发模式特性

当 Runtime 以 `development` 模式运行时，以下开发辅助特性自动启用：

### 5.1 iframe 加载行为

| 特性 | 开发模式 | 生产模式 |
|------|----------|----------|
| iframe src | `devEntry`（Vite dev server） | `entry`（本地文件） |
| sandbox | `allow-scripts allow-same-origin` | `allow-scripts` |
| HMR | ✅ Vite WebSocket 热更新 | ❌ 不支持 |
| `_lock` 签名验证 | ⏭️ 跳过（服务端不验） | ✅ 服务端必须通过 |
| 无 `_lock` 字段 | ✅ 允许加载 | ❌ 服务端拒绝 |

### 5.2 Console 消息日志

开发模式下，Runtime 对所有 PostMessage 通讯进行日志输出：

```typescript
// 开发模式下的消息日志
if (mode === 'development') {
  console.groupCollapsed(`[ReUI] ${direction} ${pluginId} → ${method}`);
  console.log('payload:', payload);
  console.log('timestamp:', Date.now());
  console.groupEnd();
}
```

### 5.3 DevTools Overlay

通过快捷键 `Ctrl+Shift+D` 打开 DevTools overlay，提供：

- 当前已加载插件列表及其状态（loading/ready/active/hidden/error）
- 各插件 PostMessage 通讯日志（实时）
- 单个插件重载按钮
- 权限检查结果查看
- 心跳状态监控

### 5.4 心跳超时放宽

| 参数 | 开发模式 | 生产模式 |
|------|----------|----------|
| 心跳间隔 | 30s | 10s |
| 超时判定 | 连续 5 次无响应 | 连续 3 次无响应 |
| 总容忍时间 | 150s | 30s |

放宽原因：开发时可能在断点调试，心跳无法按时响应，不应误报为插件崩溃。

### 5.5 快捷键汇总

| 快捷键 | 功能 | 仅开发模式 |
|--------|------|-----------|
| `Ctrl+Shift+R` | 重载当前焦点插件 | ✅ |
| `Ctrl+Shift+D` | 打开/关闭 DevTools overlay | ✅ |
| `Ctrl+Shift+A` | 重载全部插件 | ✅ |

### 5.6 模式切换配置

```typescript
// runtime.config.json
{
  "mode": "development",  // "development" | "production"
  "devOptions": {
    "logMessages": true,
    "devToolsOverlay": true,
    "relaxedHeartbeat": true
  }
}
```

游戏端通过 convar 控制：

```lua
-- server.cfg
set reui_mode "development"  -- 或 "production"
```

## 6. 测试计划

### 6.1 单元测试

| 模块 | 覆盖内容 |
|------|----------|
| `schema/plugin-manifest.ts` | Zod Schema 各字段校验规则、边界值、refine 规则 |
| `core/validator.ts` | 有效/无效清单校验、strictMode、错误格式化 |
| `core/signer.ts` | 签名生成、验证、篡改检测、时间安全比较 |
| `core/scanner.ts` | 目录扫描、嵌套处理、无效文件跳过 |
| `core/scaffold.ts` | 模板渲染、文件生成、变量替换 |

### 6.2 集成测试

| 场景 | 验证内容 |
|------|----------|
| CLI sign → verify 往返 | 签名后 verify 通过；篡改后 verify 失败 |
| Vite serve 模式 | 启动时校验输出、文件变更触发、HMR 事件发送 |
| Vite build 模式 | 校验失败中止构建、签名写入 dist/、高权限警告 |
| reui init | 生成完整目录结构、plugin.json 正确、模板可构建 |
| 配置文件加载 | 参数优先级正确、缺省值合理 |

### 6.3 端到端测试

| 场景 | 验证内容 |
|------|----------|
| 热重载完整流程 | 触发 → 通知 → 状态保存 → 销毁 → 重载 → 状态恢复 |
| 开发模式 HMR | 修改代码 → iframe 内局部更新（不重建 iframe） |
| plugin.json 变更 | 修改配置 → Vite 检测 → HMR 通知 → Runtime 重载 |
| 高权限确认 | 交互模式弹出确认、`--yes` 跳过确认 |
| CI 流水线 | validate → sign → verify 全链路退出码正确 |

### 6.4 安全测试

| 场景 | 验证内容 |
|------|----------|
| 篡改 permissions 后 verify | 检测失败并报告被修改字段 |
| 无密钥 build | 报错并提示设置 REUI_SIGN_KEY |
| devEntry 非 localhost | Zod refine 拒绝 |
| entry 含 `..` 路径穿越 | Zod refine 拒绝 |

## 7. 验收标准

### 7.1 CLI 验收

- [ ] `reui validate` 能正确检测所有 Zod 校验规则并以人类可读格式输出
- [ ] `reui sign` 对所有插件生成有效签名，输出到 `dist/plugin.json`，源文件不变
- [ ] `reui sign` 在检测到高权限时交互确认，`--yes` 标志跳过确认
- [ ] `reui verify` 能检测篡改并返回非零退出码
- [ ] `reui init` 生成的项目结构可直接 `pnpm install && pnpm dev` 启动
- [ ] `reui list` 正确显示所有插件状态信息
- [ ] 所有命令正确读取 `reui.config.json` 配置

### 7.2 Vite 插件验收

- [ ] Serve 模式启动时输出所有插件校验结果
- [ ] Serve 模式下修改 `plugin.json` 触发实时校验和 HMR 通知
- [ ] Build 模式校验失败时中止构建
- [ ] Build 模式无 signKey 时报错提示
- [ ] Build 模式自动签名写入各插件 `dist/plugin.json`
- [ ] 高权限插件在 build 时输出警告

### 7.3 热重载验收

- [ ] `plugin:beforeUnload` 通知在卸载前发送，等待最多 5s
- [ ] `plugin.saveState()` / `plugin.restoreState()` 正确保存和恢复状态
- [ ] 重载后插件进入正常 loading → ready → active 生命周期
- [ ] rescanPlugins 正确发现新增和删除的插件
- [ ] 所有触发方式（游戏命令、快捷键、API、文件监听）均可工作

### 7.4 开发模式验收

- [ ] devEntry 正确加载 Vite dev server
- [ ] iframe sandbox 在开发模式包含 `allow-same-origin`
- [ ] HMR 代码热更新在 iframe 内正常工作
- [ ] Console 消息日志正确输出 PostMessage 通讯
- [ ] DevTools overlay 可通过快捷键打开并显示插件状态
- [ ] 心跳超时在开发模式下放宽

## 8. 依赖关系

### 8.1 对 RFC-002 的依赖

本 RFC 的 CLI 签名/验签功能直接实现 RFC-002 定义的安全机制：

- **`_lock` 字段格式**：RFC-002 §5.3 定义
- **签名覆盖字段**：RFC-002 §5.3.3 定义的安全字段列表
- **HMAC-SHA256 算法**：RFC-002 §5.3.4 定义的签名流程
- **密钥管理方案**：RFC-002 §5.3.5 定义的 `REUI_SIGN_KEY` / convar 方案
- **Zod Schema**：RFC-002 §5.2 定义的校验规则

### 8.2 与 RFC-004 的并行关系

RFC-004（UI 框架）和本 RFC 无直接依赖：

- `@reui/cli` 不依赖 `@reui/framework`
- `reui init` 模板中可选引入 `@reui/framework`，但模板生成本身不需要框架包存在
- 两者可独立开发和测试

### 8.3 外部依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `zod` | ^3.23.0 | Schema 校验 |
| `commander` | ^12.0.0 | CLI 命令解析 |
| `chalk` | ^5.3.0 | 终端彩色输出 |
| `glob` | ^10.0.0 | 文件目录扫描 |
| `vite` | ^5.0.0 \|\| ^6.0.0 | Vite 插件宿主（optional peer） |

### 8.4 内部依赖

```
@reui/cli
  └── 被以下包使用：
      ├── workspace/runtime  (Vite 插件 + validateManifest API)
      └── 各子插件项目      (可选，用于本地 validate)
```

### 8.5 实现里程碑

| 阶段 | 内容 | 预估工期 |
|------|------|----------|
| Phase 1 | Zod Schema + validator + scanner | 1 周 |
| Phase 2 | signer + verify + CLI 框架 | 1 周 |
| Phase 3 | Vite 插件（serve + build） | 1 周 |
| Phase 4 | reui init 脚手架 + 模板 | 0.5 周 |
| Phase 5 | 热重载 Runtime 集成 | 1 周 |
| Phase 6 | 开发模式增强 + DevTools | 1 周 |
| Phase 7 | 测试 + 文档 + CI 集成 | 1 周 |

**总计：约 6.5 周**

---

## 附录 A: CLI 与 Vite 插件功能对比

| 功能 | CLI (`reui xxx`) | Vite 插件 (`vitePluginReUI()`) |
|------|-----------------|-------------------------------|
| Schema 校验 | `reui validate` | serve 时实时校验 + build 时批量校验 |
| 签名 | `reui sign` | build 时自动签名 |
| 验证签名 | `reui verify` | —（运行时由游戏服务端验证） |
| 创建插件 | `reui init` | — |
| 列出插件 | `reui list` | — |
| HMR 联动 | — | ✅ plugin.json 变更通知 Runtime |
| CI/CD 集成 | ✅ 适合 | ✅ 集成到 vite build |
| 需要 Vite | ❌ 不需要 | ✅ 需要 |

## 附录 B: 典型工作流

### 开发工作流

```bash
# 1. 创建新插件
reui init my-plugin --layer panel --template react

# 2. 启动开发（Vite 插件自动校验）
pnpm dev
# → [ReUI] ✓ my-plugin/plugin.json valid
# → 修改代码 → HMR 热更新
# → 修改 plugin.json → 实时校验 + Runtime 重载通知

# 3. 手动校验（可选）
reui validate
```

### CI/CD 工作流

```bash
# 1. 校验（PR 检查）
reui validate
# 退出码 0 = 通过

# 2. 签名（部署前）
REUI_SIGN_KEY=$SECRET reui sign --yes
# 退出码 0 = 全部签名成功

# 3. 验证（部署后可选）
REUI_SIGN_KEY=$SECRET reui verify
# 退出码 0 = 全部签名有效

# 4. 部署 dist/ 产物到 FiveM 服务器
```

### 调试热重载

```
1. 游戏内输入 /reui reload inventory
2. Runtime 通知 inventory 插件 beforeUnload
3. inventory 调用 plugin.saveState({ ... })
4. 5s 内完成 → Runtime 销毁旧 iframe
5. Runtime 请求游戏端重读 manifest
6. 创建新 iframe → 握手 → inventory 调用 plugin.restoreState()
7. 恢复之前的 UI 状态
```
