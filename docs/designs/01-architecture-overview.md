# ReUI 架构总览

## 1. 项目定位

ReUI 是一个面向 FiveM 的前端插件框架。它通过一个统一的 **Runtime** 宿主页面管理所有子插件页面（iframe），提供核心能力的单例服务，避免各插件重复实现基础设施。

## 2. 系统全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                        FiveM Client (CEF)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────── Runtime (Host Page) ──────────────────┐ │
│  │                                                             │ │
│  │  ┌─────────────┐  ┌──────────┐  ┌────────────────────┐    │ │
│  │  │ NUI Bridge  │  │ EventBus │  │  WebSocket Manager │    │ │
│  │  │(Game ↔ UI)  │  │(单例)    │  │  (单例)            │    │ │
│  │  └─────────────┘  └──────────┘  └────────────────────┘    │ │
│  │  ┌─────────────┐  ┌──────────┐  ┌────────────────────┐    │ │
│  │  │ HTTP Client │  │ Auth     │  │  Plugin Manager    │    │ │
│  │  │ (Axios单例) │  │ Service  │  │  (iframe生命周期)  │    │ │
│  │  └─────────────┘  └──────────┘  └────────────────────┘    │ │
│  │                                                             │ │
│  │  ┌──────────── Layer System ────────────────────────────┐  │ │
│  │  │                                                       │  │ │
│  │  │  ┌─ Layer: HUD (z:100, always visible) ───────────┐  │  │ │
│  │  │  │  <iframe src="hud-plugin/index.html" />         │  │  │ │
│  │  │  └────────────────────────────────────────────────-┘  │  │ │
│  │  │                                                       │  │ │
│  │  │  ┌─ Layer: Panel (z:200, toggle) ─────────────────┐  │  │ │
│  │  │  │  <iframe src="inventory/index.html" />          │  │  │ │
│  │  │  └────────────────────────────────────────────────-┘  │  │ │
│  │  │                                                       │  │ │
│  │  │  ┌─ Layer: Overlay (z:300, modal) ────────────────┐  │  │ │
│  │  │  │  <iframe src="dialog/index.html" />             │  │  │ │
│  │  │  └────────────────────────────────────────────────-┘  │  │ │
│  │  │                                                       │  │ │
│  │  └───────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                  FiveM Game (Lua / C# Server)                   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 核心模块

| 模块 | 包名 | 职责 |
|------|------|------|
| Runtime | `workspace/runtime` | 宿主页面，提供所有单例服务，管理 iframe 生命周期和层级系统 |
| Core | `@reui/core` (`workspace/core`) | 子页面引入的 SDK，内部通过 postMessage 代理调用 Runtime 服务 |
| Framework | `@reui/framework` (`workspace/framework`) | React UI 组件库，可选使用 |
| CLI | `@reui/cli` (`packages/cli`) | 双模式工具包：独立 CLI（校验/签名/脚手架）+ Vite 插件（构建集成），使用 Zod 做 Schema 校验 |
| Samples | `samples/` | 示例子页面 |

## 4. 通讯架构

```
┌──────────────┐      SendNUIMessage       ┌──────────────────┐
│  FiveM Game  │ ──────────────────────────→│                  │
│  (Lua/C#)    │                            │     Runtime      │
│              │←────── fetch(nui-cb) ──────│   (Host Page)    │
└──────────────┘                            │                  │
                                            │  ┌────────────┐  │
                                            │  │ PostMessage │  │
                                            │  │   Router    │  │
                                            │  └─────┬──────┘  │
                                            └────────┼─────────┘
                                                     │ postMessage
                                              ┌──────┴──────┐
                                              ▼             ▼
                                     ┌──────────┐   ┌──────────┐
                                     │ iframe A │   │ iframe B │
                                     │(@reui/   │   │(@reui/   │
                                     │  core)   │   │  core)   │
                                     └──────────┘   └──────────┘
```

### 通讯分层

| 层级 | 方向 | 机制 | 用途 |
|------|------|------|------|
| Game ↔ Runtime | 双向 | NUI (SendNUIMessage / fetch) | 游戏事件传递、数据请求 |
| Runtime ↔ iframe | 双向 | window.postMessage | 子页面调用 Runtime 服务 |
| iframe ↔ iframe | 间接 | 通过 Runtime EventBus 中转 | 插件间通讯 |

## 5. 单例服务设计原则

Runtime 中的核心服务均为 **单例**，确保：

1. **唯一连接** — WebSocket 只建立一条连接，所有插件复用
2. **统一状态** — Auth 状态、权限缓存在 Runtime 中维护，子页面查询即可
3. **资源可控** — 避免每个 iframe 各自创建 HTTP 客户端、WS 连接造成资源浪费
4. **集中管控** — Runtime 可以拦截、审计、限流所有子页面的请求

## 6. 子页面生命周期

```
注册(Config) → 加载(iframe create) → 握手(handshake) → 就绪(ready) → 活跃/休眠 → 卸载(destroy)
```

1. **注册** — 游戏服务端扫描插件目录，验证签名后将清单下发给 Runtime
2. **加载** — Runtime 校验 Schema 和权限后，按 priority 顺序创建 iframe 并分配到对应层级
3. **握手** — iframe 中的 `@reui/core` 初始化时向 Runtime 发送握手消息
4. **就绪** — Runtime 确认握手后，子页面可正常调用所有服务
5. **活跃/休眠** — Runtime 通过 visibility 控制子页面显隐，可通知子页面暂停/恢复
6. **卸载** — Runtime 移除 iframe 并清理关联的事件订阅和资源

## 7. 技术栈选型

| 技术 | 选择 | 理由 |
|------|------|------|
| 构建工具 | Vite | 快速 HMR，适合 CEF 开发 |
| 包管理 | pnpm workspace | monorepo 管理，workspace 协议 |
| Runtime 框架 | TypeScript (Vanilla) | 轻量，无框架依赖 |
| 子页面推荐 | React + TypeScript | 配合 @reui/framework |
| UI 组件库 | @reui/framework (自建) | 统一视觉风格 |
| 通讯协议 | JSON over postMessage | 简单、类型安全 |

## 8. 目录结构

```
ReUI/
├── workspace/
│   ├── runtime/          # 宿主页面
│   │   ├── src/
│   │   │   ├── services/     # 单例服务 (EventBus, WS, HTTP, Auth)
│   │   │   ├── plugin-manager/ # iframe 管理
│   │   │   ├── layer-system/   # 层级系统
│   │   │   ├── nui-bridge/     # FiveM NUI 通讯桥
│   │   │   └── main.ts
│   │   └── index.html
│   ├── core/             # @reui/core SDK
│   │   ├── src/
│   │   │   ├── client.ts      # PostMessage 客户端
│   │   │   ├── event.ts       # 事件系统 API
│   │   │   ├── http.ts        # HTTP 请求代理
│   │   │   ├── ws.ts          # WebSocket 消息订阅
│   │   │   ├── auth.ts        # 权限/认证查询 API
│   │   │   ├── nui.ts         # NUI 游戏通讯 API
│   │   │   ├── plugin.ts      # 插件自身状态 API
│   │   │   └── index.ts
│   │   └── package.json
│   ├── framework/        # @reui/framework UI库
│   │   ├── src/
│   │   │   └── components/
│   │   └── package.json
├── packages/
│   └── cli/              # @reui/cli 工具包
│       ├── src/
│       │   ├── cli.ts          # CLI 入口
│       │   ├── index.ts        # 库入口
│       │   ├── schema/         # Zod Schema 定义
│       │   ├── core/           # 校验/签名/扫描逻辑
│       │   └── vite-plugin/    # Vite 插件
│       └── package.json
├── samples/              # 示例子页面
├── docs/
│   └── designs/
├── scripts/
└── pnpm-workspace.yaml
```
