# Framework UI 库设计文档 (@reui/framework)

## 1. 概述

`@reui/framework` 是 ReUI 的 React UI 组件库，为子页面提供统一的视觉风格和常用游戏 UI 组件。子页面可以自由选择是否使用此库。

**设计目标：**
- 游戏 UI 风格（深色主题为主，适配 FiveM 场景）
- 与 `@reui/core` 深度集成（组件内置数据绑定）
- 高性能（适合 CEF 渲染环境）
- 可定制主题

## 2. 包结构

```
workspace/framework/
├── src/
│   ├── index.ts                # 统一导出
│   ├── theme/
│   │   ├── default.ts          # 默认主题（深色）
│   │   ├── tokens.ts           # Design tokens
│   │   └── ThemeProvider.tsx    # 主题 Provider
│   ├── styles/
│   │   ├── _variables.scss     # SCSS 变量 & CSS Custom Properties 映射
│   │   ├── _mixins.scss        # 常用 mixins
│   │   └── global.scss         # 全局基础样式
│   ├── components/
│   │   ├── layout/             # 布局组件
│   │   ├── data-display/       # 数据展示
│   │   ├── input/              # 输入组件
│   │   ├── feedback/           # 反馈组件
│   │   └── game/              # 游戏专用组件
│   ├── hooks/                  # 与 @reui/core 集成的 Hooks
│   └── utils/
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 3. Design Tokens

```typescript
// theme/tokens.ts
export const tokens = {
  colors: {
    // 背景层级
    bgPrimary: 'rgba(15, 15, 20, 0.95)',
    bgSecondary: 'rgba(25, 25, 35, 0.90)',
    bgTertiary: 'rgba(35, 35, 50, 0.85)',
    bgHover: 'rgba(255, 255, 255, 0.05)',
    bgActive: 'rgba(255, 255, 255, 0.08)',

    // 文字
    textPrimary: 'rgba(255, 255, 255, 0.95)',
    textSecondary: 'rgba(255, 255, 255, 0.65)',
    textMuted: 'rgba(255, 255, 255, 0.40)',

    // 主题色
    accent: '#4F9EF8',
    accentHover: '#6BB0FF',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    info: '#60A5FA',

    // 边框
    border: 'rgba(255, 255, 255, 0.10)',
    borderHover: 'rgba(255, 255, 255, 0.20)',
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
  },

  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },

  fontSize: {
    xs: '11px',
    sm: '12px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    xxl: '24px',
  },

  animation: {
    fast: '150ms',
    normal: '250ms',
    slow: '400ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },

  shadow: {
    sm: '0 2px 4px rgba(0, 0, 0, 0.3)',
    md: '0 4px 12px rgba(0, 0, 0, 0.4)',
    lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
  },
};
```

## 4. 组件清单

### 4.1 Layout（布局）

| 组件 | 说明 |
|------|------|
| `Panel` | 面板容器，带标题栏、可拖拽、可缩放 |
| `Stack` | Flex 布局辅助（垂直/水平） |
| `Grid` | 网格布局（适用于背包等） |
| `Divider` | 分割线 |
| `ScrollArea` | 自定义滚动条容器 |

### 4.2 Data Display（数据展示）

| 组件 | 说明 |
|------|------|
| `Text` | 文字排版 |
| `Badge` | 徽标 |
| `Avatar` | 头像 |
| `ProgressBar` | 进度条（血量、经验等） |
| `StatBar` | 状态条组（多个横向指标） |
| `Tooltip` | 工具提示 |
| `List` | 列表（虚拟滚动支持） |
| `Table` | 表格 |

### 4.3 Input（输入）

| 组件 | 说明 |
|------|------|
| `Button` | 按钮 |
| `Input` | 文本输入框 |
| `Select` | 下拉选择 |
| `Checkbox` | 复选框 |
| `Slider` | 滑块 |
| `Switch` | 开关 |
| `NumberInput` | 数字输入 |

### 4.4 Feedback（反馈）

| 组件 | 说明 |
|------|------|
| `Toast` | 轻提示 |
| `Dialog` | 对话框 |
| `ContextMenu` | 右键菜单 |
| `Loading` | 加载指示器 |

### 4.5 Game（游戏专用）

| 组件 | 说明 |
|------|------|
| `Hotbar` | 快捷栏（可拖拽 slot） |
| `ItemSlot` | 物品格子（支持拖拽、数量、耐久） |
| `Minimap` | 小地图容器 |
| `Notification` | 游戏内通知（支持队列） |
| `RadialMenu` | 环形菜单 |
| `KeyHint` | 按键提示（如 "按 E 交互"） |

### 4.6 Overlay 层多实例管理

当多个 Overlay 类型的插件同时请求显示时，Runtime 使用**栈式管理**：

| 行为 | 说明 |
|------|------|
| 入栈 | 新 Overlay 显示时压入栈顶，覆盖前一个（但前一个不销毁） |
| 出栈 | 关闭栈顶 Overlay 后，自动恢复前一个 Overlay 的可见性 |
| 全部关闭 | ESC 键或游戏事件可一次性清空整个 Overlay 栈 |
| 互斥可选 | 插件可在 manifest 中声明 `display.modal: true`，此时新 Overlay 会先关闭栈内所有现有 Overlay |

> **注意：** `display.modal` 字段已在 plugin.json 的 `DisplaySchema` 中定义（见 `06-plugin-specification.md` §3.1），仅对 `overlay` 层插件生效。

Framework 中的 `Dialog` 组件默认通过 `plugin:show` 请求显示，Runtime Layer System 负责栈管理逻辑。

## 5. 核心组件示例

### 5.1 Panel

```tsx
interface PanelProps {
  title?: string;
  icon?: ReactNode;
  closable?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  width?: string | number;
  height?: string | number;
  onClose?: () => void;
  children: ReactNode;
}

// 使用
<Panel title="背包" closable draggable width={400} onClose={handleClose}>
  <Grid columns={5} gap="sm">
    {items.map(item => <ItemSlot key={item.id} item={item} />)}
  </Grid>
</Panel>
```

### 5.2 ProgressBar

```tsx
interface ProgressBarProps {
  value: number;           // 0-100
  max?: number;
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  animated?: boolean;      // 变化时动画
  children?: ReactNode;    // 自定义 label 内容
}

// 使用
<ProgressBar value={health} max={100} color="success" size="md" showLabel />
<ProgressBar value={exp} max={expToLevel} color="accent" animated>
  {exp}/{expToLevel} XP
</ProgressBar>
```

### 5.3 ItemSlot

```tsx
interface ItemSlotProps {
  item?: {
    id: string;
    icon: string;
    name: string;
    quantity?: number;
    durability?: number;     // 0-100
    rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  };
  size?: 'sm' | 'md' | 'lg';
  draggable?: boolean;
  droppable?: boolean;
  onDrop?: (fromSlot: string, toSlot: string) => void;
  onClick?: () => void;
  onRightClick?: () => void;
}

// 使用
<ItemSlot
  item={weapon}
  size="md"
  draggable
  onRightClick={() => showContextMenu(weapon)}
/>
```

> **限制说明：** 拖拽功能仅在**同一 iframe 内**生效。由于浏览器安全限制，HTML5 Drag & Drop 和自定义拖拽无法跨越 iframe 边界。因此，物品只能在同一插件内的 slot 之间拖动。如需跨插件传递数据（如从背包拖到快捷栏），应通过 `@reui/core` 的事件系统实现（发送事件通知目标插件，而非真正的视觉拖拽）。

## 6. Hooks — @reui/core 集成

提供与 `@reui/core` 深度集成的 React Hooks，让组件自动响应游戏状态。

```typescript
// hooks/useNuiEvent.ts
/**
 * 订阅 NUI 游戏事件（命令式），自动在组件卸载时清理
 */
export function useNuiEvent(eventName: string, handler: (data: any) => void): void;

// hooks/useNuiState.ts
/**
 * 订阅 NUI 事件，触发时更新 state（声明式）
 * 返回最新的事件数据，适合驱动 UI 渲染
 */
export function useNuiState<T>(eventName: string, initialValue: T): T;

// hooks/useEvent.ts
/**
 * 订阅 EventBus 事件（插件间通讯）
 */
export function useEvent(eventName: string, handler: (data: any) => void): void;

// hooks/usePermission.ts
/**
 * 查询权限，返回响应式结果
 */
export function usePermission(permission: string): {
  allowed: boolean;
  loading: boolean;
};

// hooks/useUser.ts
/**
 * 获取当前用户信息，自动响应变化
 */
export function useUser(): {
  user: UserInfo | null;
  loading: boolean;
};

// hooks/useVisibility.ts
/**
 * 监听当前插件的可见性状态
 */
export function useVisibility(): boolean;
```

### 使用示例

```tsx
import { useNuiState, usePermission, useVisibility } from '@reui/framework';

function InventoryPanel() {
  const items = useNuiState<Item[]>('inventory:update', []);
  const { allowed: canDrop } = usePermission('inventory.drop');
  const visible = useVisibility();

  if (!visible) return null;

  return (
    <Panel title="背包">
      <Grid columns={5}>
        {items.map(item => (
          <ItemSlot
            key={item.id}
            item={item}
            draggable={canDrop}
          />
        ))}
      </Grid>
    </Panel>
  );
}
```

## 7. 主题系统

```tsx
// ThemeProvider.tsx
interface ThemeProviderProps {
  theme?: Partial<Theme>;    // 覆盖默认主题
  children: ReactNode;
}

export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  // 深层合并默认主题和自定义主题，注入为 CSS Custom Properties
  const merged = deepMerge(defaultTheme, theme ?? {});
  const cssVars = themeToCssVars(merged);
  return <div style={cssVars}>{children}</div>;
}

/**
 * 合并策略（deepMerge）：
 * - 对象：递归合并（保留未覆盖的 key）
 * - 数组/原始值：用户值完整覆盖默认值
 *
 * 示例：
 *   theme={{ colors: { accent: '#FF6B6B' } }}
 *   → colors.accent 被覆盖为 '#FF6B6B'
 *   → colors.textPrimary 等其他字段保留默认值
 */
function deepMerge<T extends object>(base: T, overrides: Partial<T>): T;

// 使用
import { ThemeProvider } from '@reui/framework';

function App() {
  return (
    <ThemeProvider theme={{ colors: { accent: '#FF6B6B' } }}>
      <MyPlugin />
    </ThemeProvider>
  );
}
```

主题通过 CSS Custom Properties 实现，允许运行时动态切换：

```css
:root {
  --reui-color-accent: #4F9EF8;
  --reui-color-bg-primary: rgba(15, 15, 20, 0.95);
  --reui-spacing-md: 12px;
  --reui-radius-md: 8px;
  /* ... */
}
```

## 8. 打包配置

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ReUIFramework',
      formats: ['es'],
      fileName: 'reui-framework',
    },
    rollupOptions: {
      external: ['react', 'react-dom', '@reui/core'],
    },
  },
});
```

- React 和 @reui/core 作为 peerDependency，不打包进来
- 仅输出 ESM（面向现代构建工具）
- 组件支持 tree-shaking

## 9. 可访问性（Accessibility）

虽然游戏 UI 主要面向鼠标/手柄交互，但基础键盘可访问性仍有必要（如聊天输入时需要 Tab 切换焦点）：

| 策略 | 说明 |
|------|------|
| 焦点管理 | Dialog/Overlay 打开时自动 focus 第一个可交互元素，关闭时恢复焦点 |
| 键盘导航 | 所有 Input/Button/Select 支持 Tab 切换，Dialog 支持 ESC 关闭 |
| ARIA 属性 | Dialog 使用 `role="dialog"` + `aria-modal`；Toast 使用 `role="alert"` + `aria-live="polite"` |
| 焦点陷阱 | 模态 Dialog/Overlay 内部实现焦点陷阱（Tab 不跳出模态范围） |
| 可见焦点环 | 键盘导航时显示 focus ring（`:focus-visible`），鼠标交互时隐藏 |

```scss
/* 通用焦点样式 */
.reui-focus-ring:focus-visible {
  outline: 2px solid var(--reui-color-accent);
  outline-offset: 2px;
}
```

> **注意：** 游戏 UI 不需要完整的 WAI-ARIA 合规，但上述基础能力确保在 FiveM CEF 环境中键盘操作流畅。

## 10. 性能考量

| 策略 | 说明 |
|------|------|
| CSS Variables | 主题切换无需重新渲染组件树 |
| 虚拟滚动 | List/Table 大量数据使用虚拟化 |
| 最小化重渲染 | Hooks 内部使用 useRef + 按需 setState |
| SCSS → 静态 CSS | 构建时编译为普通 CSS，零运行时样式开销 |
| 动画使用 transform/opacity | GPU 加速，不触发 layout |
| 懒加载 | 对话框等低频组件按需 import |

## 11. 样式方案

使用 **SCSS + CSS Custom Properties**，构建时编译为普通 CSS（带 `.reui-` 前缀避免命名冲突）：

```
components/
├── Button/
│   ├── Button.tsx
│   ├── Button.scss          # SCSS 源文件
│   └── index.ts
```

### 11.1 SCSS 变量映射

```scss
// styles/_variables.scss
// SCSS 变量作为开发时的静态值参考和 fallback
$reui-color-accent: #4F9EF8;
$reui-color-bg-primary: rgba(15, 15, 20, 0.95);
$reui-spacing-md: 12px;
$reui-radius-md: 8px;

// Mixins 引用 CSS Custom Properties（运行时可覆盖）
@mixin reui-theme-var($prop, $var-name, $fallback) {
  #{$prop}: var(--reui-#{$var-name}, $fallback);
}
```

### 11.2 组件样式示例

```scss
/* Button.scss */
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

.reui-button {
  padding: var(--reui-spacing-sm, 8px) var(--reui-spacing-md, 12px);
  border-radius: var(--reui-radius-md, 8px);
  background: var(--reui-color-accent, #{$reui-color-accent});
  color: var(--reui-color-text-primary, rgba(255, 255, 255, 0.95));
  font-size: var(--reui-font-size-md, 14px);
  transition: all var(--reui-animation-fast, 150ms) var(--reui-animation-easing, cubic-bezier(0.4, 0, 0.2, 1));
  border: none;
  cursor: pointer;

  &:hover {
    background: var(--reui-color-accent-hover, #6BB0FF);
  }

  &--variant-secondary {
    background: var(--reui-color-bg-secondary, rgba(25, 25, 35, 0.90));
    border: 1px solid var(--reui-color-border, rgba(255, 255, 255, 0.10));
  }

  &--size-sm {
    padding: var(--reui-spacing-xs, 4px) var(--reui-spacing-sm, 8px);
    font-size: var(--reui-font-size-sm, 12px);
  }

  &--size-lg {
    padding: var(--reui-spacing-md, 12px) var(--reui-spacing-lg, 16px);
    font-size: var(--reui-font-size-lg, 16px);
  }
}
```

### 11.3 命名约定

所有组件类名使用 `.reui-` 前缀 + BEM 风格命名：

```
.reui-{component}                    → 基础类
.reui-{component}--{modifier}        → 修饰符
.reui-{component}__{element}         → 子元素
.reui-{component}--{variant}         → 变体
```

示例：
```scss
.reui-panel { }
.reui-panel__header { }
.reui-panel__body { }
.reui-panel--draggable { }

.reui-item-slot { }
.reui-item-slot__icon { }
.reui-item-slot__quantity { }
.reui-item-slot--rarity-epic { }
```

### 11.4 构建输出

构建时 SCSS 编译为普通 CSS，不依赖运行时处理：

```typescript
// vite.config.ts
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "src/styles/variables" as *;`,
      },
    },
  },
  build: {
    // ...
  },
});
```

最终产物：
- `dist/reui-framework.css` — 编译后的普通 CSS，包含所有组件样式
- `dist/reui-framework.js` — ESM JS（组件逻辑）

消费方只需：
```typescript
import '@reui/framework/style.css';
import { Button, Panel } from '@reui/framework';
```

### 11.5 设计优势

| 策略 | 说明 |
|------|------|
| `.reui-` 前缀 | 避免与子页面已有样式冲突，无需 CSS Modules 的 hash 类名 |
| CSS Custom Properties | 运行时可动态覆盖主题，无需重编译 |
| SCSS 开发 | 变量、mixin、嵌套提升开发效率 |
| 编译为普通 CSS | 消费方无需配置 SCSS/CSS Modules 处理，开箱即用 |
| BEM 命名 | 结构清晰，可读性强，便于覆盖和调试 |
