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
         ├──→ RFC-006 Runtime 系统级 UI 服务
         │
         ├──→ RFC-007 插件导出与跨插件 / Lua RPC
         │
         └──→ RFC-004 Framework UI 组件库
```

## 阶段总览

| 阶段 | RFC | 标题 | 核心交付 | 前置依赖 |
|------|-----|------|----------|----------|
| Phase 1 | [RFC-001](./rfc-001-protocol-and-core-communication.md) | 通讯协议与核心通讯层 | postMessage 协议、MessageDispatcher、Client 类、握手、心跳 | 无 |
| Phase 2 | [RFC-002](./rfc-002-plugin-system.md) | 插件系统 | plugin.json Schema、Plugin Manager、Layer System、安全三层模型 | RFC-001 |
| Phase 3 | [RFC-003](./rfc-003-runtime-services.md) | Runtime 单例服务与 SDK 模块 | EventBus、WebSocket、HTTP、Auth + @reui/core 全部模块 API | RFC-001, RFC-002 |
| Phase 3.5 | [RFC-006](./rfc-006-runtime-system-ui.md) | Runtime 系统级 UI 服务 | System Layer、SystemUIService、`system:*` 协议、`@reui/core/system` 薄包装 | RFC-001, RFC-002, RFC-003 |
| Phase 3.6 | [RFC-007](./rfc-007-plugin-exports-and-rpc.md) | 插件导出与跨插件 / Lua RPC | ExportRegistry、`@expose` 装饰器、`exports:invoke` 协议、Lua `exports.reui:invokePlugin` 桥接 | RFC-001, RFC-002, RFC-003 |
| Phase 4 | [RFC-004](./rfc-004-framework-ui-library.md) | Framework UI 组件库 | React 组件库、主题系统、Hooks、游戏专用组件 | RFC-001, RFC-003 |
| Phase 5 | [RFC-005](./rfc-005-cli-and-developer-experience.md) | CLI 工具链与开发体验 | CLI 命令、Vite 插件、热重载、开发模式 | RFC-002 |

## 并行开发策略

```
时间线 ──────────────────────────────────────────────────→

Phase 1: ████████████
          RFC-001 (通讯层)

Phase 2:             ████████████████
                     RFC-002 (插件系统)

Phase 3:             ████████████████████
                     RFC-003 (服务 + SDK)

Phase 3.5:                   ████████████
                             RFC-006 (System UI)   ← 在 RFC-003 收尾后启动

Phase 3.6:                   ████████████
                             RFC-007 (Plugin Exports / RPC)   ← 与 RFC-006 可并行

Phase 4:                          ████████████████
                                  RFC-004 (UI 库)     ← 可与 Phase 5 并行

Phase 5:                          ████████████████
                                  RFC-005 (CLI/DX)    ← 可与 Phase 4 并行
```

- **Phase 1** 是所有后续工作的基础，必须最先完成
- **Phase 2** 和 **Phase 3** 可在 Phase 1 完成后并行启动（Phase 3 的 SDK 模块依赖 Phase 2 的 Plugin 类型，但 Runtime 服务本身可先开发）
- **Phase 4** 和 **Phase 5** 完全独立，可并行开发

## 相关文档

- 设计文档（source of truth）：[`docs/designs/`](../designs/)
- Zod Schema 实现：[`workspace/cli/src/schema/plugin-manifest.ts`](../../workspace/cli/src/schema/plugin-manifest.ts)
