# RFC-008: @reui/framework 组件 Gallery（Storybook）

> 状态：**Draft**｜优先级：中｜依赖：RFC-004

---

## 摘要

为 `@reui/framework` 建立基于 **Storybook 7** 的本地开发 Gallery（`workspace/framework-storybook`），用于展示所有组件样式、Props API 与使用示例，支持交互式 Controls 调节 props、一键复制代码。仅本地开发使用，不部署。

---

## 动机

1. **组件开发自测**：框架开发者需要一个快速预览组件样式与交互效果的本地环境
2. **对外演示**：开发者在评估 ReUI 时，可通过本地启动的 Storybook 查看所有组件效果与用法
3. **Storybook 生态成熟**：Controls 面板天然支持 props 交互调节，Actions 面板可查看回调日志，无需自行实现

---

## 非目标

- 不部署到线上（仅 `pnpm storybook` 本地跑）
- 不覆盖 `@reui/core` 的 SDK 示例（那是另一个 samples 包的事）
- 不实现自动 Props 文档生成（手写 stories，Props 表格手动维护或用 Storybook Docs addon）

---

## 技术方案

### 技术栈

| 关注点 | 选型 | 理由 |
|--------|------|------|
| 框架 | **Storybook 7** (`@storybook/react-vite`) | 与 Vite monorepo 无缝集成，原生 React + Controls |
| 构建工具 | Vite（Storybook 内置） | 与 monorepo 一致 |
| 框架版本 | React 18 | 与 `@reui/framework` 一致 |
| 样式 | `@reui/framework` 自带 `ReUIProvider` + Design Tokens | 展示即最终效果 |
| 代码高亮 | Storybook `Docs` addon（`@storybook/addon-docs`） | 每个 story 自动生成代码块 + 复制按钮 |
| Mock | 手写 mock 数据（`workspace/framework-storybook/mocks/`） | FiveM 专用组件需要模拟玩家数据 |
| 包管理器 | pnpm workspace | 与 monorepo 一致 |

### 目录结构

```
workspace/framework-storybook/
├── package.json
├── tsconfig.json
├── .storybook/
│   ├── main.ts               Storybook 主配置（addons、vite 别名）
│   ├── preview.ts           全局 decorator、参数
│   └── preview-head.html    注入 antd 字体/CDN（可选）
├── mocks/
│   ├── player.ts            FiveM 玩家数据 mock
│   └── nui.ts              模拟 useNuiEvent / useNuiState
├── stories/
│   ├── Introduction.mdx     Gallery 首页（组件索引）
│   ├── Form/
│   │   ├── Input.stories.tsx
│   │   ├── Select.stories.tsx
│   │   ├── Checkbox.stories.tsx
│   │   ├── Radio.stories.tsx
│   │   ├── Slider.stories.tsx
│   │   └── NumberInput.stories.tsx
│   ├── DataDisplay/
│   │   ├── ProgressBar.stories.tsx
│   │   ├── Loading.stories.tsx
│   │   ├── List.stories.tsx
│   │   └── StatBar.stories.tsx
│   ├── Feedback/
│   │   ├── Toast.stories.tsx
│   │   └── Dialog.stories.tsx
│   ├── Layout/
│   │   ├── Panel.stories.tsx
│   │   └── Stack.stories.tsx
│   ├── Overlay/
│   │   └── ContextMenu.stories.tsx
│   └── FiveM/
│       ├── Numpad.stories.tsx       # 占位，组件实现后补全
│       └── CircleInput.stories.tsx  # 占位，组件实现后补全
└── vite.config.ts            （可选，独立 build 时用）
```

---

## 展示内容设计

### 组件分类（与 RFC-004 一致）

| 分类 | 组件 | 状态 |
|------|------|------|
| **Form 表单** | Input, Select, Checkbox, Radio, Slider, NumberInput | ✅ 已实现 |
| **Data Display 数据展示** | ProgressBar, Loading, List, StatBar | ✅ 已实现 |
| **Feedback 反馈** | Toast, Dialog | ✅ 已实现（命令式 API） |
| **Layout 布局** | Panel, Stack | ✅ 已实现 |
| **Overlay 浮层** | ContextMenu | ✅ 已实现 |
| **FiveM 专用** | Numpad, CircleInput | 🔜 计划中 |

### 每个组件的 Story 规范

每个 `.stories.tsx` 文件至少包含：

1. **Default** — 基础用法（Controls 可调 props）
2. **变体 Stories** — 2-3 个典型用法（如 Input 的 `editable` 模式、Select 的 `multi` 模式）
3. **代码块** — Storybook Docs addon 自动从 story 源码生成，支持一键复制
4. **Description** — 用 JSDoc 或 MDX 写一段简短说明

示例（`Input.stories.tsx`）：

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Input } from '@reui/framework';

const meta: Meta<typeof Input> = {
  title: 'Form/Input',
  component: Input,
  parameters: {
    docs: {
      description: {
        component: '基于 antd Input 封装，吸收旧 ex-framework 的 editable 行内编辑模式。',
      },
    },
  },
  argTypes: {
    editable: { control: 'boolean' },
    onEditSubmit: { action: 'onEditSubmit' },
    onEditCancel: { action: 'onEditCancel' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text',
  },
};

export const Editable: Story = {
  args: {
    editable: true,
    defaultValue: 'Click to edit',
    onEditSubmit: (val) => console.log('submit', val),
  },
};
```

---

## Mock 数据策略

### FiveM 玩家数据 Mock

在 `mocks/player.ts` 提供模拟数据，供 FiveM 专用组件 stories 使用：

```ts
// mocks/player.ts
export const mockPlayer = {
  name: 'Grimes_Z',
  id: 42,
  health: 85,
  armor: 60,
  money: 12500,
  bank: 480000,
  job: 'Police',
  rank: 'Sergeant',
};
```

### NUI Hooks Mock

`useNuiEvent`、`useNuiState` 等 hooks 在 Storybook 环境中无法连接真实游戏，需要提供 mock 版本：

```ts
// mocks/nui.ts
// 在 .storybook/preview.ts 中通过 decorator 注入
export const mockNuiEvent = (eventName: string, handler: (data: any) => void) => {
  // Storybook 中：不注册真实监听，由开发者手动触发
};

export const mockNuiState = <T,>(eventName: string, initialValue: T): T => initialValue;
```

在 `.storybook/preview.ts` 中通过 `decorators` 用 `MemoryRouter` 或 wrapper 注入 mock 实现，不修改 `@reui/framework` 源码。

---

## `.storybook/main.ts` 关键配置

```ts
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';
import { join, dirname } from 'path';

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(js|ts|jsx|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',  // Docs, Controls, Actions, Viewport
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    // 别名：指向 workspace 中的 @reui/framework 源码（dev 热更新）
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@reui/framework': join(__dirname, '../../workspace/framework/src'),
    };
    return config;
  },
};

export default config;
```

---

## `.storybook/preview.ts` 关键配置

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/react';
import { ReUIProvider } from '@reui/framework';

const preview: Preview = {
  decorators: [
    (Story) => (
      <ReUIProvider>
        <Story />
      </ReUIProvider>
    ),
  ],
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: { expanded: true },
  },
};

export default preview;
```

---

## 实现步骤

### Phase 1: 基础设施

- [ ] 创建 `workspace/framework-storybook/` 目录与 `package.json`（注册到 pnpm workspace）
- [ ] 安装 Storybook 7 + `@storybook/react-vite` + addons
- [ ] 配置 `.storybook/main.ts`（vite 别名指向 workspace framework 源码）
- [ ] 配置 `.storybook/preview.ts`（`ReUIProvider` decorator）
- [ ] 创建 `mocks/player.ts` 和 `mocks/nui.ts`
- [ ] 创建 `stories/Introduction.mdx`（Gallery 首页，组件索引目录）

### Phase 2: 逐个添加组件 Stories

按分类顺序逐个添加：

- [ ] **Form 组**：Input, Select, Checkbox, Radio, Slider, NumberInput
- [ ] **Data Display 组**：ProgressBar, Loading, List, StatBar
- [ ] **Feedback 组**：Toast, Dialog（命令式 API 需用 `decorator` 挂载 `ToastHost` / `DialogHost`）
- [ ] **Layout 组**：Panel, Stack
- [ ] **Overlay 组**：ContextMenu

### Phase 3: FiveM 专用组件占位 + Polish

- [ ] 添加 `Numpad.stories.tsx`（占位，标注 `status: planned`）
- [ ] 添加 `CircleInput.stories.tsx`（占位，标注 `status: planned`）
- [ ] 确保所有 stories 有 `description` 和至少 2 个变体
- [ ] 验证 `pnpm -F workspace/framework-storybook storybook` 启动正常，热更新生效

---

## 开放问题

1. **Toast / Dialog 的命令式 API 如何展示**：它们不是声明式组件，需要在 story 里用 `useEffect` 触发 `toast.success(...)`，或者用 `decorator` 挂载 Host 组件。确认展示方式。
2. **FiveM 组件实现后再补全**：`Numpad` 和 `CircleInput` 目前是计划中的组件，stories 文件先占位，组件实现后再补全内容。
3. **`@reui/framework` 的 antd 依赖**：Storybook 需要能解析 antd v6，确认 `workspace/framework-storybook/package.json` 中 antd 版本与 workspace framework 一致。

---

## 验收标准

- [ ] `pnpm -F workspace/framework-storybook storybook` 可正常启动，所有组件可预览
- [ ] 每个组件至少有 1 个 Default story + 2 个变体 stories
- [ ] Controls 面板可交互调节 props（Storybook 原生功能）
- [ ] Docs addon 自动生成代码块，支持一键复制
- [ ] `ReUIProvider` decorator 生效，主题 tokens 正确应用
- [ ] 修改 `workspace/framework/src/` 源码后，Storybook 热更新生效
- [ ] `Numpad` 和 `CircleInput` 有占位 stories（标注 planned）

---

## 与旧版 RFC-008 的差异

| 项目 | 旧版（已废弃） | 新版 |
|------|----------------|------|
| 技术方案 | 自定义 Vite 静态站 | Storybook 7 |
| 交互性 | 无交互控件（纯展示） | 保留 Controls 交互 |
| 部署 | 可 build 静态站部署 | 仅本地 `storybook` 命令 |
| 代码复制 | 自写 CodeBlock 组件 | Storybook Docs addon 原生支持 |
| 路由 | 单页锚点或 react-router | Storybook 自带 sidebar 导航 |
