# RFC-004: Phase 4 — Framework UI 组件库

| 字段       | 值                                      |
|------------|----------------------------------------|
| **编号**   | RFC-004                                |
| **标题**   | @reui/framework UI 组件库              |
| **状态**   | Draft                                  |
| **作者**   | ReUI Team                              |
| **创建日期** | 2026-05-27                           |
| **依赖**   | RFC-001 (Communication Protocol), RFC-003 (Runtime Services + Core SDK) |

---

## 1. 背景与动机

ReUI 架构中，Runtime 提供核心基础设施（事件总线、WebSocket、HTTP、鉴权），`@reui/core` 为子页面封装了与 Runtime 通信的 TypeScript API。然而，各子插件在开发 UI 时仍面临以下痛点：

1. **视觉不统一** — 每个插件独立实现 UI，样式风格各异，整体游戏界面缺乏一致性。
2. **重复造轮子** — 背包物品格子、血条、快捷栏等高频游戏 UI 组件被反复实现。
3. **主题难统一** — 没有统一的 Design Token 体系，更换主题色需要逐插件修改。
4. **性能隐患** — 各插件自行实现虚拟滚动、拖拽等功能，质量参差不齐。
5. **核心集成断层** — `@reui/core` 的事件订阅、权限查询等能力需要开发者手动编写 Hook 胶水代码。

`@reui/framework` 旨在提供一套**可选的** React 组件库和配套 Hooks，解决上述问题。插件开发者可以自由选择是否引入此库——它不是强制依赖，而是提高开发效率和视觉一致性的加速器。

### 为什么是可选的？

- 部分插件可能使用 Vue、Svelte 或纯 HTML，不应强制 React。
- 部分插件已有成熟 UI 方案，无需迁移。
- 保持 `@reui/core` 作为唯一的强制依赖层，降低准入门槛。

---

## 2. 目标与非目标

### 2.1 目标

| # | 目标 | 说明 |
|---|------|------|
| G1 | 统一视觉语言 | 提供深色游戏风格的 Design Token 和组件库 |
| G2 | 高频组件覆盖 | 涵盖布局、数据展示、输入、反馈、游戏专用五大类 |
| G3 | 主题可定制 | ThemeProvider + CSS Custom Properties 支持运行时主题切换 |
| G4 | @reui/core 深度集成 | 提供 React Hooks 直接桥接事件、权限、用户信息等 |
| G5 | CEF 性能优化 | 虚拟滚动、GPU 动画、最小化重渲染、SCSS 静态编译 |
| G6 | 基础可访问性 | 焦点管理、键盘导航、ARIA 属性 |
| G7 | Tree-shaking 友好 | 未使用的组件不会打包进最终产物 |

### 2.2 非目标

| # | 非目标 | 说明 |
|---|--------|------|
| N1 | 跨框架支持 | 本库仅支持 React；Vue/Svelte 用户请直接使用 `@reui/core` |
| N2 | 跨 iframe 拖拽 | 浏览器安全限制下不可实现，跨插件数据传输通过事件系统 |
| N3 | 完整 WAI-ARIA 合规 | 游戏 UI 不需要完整无障碍合规，仅保障基础键盘可用性 |
| N4 | 服务端渲染(SSR) | FiveM CEF 为纯客户端环境 |
| N5 | 多主题预设(浅色等) | 首期仅提供深色主题，未来可扩展 |

---

## 3. 详细设计

### 3.1 Design Tokens 与主题系统

Design Tokens 是整个视觉体系的基础，定义了颜色、间距、圆角、字号、动画和阴影六大维度。

```typescript
// workspace/framework/src/theme/tokens.ts
export interface DesignTokens {
  colors: {
    // 背景层级（从深到浅，用于面板嵌套层次）
    bgPrimary: string;      // rgba(15, 15, 20, 0.95) — 最底层
    bgSecondary: string;    // rgba(25, 25, 35, 0.90) — 次级面板
    bgTertiary: string;     // rgba(35, 35, 50, 0.85) — 三级区域
    bgHover: string;        // rgba(255, 255, 255, 0.05) — 悬停态
    bgActive: string;       // rgba(255, 255, 255, 0.08) — 激活态

    // 文字层级
    textPrimary: string;    // rgba(255, 255, 255, 0.95) — 主文本
    textSecondary: string;  // rgba(255, 255, 255, 0.65) — 辅助文本
    textMuted: string;      // rgba(255, 255, 255, 0.40) — 弱化文本

    // 功能色
    accent: string;         // #4F9EF8 — 主强调色
    accentHover: string;    // #6BB0FF — 强调色悬停
    success: string;        // #4ADE80 — 成功/生命值
    warning: string;        // #FBBF24 — 警告/耐久
    danger: string;         // #F87171 — 危险/错误
    info: string;           // #60A5FA — 信息

    // 边框
    border: string;         // rgba(255, 255, 255, 0.10) — 默认边框
    borderHover: string;    // rgba(255, 255, 255, 0.20) — 悬停边框
  };

  spacing: {
    xs: string;   // 4px
    sm: string;   // 8px
    md: string;   // 12px
    lg: string;   // 16px
    xl: string;   // 24px
    xxl: string;  // 32px
  };

  radius: {
    sm: string;   // 4px
    md: string;   // 8px
    lg: string;   // 12px
    full: string; // 9999px
  };

  fontSize: {
    xs: string;   // 11px
    sm: string;   // 12px
    md: string;   // 14px
    lg: string;   // 16px
    xl: string;   // 20px
    xxl: string;  // 24px
  };

  animation: {
    fast: string;    // 150ms
    normal: string;  // 250ms
    slow: string;    // 400ms
    easing: string;  // cubic-bezier(0.4, 0, 0.2, 1)
  };

  shadow: {
    sm: string;  // 0 2px 4px rgba(0, 0, 0, 0.3)
    md: string;  // 0 4px 12px rgba(0, 0, 0, 0.4)
    lg: string;  // 0 8px 24px rgba(0, 0, 0, 0.5)
  };
}
```

**Token 到 CSS Custom Property 的映射规则：**

```
tokens.colors.bgPrimary   →  --reui-color-bg-primary
tokens.spacing.md         →  --reui-spacing-md
tokens.radius.lg          →  --reui-radius-lg
tokens.fontSize.sm        →  --reui-font-size-sm
tokens.animation.fast     →  --reui-animation-fast
tokens.shadow.md          →  --reui-shadow-md
```

转换函数将 camelCase 转为 kebab-case，并加上 `--reui-{category}-` 前缀。

### 3.2 ThemeProvider（深层合并策略）

```tsx
// workspace/framework/src/theme/ThemeProvider.tsx
import { createContext, useContext, useMemo, ReactNode } from 'react';
import { defaultTheme } from './default';
import { DesignTokens } from './tokens';

interface ThemeContextValue {
  tokens: DesignTokens;
  setTheme: (overrides: DeepPartial<DesignTokens>) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  theme?: DeepPartial<DesignTokens>;
  children: ReactNode;
}

export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  const merged = useMemo(
    () => deepMerge(defaultTheme, theme ?? {}),
    [theme]
  );

  const cssVars = useMemo(() => tokensToCssVars(merged), [merged]);

  return (
    <ThemeContext.Provider value={{ tokens: merged, setTheme: () => {} }}>
      <div style={cssVars} className="reui-theme-root">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

**深层合并策略（deepMerge）：**

| 值类型 | 合并行为 | 示例 |
|--------|---------|------|
| 对象   | 递归合并，保留未覆盖的 key | `{ colors: { accent: '#FF0' } }` 仅覆盖 accent，其余颜色保留默认值 |
| 数组   | 用户值完整替换默认值 | `{ breakpoints: [768, 1024] }` 替换整个数组 |
| 原始值 | 用户值覆盖默认值 | `{ spacing: { md: '16px' } }` 覆盖 md 为 16px |
| undefined | 跳过，保留默认值 | 未传入的字段不受影响 |

**运行时动态切换：** 由于主题通过 CSS Custom Properties 注入，`ThemeProvider` 更新 `theme` prop 时，仅更新 DOM 上的 style 属性，不触发子组件 React 重渲染。组件内部直接引用 `var(--reui-*)` 变量，浏览器自动应用新值。

### 3.3 组件清单与分类

#### Layout（布局）

| 组件 | 说明 | 核心特性 |
|------|------|---------|
| `Panel` | 面板容器 | 标题栏、可拖拽、可缩放、可关闭 |
| `Stack` | Flex 布局辅助 | direction, gap, align, justify |
| `Grid` | 网格布局 | columns, rows, gap（适合背包格子） |
| `Divider` | 分割线 | horizontal/vertical, 自定义颜色 |
| `ScrollArea` | 自定义滚动条容器 | 美化滚动条、自动隐藏 |

#### Data Display（数据展示）

| 组件 | 说明 | 核心特性 |
|------|------|---------|
| `Text` | 文字排版 | size, weight, color, truncate |
| `Badge` | 徽标 | variant, color, 数字/文字 |
| `Avatar` | 头像 | src, fallback, size, online 状态 |
| `ProgressBar` | 进度条 | value/max, 动画, 自定义颜色和 label |
| `StatBar` | 状态条组 | 多个横向指标条（血量/饥饿/口渴） |
| `Tooltip` | 工具提示 | placement, delay, content |
| `List` | 列表 | 虚拟滚动支持大量数据 |
| `Table` | 表格 | 固定列、排序、虚拟化 |

#### Input（输入）

| 组件 | 说明 | 核心特性 |
|------|------|---------|
| `Button` | 按钮 | variant, size, icon, loading |
| `Input` | 文本输入框 | placeholder, prefix/suffix, validation |
| `Select` | 下拉选择 | 搜索、多选、分组 |
| `Checkbox` | 复选框 | indeterminate, label |
| `Slider` | 滑块 | min/max/step, 范围选择 |
| `Switch` | 开关 | size, label |
| `NumberInput` | 数字输入 | min/max/step, 加减按钮 |

#### Feedback（反馈）

| 组件 | 说明 | 核心特性 |
|------|------|---------|
| `Toast` | 轻提示 | duration, position, type |
| `Dialog` | 对话框 | modal, 焦点陷阱, ESC 关闭 |
| `ContextMenu` | 右键菜单 | 嵌套子菜单, 快捷键提示 |
| `Loading` | 加载指示器 | spinner/skeleton/dots |

#### Game（游戏专用）

| 组件 | 说明 | 核心特性 |
|------|------|---------|
| `Hotbar` | 快捷栏 | 可拖拽 slot, 按键绑定显示 |
| `ItemSlot` | 物品格子 | 拖拽/放置, 数量, 耐久条, 稀有度边框色 |
| `Minimap` | 小地图容器 | 定位、缩放、标记层 |
| `Notification` | 游戏内通知 | 队列管理, 自动消失, 堆叠 |
| `RadialMenu` | 环形菜单 | 扇区划分, 鼠标/手柄方向选择 |
| `KeyHint` | 按键提示 | 渲染 "按 E 交互" 风格的提示 |

### 3.4 核心组件设计示例

#### 3.4.1 Panel

```tsx
interface PanelProps {
  title?: string;
  icon?: ReactNode;
  closable?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  width?: string | number;
  height?: string | number;
  minWidth?: number;
  minHeight?: number;
  defaultPosition?: { x: number; y: number };
  onClose?: () => void;
  onResize?: (width: number, height: number) => void;
  className?: string;
  children: ReactNode;
}
```

**拖拽实现：** 使用 `pointerdown` + `pointermove` + `pointerup` 事件（非 HTML5 Drag API），通过 `transform: translate(x, y)` 实现位置移动，确保 GPU 加速且不触发 layout。

**缩放实现：** 边角和边缘添加 resize handle，拖拽时更新 width/height 样式，配合 `minWidth`/`minHeight` 限制最小尺寸。

#### 3.4.2 ProgressBar

```tsx
interface ProgressBarProps {
  value: number;                  // 当前值
  max?: number;                   // 最大值，默认 100
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;            // 显示百分比/数值标签
  animated?: boolean;             // 值变化时的过渡动画
  segmented?: number;             // 分段数（适合血量/盾牌）
  children?: ReactNode;           // 自定义 label 内容
}
```

**动画行为：** 当 `animated` 为 true 时，内部 bar 的宽度变化使用 CSS transition（`width` 属性 + `animation.normal` 时长）。颜色变化可选配置自动降级（如血量低于 25% 自动变红）。

#### 3.4.3 ItemSlot

```tsx
interface ItemSlotProps {
  item?: {
    id: string;
    icon: string;               // 图标 URL 或 sprite name
    name: string;
    quantity?: number;           // 堆叠数量
    durability?: number;         // 0-100 耐久度
    rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    metadata?: Record<string, unknown>;
  };
  size?: 'sm' | 'md' | 'lg';
  draggable?: boolean;
  droppable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onDragStart?: (item: ItemData) => void;
  onDrop?: (fromSlotId: string, toSlotId: string) => void;
  onClick?: (item: ItemData) => void;
  onRightClick?: (item: ItemData, event: MouseEvent) => void;
}
```

**稀有度视觉：** 不同 rarity 通过 border-color 和微弱的内发光（box-shadow inset）区分：
- common: `--reui-color-border` (默认)
- uncommon: `#4ADE80`
- rare: `#60A5FA`
- epic: `#A78BFA`
- legendary: `#FBBF24` + glow 发光效果

**拖拽限制：** 拖拽仅在同一 iframe 内生效（浏览器安全限制）。跨插件的物品转移必须通过 `@reui/core` 事件系统（`event.emit('item:transfer', { from, to, item })`），由目标插件处理 UI 更新。

### 3.5 Hooks 集成 @reui/core

所有 Hooks 在组件卸载时自动清理订阅，避免内存泄漏。

#### useNuiEvent

```typescript
/**
 * 命令式订阅 NUI 游戏事件。
 * 适用于触发副作用（播放音效、写日志等）。
 */
function useNuiEvent(eventName: string, handler: (data: unknown) => void): void;
```

内部实现：通过 `@reui/core` 的 `nui.on(eventName, handler)` 注册监听，`useEffect` cleanup 调用 `nui.off()`。使用 `useRef` 存储最新 handler 引用，避免闭包过时问题。

#### useNuiState

```typescript
/**
 * 声明式订阅 NUI 事件，事件触发时自动更新 state。
 * 适用于驱动 UI 渲染的数据（如背包列表、血量）。
 */
function useNuiState<T>(eventName: string, initialValue: T): T;
```

内部实现：结合 `useState` 和 `useNuiEvent`，事件触发时调用 `setState`。支持泛型类型推导。

#### useEvent

```typescript
/**
 * 订阅 EventBus 事件（插件间通讯）。
 */
function useEvent(eventName: string, handler: (data: unknown) => void): void;
```

#### usePermission

```typescript
/**
 * 查询插件权限，返回响应式结果。
 * 初始为 loading 状态，查询完成后更新 allowed。
 */
function usePermission(permission: string): {
  allowed: boolean;
  loading: boolean;
};
```

#### useUser

```typescript
/**
 * 获取当前用户信息。
 * 监听 auth 状态变化自动更新。
 */
function useUser(): {
  user: UserInfo | null;
  loading: boolean;
};
```

#### useVisibility

```typescript
/**
 * 监听当前插件的可见性状态。
 * 当 Runtime 隐藏/显示插件 iframe 时自动更新。
 * 可用于暂停渲染、停止轮询等优化。
 */
function useVisibility(): boolean;
```

**使用示例：**

```tsx
import { useNuiState, usePermission, useVisibility } from '@reui/framework';
import { Panel, Grid, ItemSlot } from '@reui/framework';

function InventoryPanel() {
  const items = useNuiState<Item[]>('inventory:update', []);
  const { allowed: canDrop } = usePermission('inventory.drop');
  const visible = useVisibility();

  if (!visible) return null;

  return (
    <Panel title="背包" closable draggable>
      <Grid columns={5} gap="sm">
        {items.map(item => (
          <ItemSlot key={item.id} item={item} draggable={canDrop} />
        ))}
      </Grid>
    </Panel>
  );
}
```

### 3.6 可访问性（Accessibility）

虽然游戏 UI 主要面向鼠标交互，但在 FiveM CEF 环境中键盘操作仍有实际需求（如聊天框焦点切换）。

#### 焦点管理

| 场景 | 行为 |
|------|------|
| Dialog 打开 | 自动 focus 第一个可交互元素（按钮/输入框） |
| Dialog 关闭 | 恢复焦点到打开前的元素 |
| Tooltip 触发 | 键盘 focus 时显示，blur 时隐藏 |
| ContextMenu 打开 | focus 第一个菜单项 |

#### 键盘导航

| 按键 | 行为 |
|------|------|
| `Tab` | 在可交互元素间顺序切换焦点 |
| `Shift+Tab` | 反向切换焦点 |
| `ESC` | 关闭当前 Dialog/ContextMenu/Select 下拉 |
| `Enter`/`Space` | 激活当前焦点元素（按钮点击、选项选中） |
| `Arrow Keys` | 在 RadialMenu/Select/List 中导航选项 |

#### ARIA 属性

```tsx
// Dialog
<div role="dialog" aria-modal="true" aria-labelledby={titleId}>

// Toast
<div role="alert" aria-live="polite" aria-atomic="true">

// Button (loading state)
<button aria-busy="true" aria-disabled="true">

// ProgressBar
<div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>

// Tooltip
<div role="tooltip" id={tooltipId}>
<button aria-describedby={tooltipId}>
```

#### 焦点陷阱

模态 Dialog 内部实现焦点陷阱（Tab 循环）：焦点在模态内第一个和最后一个可交互元素之间循环，不跳出模态范围。

```typescript
function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const focusable = containerRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    first?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active]);
}
```

#### 焦点环样式

```scss
.reui-focus-ring:focus-visible {
  outline: 2px solid var(--reui-color-accent);
  outline-offset: 2px;
}

// 鼠标交互时不显示焦点环
.reui-focus-ring:focus:not(:focus-visible) {
  outline: none;
}
```

---

## 4. 样式方案

### 4.1 SCSS + CSS Custom Properties

采用 **SCSS 开发 + CSS Custom Properties 运行时** 的双层架构：

- **SCSS 层（编译时）：** 利用变量、mixin、嵌套、函数等提升开发效率，构建时编译为普通 CSS。
- **CSS Custom Properties 层（运行时）：** 组件引用 `var(--reui-*)` 变量，ThemeProvider 通过修改 DOM style 实现动态主题切换。

```scss
// styles/_variables.scss
// SCSS 变量作为 fallback 值和开发时参考
$reui-color-accent: #4F9EF8;
$reui-color-bg-primary: rgba(15, 15, 20, 0.95);
$reui-spacing-md: 12px;
$reui-radius-md: 8px;

// styles/_mixins.scss
@mixin reui-transition($props...) {
  transition-property: $props;
  transition-duration: var(--reui-animation-fast, 150ms);
  transition-timing-function: var(--reui-animation-easing, cubic-bezier(0.4, 0, 0.2, 1));
}

@mixin reui-scrollbar {
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--reui-color-border, rgba(255, 255, 255, 0.10));
    border-radius: var(--reui-radius-full, 9999px);
  }
}
```

### 4.2 BEM 命名约定

所有组件类名使用 `.reui-` 前缀 + BEM 风格：

```
.reui-{block}                     → 组件基础类
.reui-{block}__{element}          → 组件子元素
.reui-{block}--{modifier}         → 修饰符 (状态/变体)
```

**命名示例：**

```scss
// Panel
.reui-panel { }
.reui-panel__header { }
.reui-panel__title { }
.reui-panel__body { }
.reui-panel__resize-handle { }
.reui-panel--draggable { }
.reui-panel--resizable { }

// Button
.reui-button { }
.reui-button__icon { }
.reui-button--variant-secondary { }
.reui-button--variant-ghost { }
.reui-button--size-sm { }
.reui-button--size-lg { }
.reui-button--loading { }

// ItemSlot
.reui-item-slot { }
.reui-item-slot__icon { }
.reui-item-slot__quantity { }
.reui-item-slot__durability { }
.reui-item-slot--rarity-epic { }
.reui-item-slot--rarity-legendary { }
.reui-item-slot--selected { }
.reui-item-slot--dragging { }
```

**命名规则：**
- Block 名称使用 kebab-case（如 `item-slot`，不是 `itemSlot`）
- Modifier 使用 `--{category}-{value}` 格式（如 `--variant-secondary`、`--size-lg`）
- 布尔 modifier 直接使用名称（如 `--loading`、`--draggable`）

### 4.3 构建输出

```typescript
// workspace/framework/vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "src/styles/variables" as *; @use "src/styles/mixins" as *;`,
      },
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ReUIFramework',
      formats: ['es'],
      fileName: 'reui-framework',
    },
    rollupOptions: {
      external: ['react', 'react-dom', '@reui/core'],
      output: {
        preserveModules: true,  // 保持模块结构，支持 tree-shaking
        assetFileNames: 'style.css',
      },
    },
    cssCodeSplit: false,  // 合并为单一 CSS 文件
  },
});
```

**最终产物：**

```
dist/
├── reui-framework.js     # ESM 模块（组件逻辑）
├── style.css             # 编译后的完整 CSS
└── types/                # TypeScript 声明文件
    └── index.d.ts
```

**消费方使用：**

```tsx
// 引入样式（一次）
import '@reui/framework/style.css';

// 按需引入组件
import { Button, Panel, ItemSlot } from '@reui/framework';
import { useNuiState, useVisibility } from '@reui/framework';
```

**package.json 关键字段：**

```json
{
  "name": "@reui/framework",
  "type": "module",
  "main": "./dist/reui-framework.js",
  "module": "./dist/reui-framework.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/reui-framework.js",
      "types": "./dist/types/index.d.ts"
    },
    "./style.css": "./dist/style.css"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@reui/core": "workspace:*"
  },
  "sideEffects": ["*.css", "*.scss"]
}
```

---

## 5. 性能策略

| 策略 | 具体措施 | 预期效果 |
|------|---------|---------|
| CSS Variables 主题切换 | 切换主题仅更新 DOM style 属性 | 不触发 React 重渲染 |
| 虚拟滚动 | List/Table 组件对超过阈值（默认 50 条）的列表启用虚拟化 | 大数据列表保持 60fps |
| 最小化重渲染 | Hooks 内部使用 `useRef` 存储回调，仅数据变化时 `setState` | 避免父组件重渲染导致子组件级联更新 |
| SCSS 静态编译 | 构建时编译为普通 CSS，运行时零样式计算 | 无 CSS-in-JS 运行时开销 |
| GPU 动画 | 所有动画仅使用 `transform` + `opacity` | 不触发 layout/paint，由合成器处理 |
| 懒加载 | Dialog/ContextMenu/RadialMenu 按需 `React.lazy()` 导入 | 减小初始 bundle 大小 |
| 事件委托 | 列表/网格内部使用事件委托 | 大量子元素不重复绑定事件 |
| `will-change` 提示 | 可拖拽元素添加 `will-change: transform` | 提前提升合成层 |
| `React.memo` | 数据展示组件默认使用 memo 包裹 | props 未变时跳过渲染 |

**虚拟滚动实现要点：**

```tsx
// 核心参数
interface VirtualScrollConfig {
  itemHeight: number;          // 固定行高模式
  estimateItemHeight?: number; // 动态行高模式（预估值）
  overscan?: number;           // 预渲染行数（默认 5）
  containerHeight: number;     // 容器高度
}
```

使用 `IntersectionObserver` 或 scroll 事件 + `requestAnimationFrame` 计算可见范围，仅渲染可见区域 ± overscan 的元素。

---

## 6. 测试计划

### 6.1 单元测试

| 测试对象 | 工具 | 覆盖内容 |
|---------|------|---------|
| Design Tokens | Vitest | 验证 token 值格式正确性 |
| deepMerge 函数 | Vitest | 对象递归合并、数组替换、undefined 跳过 |
| tokensToCssVars 转换 | Vitest | camelCase → kebab-case 映射正确 |
| 各 Hooks | Vitest + React Testing Library | 订阅/取消订阅、状态更新、cleanup |
| 工具函数 | Vitest | clamp, classNames, formatNumber 等 |

### 6.2 组件测试

| 测试对象 | 工具 | 覆盖内容 |
|---------|------|---------|
| Button | React Testing Library | 各 variant 渲染、click 事件、disabled/loading 状态 |
| Panel | React Testing Library | 拖拽位移、缩放、关闭回调 |
| Dialog | React Testing Library | 打开/关闭、焦点陷阱、ESC 关闭、ARIA 属性 |
| ItemSlot | React Testing Library | 拖拽开始/结束、右键菜单、稀有度样式 |
| ProgressBar | React Testing Library | value 变化、颜色映射、label 显示 |
| ThemeProvider | React Testing Library | CSS 变量注入、主题切换 |
| List (虚拟滚动) | React Testing Library | 滚动后仅渲染可见项、overscan 正确 |

### 6.3 集成测试

| 场景 | 工具 | 覆盖内容 |
|------|------|---------|
| Hooks + @reui/core mock | Vitest | 模拟 postMessage 通讯，验证 Hook 响应正确 |
| ThemeProvider + 组件 | React Testing Library | 验证自定义主题正确应用到子组件 |
| 组件组合 | React Testing Library | Panel > Grid > ItemSlot 复合使用 |

### 6.4 视觉回归测试

| 工具 | 用途 |
|------|------|
| Storybook | 组件开发和文档，每个组件对应一组 stories |
| Chromatic / Percy (可选) | 截图对比，防止视觉回归 |

### 6.5 性能测试

| 场景 | 指标 |
|------|------|
| 100 个 ItemSlot 渲染 | 首屏渲染 < 16ms (60fps) |
| 10000 条 List 滚动 | 滚动帧率 > 55fps |
| 主题切换 | 无 React 重渲染（仅 CSS 变量更新） |
| Bundle Size | 完整库 < 50KB gzipped (JS+CSS) |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] 所有 Design Token 定义完整，CSS Custom Property 映射正确
- [ ] ThemeProvider 支持深层合并，自定义主题能局部覆盖
- [ ] 所有五大分类组件（Layout / Data Display / Input / Feedback / Game）已实现
- [ ] 每个组件的 Props 接口完整且有 TypeScript 类型定义
- [ ] 六个 Hooks（useNuiEvent / useNuiState / useEvent / usePermission / useUser / useVisibility）功能正确
- [ ] Hooks 在组件卸载时正确清理订阅
- [ ] 拖拽功能在同一 iframe 内正常工作

### 7.2 样式验收

- [ ] 所有组件使用 `.reui-` 前缀 + BEM 命名
- [ ] SCSS 编译为普通 CSS，消费方无需额外 loader 配置
- [ ] CSS Custom Properties 正确注入，主题切换即时生效
- [ ] 样式不泄漏到宿主页面（无全局标签选择器）
- [ ] 深色主题视觉符合游戏场景审美

### 7.3 可访问性验收

- [ ] Dialog 打开时自动聚焦，关闭时恢复焦点
- [ ] 焦点陷阱在模态 Dialog 中正确工作
- [ ] 所有 interactive 元素支持 Tab 导航
- [ ] ESC 键可关闭 Dialog / ContextMenu / Select
- [ ] 关键组件具备正确的 ARIA role 和属性
- [ ] `:focus-visible` 焦点环仅在键盘导航时显示

### 7.4 性能验收

- [ ] 构建产物：JS < 40KB gzipped, CSS < 15KB gzipped
- [ ] List/Table 组件在 10000+ 项时不卡顿（虚拟滚动）
- [ ] Panel 拖拽/缩放保持 60fps
- [ ] 主题切换无可感知延迟（< 16ms）
- [ ] Tree-shaking 有效：仅引入 Button 时，其他组件不在产物中

### 7.5 工程验收

- [ ] 所有组件和 Hooks 的单元测试覆盖率 > 80%
- [ ] TypeScript 严格模式编译无错误
- [ ] Storybook stories 覆盖所有组件的主要状态
- [ ] package.json 正确声明 peerDependencies、exports、sideEffects
- [ ] 与 `@reui/core` 集成端到端测试通过

---

## 8. 依赖关系

```
RFC-001 (Communication Protocol)
    ↓
RFC-003 (Runtime Services + Core SDK)
    ↓
RFC-004 (Framework UI Library)  ← 本文档
```

### 8.1 对 RFC-001 的依赖

- Hooks（useNuiEvent / useEvent）底层依赖 postMessage 协议进行消息收发
- 跨插件数据传输（替代跨 iframe 拖拽）依赖 EventBus 的消息路由

### 8.2 对 RFC-003 的依赖

- 所有 Hooks 通过 `@reui/core` 的模块 API（nui, event, auth）与 Runtime 通信
- usePermission 依赖 Core SDK 的权限查询接口
- useUser 依赖 Core SDK 的 auth 模块
- useVisibility 依赖 Runtime 的插件可见性管理

### 8.3 与其他包的关系

| 依赖方 | 被依赖方 | 关系类型 | 说明 |
|--------|---------|---------|------|
| @reui/framework | @reui/core | peerDependency | Hooks 需要 Core SDK 的通信能力 |
| @reui/framework | react | peerDependency | UI 组件使用 React 实现 |
| @reui/framework | react-dom | peerDependency | DOM 渲染 |
| Plugin (子页面) | @reui/framework | 可选 dependency | 插件自行决定是否使用 |
| Plugin (子页面) | @reui/core | 必须 dependency | 所有插件必须引入 Core SDK |

### 8.4 开发顺序

1. **Phase 1** — Design Tokens + ThemeProvider + deepMerge 工具
2. **Phase 2** — 基础组件（Button, Input, Text, Stack, Grid）
3. **Phase 3** — 复合组件（Panel, Dialog, List, Table）
4. **Phase 4** — 游戏专用组件（ItemSlot, Hotbar, RadialMenu）
5. **Phase 5** — Hooks 集成 + Storybook 文档
6. **Phase 6** — 性能优化 + 测试完善

---

## 附录 A：目录结构

```
workspace/framework/
├── src/
│   ├── index.ts                    # 统一导出
│   ├── theme/
│   │   ├── tokens.ts               # Design Tokens 类型定义和默认值
│   │   ├── default.ts              # 默认深色主题
│   │   ├── ThemeProvider.tsx        # 主题 Provider 组件
│   │   └── utils.ts                # deepMerge, tokensToCssVars
│   ├── styles/
│   │   ├── _variables.scss         # SCSS 变量 & fallback
│   │   ├── _mixins.scss            # 常用 mixins
│   │   └── global.scss             # Reset & 基础全局样式
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Panel/
│   │   │   ├── Stack/
│   │   │   ├── Grid/
│   │   │   ├── Divider/
│   │   │   └── ScrollArea/
│   │   ├── data-display/
│   │   │   ├── Text/
│   │   │   ├── Badge/
│   │   │   ├── Avatar/
│   │   │   ├── ProgressBar/
│   │   │   ├── StatBar/
│   │   │   ├── Tooltip/
│   │   │   ├── List/
│   │   │   └── Table/
│   │   ├── input/
│   │   │   ├── Button/
│   │   │   ├── Input/
│   │   │   ├── Select/
│   │   │   ├── Checkbox/
│   │   │   ├── Slider/
│   │   │   ├── Switch/
│   │   │   └── NumberInput/
│   │   ├── feedback/
│   │   │   ├── Toast/
│   │   │   ├── Dialog/
│   │   │   ├── ContextMenu/
│   │   │   └── Loading/
│   │   └── game/
│   │       ├── Hotbar/
│   │       ├── ItemSlot/
│   │       ├── Minimap/
│   │       ├── Notification/
│   │       ├── RadialMenu/
│   │       └── KeyHint/
│   ├── hooks/
│   │   ├── useNuiEvent.ts
│   │   ├── useNuiState.ts
│   │   ├── useEvent.ts
│   │   ├── usePermission.ts
│   │   ├── useUser.ts
│   │   └── useVisibility.ts
│   └── utils/
│       ├── classNames.ts           # 类名拼接工具
│       ├── clamp.ts                # 数值限制
│       └── deepMerge.ts            # 深层合并
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .storybook/                     # Storybook 配置
```

## 附录 B：与社区方案对比

| 维度 | @reui/framework | Radix UI | shadcn/ui | Ant Design |
|------|----------------|----------|-----------|------------|
| 定位 | 游戏 UI (FiveM) | 通用 headless | 通用 copy-paste | 企业后台 |
| 默认主题 | 深色 + 半透明 | 无（headless） | 中性 | 浅色 |
| 样式方案 | SCSS + CSS Vars | CSS-in-JS / 无 | Tailwind | CSS-in-JS |
| 游戏组件 | 内置 (ItemSlot 等) | 无 | 无 | 无 |
| @reui/core 集成 | 内置 Hooks | 无 | 无 | 无 |
| Bundle 大小 | < 50KB gz | 极小 | 0 (copy) | 大 |
| CEF 优化 | 是 | 否 | 否 | 否 |
