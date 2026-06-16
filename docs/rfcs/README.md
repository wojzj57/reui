# ReUI RFC 索引

本目录包含 ReUI 各开发阶段的 RFC（Request for Comments）文档，按模块依赖关系排列。

## 依赖关系图

```
RFC-001 通讯协议与核心通讯层
  │
  ├──→ RFC-002 插件系统
  │      │
  │      └──→ RFC-005 CLI 工具链与开发体验
  │
  └──→ RFC-003 Runtime 单例服务与 SDK 模块
         │
         ├──→ RFC-007 插件导出与跨插件 / Lua RPC
         │      │
         │      └──→ RFC-006 系统 UI 插件（reui-system，经 RFC-007 exports 调用）
         │                     ┊ UI 后续用 RFC-004 framework 实现
         │
         └──→ RFC-004 Framework UI 组件库
```

> **注：** RFC-006（v2 重写）已从「Runtime 内置服务」改为「基于框架的系统插件」，调用一律走 RFC-007 的 `exports:invoke` / Lua 桥，故**强依赖 RFC-007**；其 UI 渲染留待 RFC-004 落地后在 `reui-system` 插件内实现。

## 阶段总览

| 阶段 | RFC | 标题 | 核心交付 | 前置依赖 |
|------|-----|------|----------|----------|
| Phase 1 | [RFC-001](./rfc-001-protocol-and-core-communication.md) | 通讯协议与核心通讯层 | postMessage 协议、MessageDispatcher、Client 类、握手、心跳 | 无 |
| Phase 2 | [RFC-002](./rfc-002-plugin-system.md) | 插件系统 | plugin.json Schema、Plugin Manager、Layer System、安全三层模型 | RFC-001 |
| Phase 3 | [RFC-003](./rfc-003-runtime-services.md) | Runtime 单例服务与 SDK 模块 | EventBus、WebSocket、HTTP、Auth + @reui/core 全部模块 API | RFC-001, RFC-002 |
| Phase 3.6 | [RFC-007](./rfc-007-plugin-exports-and-rpc.md) | 插件导出与跨插件 / Lua RPC | ExportRegistry、`@expose` 装饰器、`exports:invoke` 协议、Lua `exports.reui:invokePlugin` 桥接 | RFC-001, RFC-002, RFC-003 |
| Phase 3.7 | [RFC-006](./rfc-006-runtime-system-ui.md) | 系统 UI 插件（reui-system） | `kind:"system"` 特权插件、`@expose` 的 notify/toast/dialog、`@reui/core/system` 薄包装、Lua 接口；UI 留待 RFC-004 | RFC-001, RFC-002, RFC-003, **RFC-007** |
| Phase 4 | [RFC-004](./rfc-004-framework-ui-library.md) | Framework UI 组件库 | React 组件库、主题系统、Hooks、游戏专用组件 | RFC-001, RFC-003 |
| Phase 5 | [RFC-005](./rfc-005-cli-and-developer-experience.md) | CLI 工具链与开发体验 | CLI 命令、Vite 插件、热重载、开发模式 | RFC-002 |
| Phase 6 | [RFC-009](./rfc-009-fivem-entrance.md) | fivem-entrance 宿主资源 | `@reui/fivem-entrance` 包、NUI 宿主页面、fxmanifest、client/server Lua、可部署资源 | RFC-001, RFC-002, RFC-003, RFC-005 |

## 并行开发策略

```
时间线 ──────────────────────────────────────────────────→

Phase 1: ████████████
          RFC-001 (通讯层)

Phase 2:             ████████████████
                     RFC-002 (插件系统)

Phase 3:             ████████████████████
                     RFC-003 (服务 + SDK)

Phase 3.6:                   ████████████
                             RFC-007 (Plugin Exports / RPC)   ← 在 RFC-003 收尾后启动

Phase 3.7:                              ████████████
                                        RFC-006 (System UI 插件)  ← 依赖 RFC-007，须在其后

Phase 4:                          ████████████████
                                  RFC-004 (UI 库)     ← 可与 Phase 5 并行

Phase 5:                          ████████████████
                                  RFC-005 (CLI/DX)    ← 可与 Phase 4 并行
```

- **Phase 1** 是所有后续工作的基础，必须最先完成
- **Phase 2** 和 **Phase 3** 可在 Phase 1 完成后并行启动（Phase 3 的 SDK 模块依赖 Phase 2 的 Plugin 类型，但 Runtime 服务本身可先开发）
- **RFC-006（系统 UI 插件）依赖 RFC-007 的 exports / Lua 桥**，故须排在 RFC-007 之后；其 UI 渲染再依赖 RFC-004，可等 framework 就绪后补
- **Phase 4** 和 **Phase 5** 完全独立，可并行开发

## 相关文档

- 设计文档（source of truth）：[`docs/designs/`](../designs/)
- Zod Schema 实现：[`workspace/cli/src/schema/plugin-manifest.ts`](../../workspace/cli/src/schema/plugin-manifest.ts)
