# ReUI — AI Agent 导航图

> 渐进式披露入口。先读此图，再按任务类型跳转到对应深度文档。

## 项目一句话

ReUI 是一个面向 FiveM 的前端插件框架：单一 **Runtime** 宿主页面（NUI）通过 iframe 管理子插件页面，集中提供事件总线、WebSocket、HTTP、Auth、System UI 等单例服务，让插件不再重复造基础设施。

---

## 按任务快速导航

| 你的任务 | 先去这里 | 说明 |
|---|---|---|
| **了解整体架构与数据流** | [`docs/designs/01-architecture-overview.md`](./docs/designs/01-architecture-overview.md) | 系统全景图、单例服务、子页面生命周期、目录结构 |
| **理解通讯基础（必读）** | [`docs/rfcs/rfc-001-protocol-and-core-communication.md`](./docs/rfcs/rfc-001-protocol-and-core-communication.md) | postMessage 协议、MessageDispatcher、握手、心跳 |
| **写 / 改插件** | [`docs/rfcs/rfc-002-plugin-system.md`](./docs/rfcs/rfc-002-plugin-system.md) + [`docs/designs/06-plugin-specification.md`](./docs/designs/06-plugin-specification.md) | plugin.json、Plugin Manager、Layer System、签名与权限 |
| **使用 / 扩展 Runtime 服务** | [`docs/rfcs/rfc-003-runtime-services.md`](./docs/rfcs/rfc-003-runtime-services.md) | EventBus / WebSocket / HTTP / Auth + `@reui/core` SDK 模块 |
| **写 React UI / 用组件库** | [`docs/rfcs/rfc-004-framework-ui-library.md`](./docs/rfcs/rfc-004-framework-ui-library.md) | `@reui/framework` 组件、主题、Hooks、游戏专用组件 |
| **CLI / 构建 / 开发体验** | [`docs/rfcs/rfc-005-cli-and-developer-experience.md`](./docs/rfcs/rfc-005-cli-and-developer-experience.md) | `@reui/cli`、Vite 插件、热重载、校验/签名 |
| **System Layer 与系统级 UI** | [`docs/rfcs/rfc-006-runtime-system-ui.md`](./docs/rfcs/rfc-006-runtime-system-ui.md) | System Layer、SystemUIService、`system:*` 协议 |
| **跨插件 / Lua RPC 调用** | [`docs/rfcs/rfc-007-plugin-exports-and-rpc.md`](./docs/rfcs/rfc-007-plugin-exports-and-rpc.md) | ExportRegistry、`@expose`、`exports:invoke`、Lua 桥接 |
| **RFC 全局索引** | [`docs/rfcs/README.md`](./docs/rfcs/README.md) | RFC 依赖图、阶段总览、并行开发策略 |
| **FiveM / Lua / NUI 领域知识** | [`agents/skills/`](./agents/skills/) | 见下方「Skills 路径」一节 |

---

## 30 秒项目速览

- **运行环境**：FiveM 客户端 CEF（NUI），子插件以 iframe 形式被 Runtime 加载与管理。
- **包管理**：pnpm workspaces（monorepo），workspace 协议互联。
- **技术栈**：TypeScript（Runtime 用 Vanilla TS）+ React + Vite + Zod（Schema 校验）。
- **三大产出包**：`@reui/core`（SDK）、`@reui/framework`（UI 库）、`@reui/cli`（CLI + Vite 插件）。
- **通讯模型**：
  - Game ↔ Runtime：FiveM NUI（`SendNUIMessage` + `fetch` callback）
  - Runtime ↔ iframe：`window.postMessage`，统一前缀 `reui:`
  - iframe ↔ iframe：通过 Runtime EventBus 中转，不直接互相 postMessage
- **常用命令**：
  ```bash
  pnpm install
  pnpm -F runtime dev
  pnpm -F @reui/core build
  pnpm -F @reui/framework build
  ```

---

## 目录结构地图

```
ReUI/
├── workspace/                Monorepo 工作区（pnpm）
│   ├── runtime/              Runtime 宿主页面（NUI 主页）
│   ├── core/                 @reui/core —— 子页面引入的 postMessage SDK
│   ├── framework/            @reui/framework —— React UI 组件库
│   ├── cli/                  @reui/cli —— CLI + Vite 插件 + Zod Schema
│   └── interface/            共享类型与协议接口
├── samples/                  示例子插件
├── docs/
│   ├── rfcs/                 阶段性 RFC（决议来源，见下表）
│   ├── designs/              架构设计文档（source of truth）
│   ├── plans/                开发计划
│   ├── references/           外部参考资料（FiveM manifest 等）
│   └── reports/              评估 / 验收报告
├── agents/skills/            ★ AI Agent Skills 真相源（FiveM / Lua / NUI 等领域）
├── .claude/skills/           Claude 本地镜像（与 agents/skills/ 内容一致）
├── scripts/                  工程脚本
└── local/                    本地实验产物（非提交主线）
```

---

## RFC 阶段总览（依赖顺序）

| 阶段 | RFC | 标题 | 依赖 |
|------|-----|------|------|
| Phase 1 | [RFC-001](./docs/rfcs/rfc-001-protocol-and-core-communication.md) | 通讯协议与核心通讯层 | 无 |
| Phase 2 | [RFC-002](./docs/rfcs/rfc-002-plugin-system.md) | 插件系统（plugin.json / Layer / 签名） | RFC-001 |
| Phase 3 | [RFC-003](./docs/rfcs/rfc-003-runtime-services.md) | Runtime 单例服务与 SDK 模块 | RFC-001/002 |
| Phase 3.5 | [RFC-006](./docs/rfcs/rfc-006-runtime-system-ui.md) | Runtime 系统级 UI 服务 | RFC-001/002/003 |
| Phase 3.6 | [RFC-007](./docs/rfcs/rfc-007-plugin-exports-and-rpc.md) | 插件导出与跨插件 / Lua RPC | RFC-001/002/003 |
| Phase 4 | [RFC-004](./docs/rfcs/rfc-004-framework-ui-library.md) | Framework UI 组件库 | RFC-001/003 |
| Phase 5 | [RFC-005](./docs/rfcs/rfc-005-cli-and-developer-experience.md) | CLI 工具链与开发体验 | RFC-002 |

> Phase 4 与 Phase 5 完全独立，可并行开发；详见 [`docs/rfcs/README.md`](./docs/rfcs/README.md)。

---

## Skills 路径

ReUI 的 AI Agent 领域知识以 Skills 的方式提供，**真相源位于 `agents/skills/`**，每个 Skill 是一个目录，包含 `SKILL.md`（使用条件 + 索引）与 `references/`（细分主题文档）。

```
agents/skills/
├── FiveM/                FiveM 官方文档全集（natives / scripting-manual / resources / ...）
├── fivem-basics/         FiveM 基础：fxmanifest、client/server、events、exports、debugging
├── fivem-nui/            NUI 开发：setup、callbacks、fullscreen、最佳实践
├── fivem-security/       FiveM 安全：事件防伪造、权限校验
├── fivemanage/           Fivemanage：日志 / 图片 / 配置 / 安装
├── lua-basics/           Lua 基础：variables、tables、functions、conditionals、errors
├── oxlib/                ox_lib：addCommand、callback、interface、zones、init
├── oxmysql/              oxmysql：query / single / scalar / insert / update / transaction / prepare / placeholders / rawExecute
└── qbcore-framework/     QBCore：core-concepts、player-methods、最佳实践
```

约定：

- **真相源唯一**：所有 Skill 内容以 `agents/skills/<name>/SKILL.md` 为准。`.claude/skills/` 仅作为 Claude Code 客户端的本地镜像，不要双向编辑，统一改 `agents/skills/`。
- **触发方式**：当任务命中 `SKILL.md` 顶部 frontmatter 中 `description` 描述的场景时，先加载该 Skill，再按需读取 `references/` 下的细分文档。
- **新增 Skill**：按既有目录布局新建 `agents/skills/<your-skill>/{SKILL.md, references/*.md}`，并保持镜像同步策略由脚本/工具完成，避免手工双写。

---

## 关键约定速查（不可违背）

1. **通讯前缀统一**：所有 Runtime ↔ iframe 消息 `type` 必须以 `reui:` 开头，由 `MessageDispatcher` 集中分发，禁止子页面自行监听原生 `message`。
2. **iframe 间不直连**：插件之间通讯一律通过 Runtime EventBus 或 RFC-007 的 `exports:invoke`，禁止 iframe 直接 postMessage 互发。
3. **单例服务唯一来源**：WebSocket、HTTP、Auth、EventBus 仅由 Runtime 持有；子页面只能通过 `@reui/core` 代理调用。
4. **Schema 校验前置**：plugin.json 必须通过 `@reui/cli` 的 Zod Schema 校验后再加载；Schema 实现见 [`workspace/cli/src/schema/plugin-manifest.ts`](./workspace/cli/src/schema/plugin-manifest.ts)。
5. **签名后才生效**：插件交付物在生产环境必须经过 `@reui/cli` 签名；未签名包不得在 Runtime 中加载。
6. **Layer 归属明确**：每个插件 iframe 必须挂载到 HUD / Panel / Overlay / System 之一的 Layer 上，由 Runtime 管理 z-index 与可见性。
7. **设计文档优先于代码注释**：`docs/designs/` 与 `docs/rfcs/` 是 source of truth；与代码不一致时优先修代码，再视情况更新文档。
8. **Skills 真相源**：仅修改 `agents/skills/`；不要把领域知识塞进代码注释或散落 markdown。

---

## 外部参考

- **CONTRIBUTING**: [`./CONTRIBUTING.md`](./CONTRIBUTING.md)
- **Claude Code 入口**: [`./CLAUDE.md`](./CLAUDE.md)
- **FiveM 官方文档**: https://docs.fivem.net/docs/
- **FiveM Natives**: https://docs.fivem.net/natives/
