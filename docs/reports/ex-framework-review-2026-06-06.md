# ex-framework 旧库审查与迁移评估报告

- **评审范围**：`sample/ex-framework/`（旧前端库 v0.2.0）
- **评审目的**：为新建 `workspace/framework`（`@reui/framework`，RFC-004）提供架构借鉴与迁移取舍依据
- **对照基准**：现状 `@reui/core`（基础设施已重写）、`docs/rfcs/rfc-004-framework-ui-library.md`、`AGENTS.md` 架构约定
- **评审日期**：2026-06-06
- **评审分支**：`feat/core`

---

## 0. 一句话结论

> `ex-framework` 是**从某个具体产品（疑似 "CAEP" FiveM 社区管理后台）抽取出来的前端库**。它的**基础设施层（Common）已被 `@reui/core` 重写并超越，应整体放弃移植**，只吸收 `TaskManager`/`SharedObject`/`Presence` 等少数有独立价值的概念；UI 层（Framework）是一套**基于 antd v6 的后台管理 UI**，与 RFC-004 要做的**去 antd、token 驱动的游戏化 NUI 组件库方向不同**，只能作为 **API/交互参照物**借鉴，不能直接搬代码。

---

## 1. 架构总览

`ex-framework`（npm 包，ESM，`tsc` 直出 `dist/` + `types/`）由两层构成：

```
ex-framework
│
├── Common/         ── 基础设施层（单例 Manager + 工具）
│   ├── BaseManager (ExModule)     postMessage 事件总线 + Q Promise RPC
│   ├── EventManager (EventUI)     EventEmitter 事件/invoke
│   ├── Network                    axios 实例 + 拦截器 + token
│   ├── WsManager (ExWebsock)      WebSocket 骨架
│   ├── TaskManager                async.queue 并发任务队列 + valtio
│   ├── SharedObject               valtio 跨 iframe 响应式共享状态
│   ├── Storage                    valtio 持久化代理
│   ├── ClickUp                    ClickUp 任务领域模型 ★业务专用
│   ├── Config                     ExConfig 全局配置 ★业务专用
│   └── Utilis/  ExId · Debounce · Interval
│
├── Framework/      ── React UI 组件层（几乎全部基于 antd v6）
│   ├── 容器:  App(死代码) · Content · Frame · Embed · Glass · Error(空)
│   ├── 输入:  Input/{Checkbox,Number,Radio,Select,SelectInput,Slider,Title,Upload,Birth}
│   ├── 展示:  Item · Progress · Loading · Navigation · Menu
│   ├── 反馈:  Message · Modal · Presence
│   └── theme.ts  antd ThemeConfig(dark/light) + lodash combine
│
├── declare/        ── 业务领域类型(ExUser/ExFile/ExInterview)★业务专用
└── styles/         ── SCSS 变量 + common
```

数据流设计意图：`UI 组件 → valtio proxy ↔ Manager → postMessage/WS → 后端/宿主`。

---

## 2. 关键发现

### 2.1 Common 层 = `@reui/core` 同职责，且 core 已实现得更好

| ex-framework/Common | @reui/core（现状） | 结论 |
|---|---|---|
| BaseManager / EventManager | `event.ts` + `client.ts`（MessageDispatcher） | core 已实现，有契约/集成测试 |
| Network | `http.ts` + `auth.ts` | core 已实现 |
| WsManager | `ws.ts` | core 已实现 |
| （无） | `nui.ts` / `plugin.ts` | core 新增 |

### 2.2 Common 层大量是「跑不起来的骨架」

- `BaseManager.ts:1` `import Q from "q"` —— **`q` 不在 `package.json` 依赖里**，文件无法编译。
- `EventManager.send()` 只有一行 `console.log`（EventManager.ts:31），`invoke()` 注册 promise 但**永不 resolve**（无传输层回传）。
- `WsManager.send()` 是**空函数**（WsManager.ts:13），从不建立连接；`onMessage` 未绑定。
- `BaseManager` 的 promise / websocket 分支全是 `// TODO`。

→ Common 层本质是「设计意图存档」，真正可用的实现已在 `@reui/core` 重做。

### 2.3 UI 层方向与 RFC-004 不一致

- 整层建立在 **antd v6** 之上；RFC-004 §2.2 明确**非目标**是依赖第三方组件库，要基于 design tokens 自研游戏化 UI（Hotbar / ItemSlot / RadialMenu）。
- `Frame` / `Embed` 是「用 iframe 嵌网页」的组件，而新 Runtime **本身就是 iframe 宿主**，职责重叠甚至冲突。

---

## 3. 优点

1. **分层清晰**：基础设施与 UI 分离，`exports` 按 `./common`/`./framework` 拆分子路径。
2. **状态选型正确**：统一 `valtio` proxy（TaskManager/SharedObject/Storage/Presence），与新仓库一致。
3. **消息协议雏形完整**：`ExEvent`/`ExPromise`/`ExResult` + `promiseMap`（promiseId 关联请求-响应）= RPC over postMessage 标准做法，与 core `MessageDispatcher` 同源。
4. **少数组件有真实价值**：`TaskManager`/`SharedObject`/`Presence` 在新 RFC 无完全对应物。
5. **SCSS + BEM（`.ex-*`）** 命名规范，与 RFC-004 样式方向一致。

## 4. 缺点与风险

| 类别 | 问题 | 证据 |
|---|---|---|
| 致命 | 依赖 `q`（未声明）；EventManager/WsManager/BaseManager 不可运行骨架 | BaseManager.ts:1, EventManager.ts:31, WsManager.ts:13 |
| 安全 | `window.postMessage(data, "*")` 通配 origin；token 明文存 localStorage，无刷新 | BaseManager.ts:161, Network.ts:47 |
| 架构不匹配 | UI 层强依赖 antd v6，与 RFC-004「去第三方库自研」相悖 | RFC-004 §2.2/§3.3 |
| 职责冲突 | `Frame`/`Embed` 与新 Runtime（iframe 宿主）重叠 | AGENTS.md |
| 业务耦合 | `ClickUp`/`Config`/`Birth`(2010 截断)/`declare/*` 均产品专用 | ClickUp.ts, declare/interview.d.ts |
| 硬编码 | 品牌 "CAEP"、中文文案、颜色 `#2469f0`/`#1e1e1e`、尺寸 `90vw`/`borderRadius:12` 散落各处 | Loading/Frame/Number 等 |
| 明显 Bug | `SelectInput.onChange` 恒传 `value[1]`；`TaskManager.removeTask` 用 `slice` 应为 `splice`；`Message` 方法 import 期即 `throw` | SelectInput.tsx:10, TaskManager.ts:70, Message.tsx:12 |
| 重复造轮子 | 自写 `Debounce` 而 lodash 已是依赖；`ExId`/promiseId 用 `Math.random()` | Utilis/Debounce.ts, ExId.ts |
| 工程缺失 | `tsconfig` `strict:false`；零测试（core 已有大量测试） | tsconfig.json |

---

## 5. 完整组件分析表（用途 + 是否适合迁移）

> **迁移基准**：`@reui/core` 已重做基础设施；`@reui/framework`（RFC-004）做去 antd 的游戏化 UI。
> **迁移结论列**：`否` = 不迁移／`概念` = 仅吸收设计思想重写／`重构` = 交互保留、实现重写／`是` = 可较直接复用（重构后）。

### 5.1 Common 层（基础设施）

| 组件 | 文件 | 用途 | 价值 | 适合迁移？ | 说明 |
|---|---|---|---|---|---|
| BaseManager (ExModule) | Common/BaseManager.ts | postMessage 事件总线 + Q Promise RPC | 概念 | **否** | core `event`+`client` 取代；依赖 `q` 未声明、`"*"` origin。仅留「三类消息 + promiseMap」思路 |
| EventManager (EventUI) | Common/EventManager.ts | EventEmitter 事件/invoke | 低 | **否** | 不可运行骨架；core `event.ts` 已实现 |
| Network | Common/Network.ts | axios 实例 + 拦截器 + token | 概念 | **否** | core `http.ts`+`auth.ts` 取代。可借鉴 401 清 token、`cancelToken` 透传、统一 `NetworkError` |
| WsManager (ExWebsock) | Common/WsManager.ts | WebSocket 骨架 | 低 | **否** | 空实现；core `ws.ts` 已实现并测试 |
| **TaskManager** | Common/TaskManager.ts | `async.queue` 并发任务队列 + valtio 进度状态 | **高** | **是** | core/framework 均无对应物，通用实用（批量上传/导入）。重构：`removeTask` 的 `slice→splice`、abort 联动、去掉 1500ms 魔法延时。建议落 core 或 framework utils |
| SharedObject | Common/SharedObject.ts | valtio proxy + 跨 iframe 状态同步 | 中-高 | **概念** | 对应「跨插件共享响应式状态」。实现脆弱（`sendSign` 防回环靠布尔位、delete 未处理、依赖 stub EventManager）。需基于 `reui:` 协议 + core EventBus 重写为 `useSharedState` |
| Storage | Common/Storage.ts | valtio 持久化代理 | 中 | **重构** | 概念有用（插件本地持久化）。Bug：save key 永远写死 `"UserData"`。重写为 `usePersistentState` |
| Utilis/ExId | Common/Utilis/ExId.ts | 随机 id | 中 | **重构** | 改用 `crypto.randomUUID()`，避免碰撞 |
| Utilis/Interval | Common/Utilis/Interval.ts | 可释放轮询定时器 | 中 | **是** | 轻量好用，封装为 `useInterval` |
| Utilis/Debounce | Common/Utilis/Debounce.ts | 防抖 | 低 | **否** | 直接用 `lodash.debounce` |
| ClickUp | Common/ClickUp.ts | ClickUp 任务领域模型 | 业务 | **否** | 产品专用 |
| Config | Common/Config.ts | ExConfig 全局用户配置 | 业务 | **否** | 产品专用 |

### 5.2 Framework 层（React UI）

| 组件 | 文件 | 用途 | 对应 RFC-004 | 适合迁移？ | 说明 |
|---|---|---|---|---|---|
| App | Framework/App | 顶栏应用壳 | — | **否** | 整文件注释掉的死代码 |
| Error | Framework/Error | — | — | **否** | 空文件 |
| Content | Framework/Content | 异步初始化容器 + 加载动画 | Panel/Loading | **重构** | 保留 onInit + 加载态概念，修 useEffect 依赖，去 antd/framer 重写 |
| Frame | Framework/Frame | iframe 全屏嵌网页 | — | **否** | 与新 Runtime（iframe 宿主）职责冲突 |
| Embed | Framework/Embed | iframe 弹窗嵌网页 | — | **否** | 同上 |
| Glass | Framework/Glass | 玻璃拟物容器（SVG 滤镜） | (Panel 视觉) | **概念** | 视觉效果吸收进 Panel/主题，参数需可配置（现全硬编码） |
| theme.ts | Framework/theme.ts | antd dark/light + lodash combine | 主题系统 | **否** | 已被 `framework/src/theme`（tokens/deepMerge/tokensToCssVars）取代且更优。`combine` = 已有 `deepMerge` |
| Input/Checkbox | Framework/Input/Checkbox | 自定义勾选框 | Checkbox | **重构** | 交互保留，去 antd 自研 |
| Input/Number | Framework/Input/Number | 数字输入 | NumberInput | **重构** | 同上，去掉硬编码 `#000` |
| Input/Select | Framework/Input/Select | 下拉（自定义箭头） | Select | **重构** | 交互保留，自研 |
| Input/Slider | Framework/Input/Slider | 滑块 + 居中范围条 | Slider | **重构** | 范围条双色可视化是亮点，值得吸收 |
| Input/Title | Framework/Input/Title | 行内可编辑文本 | Input | **重构** | 概念保留，清理未用 `createRef` |
| Input/Radio | Framework/Input/Radio | 按钮组单选 | (Button group) | **重构** | 吸收，修 typo `ExConpactSelector` |
| Input/SelectInput | Framework/Input/SelectInput | tags 多选 | Select(多选) | **否** | onChange 逻辑有 bug，合并进 Select 多选模式 |
| Input/Upload | Framework/Input/Upload | 拖拽上传 | — | **重构** | NUI 内上传场景少，降优先级；事件清理/`enablePaste` 死代码 |
| Input/Birth | Framework/Input/Birth | 生日选择 + 算年龄 | — | **否** | 业务专用（2010 截断、年龄计算） |
| Item (Item/Card/ListItem) | Framework/Item | 字段行 / 卡片 / 列表项 | List/Stack | **重构** | ListItem 的 hover 删除交互可吸收 |
| Loading (Screen/Loading) | Framework/Loading | 全屏/区域加载 | Loading | **重构** | 概念保留，去掉硬编码 "CAEP" 与中文 |
| Navigation | Framework/Navigation | 竖向图标导航 | — | **概念** | 通用性一般，可作 sample，不进核心库 |
| Menu | Framework/Menu | antd Menu 包装 | ContextMenu | **否** | 仅改 prefixCls，价值低；RFC 要自研 ContextMenu |
| Message | Framework/Message | 全局轻提示（单例） | Toast | **概念** | import 期 `throw`、挂载后才可用的竞态。命令式 API 思路保留，实现重写 |
| Modal | Framework/Modal | antd Modal 默认值包装 | Dialog | **概念** | RFC 要焦点陷阱/ESC/ARIA，自研 |
| Presence | Framework/Presence | valtio 全局命令式弹窗 | Dialog(命令式) | **重构** | `ExPresence.open()/close()` 命令式 API 设计好，吸收到 Dialog |
| Progress (number/loop) | Framework/Progress | 进度条 | ProgressBar/StatBar | **重构** | 吸收，修 typo `segmengts`，loop 动画参数 token 化 |

### 5.3 declare/（领域类型）

| 类型集 | 文件 | 用途 | 适合迁移？ |
|---|---|---|---|
| ExUser | declare/user.d.ts | 用户/白名单/权限 | **否**（业务专用） |
| ExFile | declare/file.d.ts | 画廊/文档/帖子 | **否**（业务专用） |
| ExInterview | declare/interview.d.ts | 面试任务字段 | **否**（业务专用） |

> 框架级共享类型应放在 `workspace/interface`，而非从此处迁移。

---

## 6. 迁移分桶汇总

- **🔴 直接放弃（15）**：BaseManager、EventManager、Network、WsManager、Debounce、ClickUp、Config、declare/*、App、Error、Frame、Embed、theme.ts、Menu、SelectInput、Birth。
- **🟢 吸收为通用能力（3-4）**：`TaskManager`（并发队列）、`Interval`（→ useInterval）、`ExId`（→ crypto）、`SharedObject` 的「跨 frame 共享状态」概念。
- **🟡 作为 RFC-004 组件设计参照、重写实现（~14）**：Content、Glass、各 Input（Checkbox/Number/Select/Slider/Title/Radio）、Item、Loading、Progress、Message(→Toast)、Modal+Presence(→Dialog)。

---

## 7. 新 `workspace/framework` 落地建议

1. **守住边界**：framework 只做 React UI + Hooks；事件/HTTP/WS/Auth/NUI **一律走 `@reui/core`**，不要把旧 Common 的 Manager 拖进来（AGENTS.md：单例服务唯一来源是 Runtime/core）。
2. **零 antd**：坚持 RFC-004 的 design tokens（`tokens.ts` 已有）+ CSS Custom Properties + BEM，自研组件；旧 antd 组件只看 props 形状与交互。
3. **组件优先级**（对照 RFC-004 §3.3 + 旧库可借鉴度）：
   - 基础：`Text/Stack/Divider/Button/ProgressBar/Loading`（参照旧 Progress/Loading）
   - 输入：`Input/Select/Checkbox/Slider/NumberInput`（对照旧 Input/*）
   - 反馈：`Toast/Dialog`（吸收旧 Message/Presence 命令式 API）
   - 游戏专用：`Panel/ItemSlot/Hotbar/StatBar/RadialMenu` —— **旧库完全没有，纯新增，是真正差异化重点**
4. **Hooks 桥接**：`useNuiEvent/useNuiState/useEvent/usePermission`（RFC-004 §3.5）封装 core，把旧库「valtio + Manager」耦合换成「valtio + core hooks」。
5. **跨 frame 状态**：把 `SharedObject` 重写为基于 core EventBus 的 `useSharedState`，修掉防回环布尔位、delete 不处理的缺陷。
6. **补齐工程基线**：`strict:true` + vitest 组件测试 + 可访问性（焦点陷阱/ARIA），与 core 看齐。

## 8. 风险提示

- **不要复制** token 明文存储与 `"*"` postMessage —— core 已用 `reui:` 前缀 + origin 校验解决，倒退会破坏安全约定。
- **不要带入** `Frame`/`Embed` —— 会与 Runtime 的 iframe 宿主职责打架。
- 旧库多处 import 期副作用（Message throw、Network 读 `import.meta.env`）—— 新组件务必纯净，副作用进 effect。
