# RFC-004: Phase 4 — Framework UI 组件库

| 字段       | 值                                      |
|------------|----------------------------------------|
| **编号**   | RFC-004                                |
| **标题**   | @reui/framework UI 组件库              |
| **状态**   | Draft                                  |
| **作者**   | ReUI Team                              |
| **创建日期** | 2026-05-27                           |
| **修订**   | 2026-06-07 — 技术方案调整为 **React + Ant Design v6 + valtio + SCSS**（见 §1.1）<br>2026-06-07 — **组件范围收敛为「迁移 `sample/ex-framework` 现有组件」**：净新游戏组件（ItemSlot/Hotbar/Minimap/RadialMenu/KeyHint/Notification）与无旧库来源的布局/标准控件移出本期，留待后续 RFC（见 §2.2、§3.3.3） |
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

### 1.1 技术方案：以 Ant Design v6 为基座

> **本节是相对早期草案的方向调整，务必先读。**

本 RFC 早期草案（及 `docs/reports/ex-framework-review-2026-06-06.md` 的「零 antd 自研」建议）主张**完全自研、不依赖第三方组件库**。经评估，决定调整方向，采用如下技术栈：

| 维度 | 方案 | 理由 |
|------|------|------|
| UI 基座 | **React + Ant Design v6** | 标准控件（按钮/输入/下拉/弹窗/表格等）直接复用 antd 的成熟实现与可访问性，避免重复造轮子；游戏专用组件在其上自研。 |
| 状态管理 | **valtio** | proxy 响应式 + `useSnapshot` 细粒度订阅；天然适配命令式 API（Toast/Dialog）与跨 frame 共享状态。 |
| 样式 | **SCSS + CSS Custom Properties** | 编译时 SCSS 提升 DX，运行时 CSS 变量驱动主题；叠加 antd v6 的 `cssVar` 主题模式。 |

**取舍说明：** 旧库 `sample/ex-framework`（React + antd `6.3.2` + valtio `2.3` + sass）已在实践中验证这套栈可行，问题集中在**工程质量、安全约定与具体 bug**，而非技术选型本身。因此本 RFC：

- **采纳** antd v6 / valtio / SCSS 作为基座（与 review 报告「零 antd」建议**有意不同**）；
- **保留并落实** review 报告列出的**全部修复项**（bug、安全约定、业务解耦、`strict:true`、无 import 期副作用等，见 §附录 C）。

换言之：组件库 = **antd v6 封装层（迁移自旧库的定制控件）** + **少量自研容器/布局（Panel / Stack / StatBar，均有旧库视觉或交互来源）**。

**本期范围（重要）：** 本 RFC 的交付物 = **迁移 `sample/ex-framework` 现有组件**（详见 §3.3 与附录 C 的迁移映射表）。凡旧库**没有对应来源**的组件——尤其是净新游戏组件（ItemSlot / Hotbar / Minimap / RadialMenu / KeyHint / Notification）与无定制需求的标准控件（Button / Switch / Tooltip / Avatar / Badge / Table）和布局辅助（Grid / Divider / ScrollArea）——**不在本期范围**，处理方式见 §3.3.3。

---

## 2. 目标与非目标

### 2.1 目标

| # | 目标 | 说明 |
|---|------|------|
| G1 | 统一视觉语言 | 基于 antd v6 主题（`ConfigProvider` + `darkAlgorithm`）与 Design Token，封装深色游戏风格 |
| G2 | 迁移旧库组件 | 将 `sample/ex-framework` 现有组件迁移为两类：**antd 封装层**（定制控件）+ **少量自研容器/布局**（Panel/Stack/StatBar）；净新组件留待后续 RFC |
| G3 | 主题可定制 | Design Token → antd `ThemeConfig` + CSS Custom Properties，支持运行时主题切换 |
| G4 | @reui/core 深度集成 | 提供 React Hooks 直接桥接事件、权限、用户信息等，状态底层基于 valtio |
| G5 | CEF 性能优化 | valtio `useSnapshot` 细粒度更新、antd 按需引入、虚拟滚动、GPU 动画、SCSS 静态编译 |
| G6 | 基础可访问性 | 复用 antd 内置 a11y；自研组件补焦点管理、键盘导航、ARIA |
| G7 | 按需引入友好 | antd 与本库均支持 ESM Tree-shaking，未使用组件不进最终产物 |

### 2.2 非目标

| # | 非目标 | 说明 |
|---|--------|------|
| N1 | 跨框架支持 | 本库仅支持 React；Vue/Svelte 用户请直接使用 `@reui/core`。**注意：本库以 antd v6 为基座，不再追求「零第三方组件库」；标准控件不重复实现 antd 已有能力。** |
| N2 | 跨 iframe 拖拽 | 浏览器安全限制下不可实现，跨插件数据传输通过事件系统 |
| N3 | 完整 WAI-ARIA 合规 | 游戏 UI 不需要完整无障碍合规，仅保障基础键盘可用性 |
| N4 | 服务端渲染(SSR) | FiveM CEF 为纯客户端环境 |
| N5 | 多主题预设(浅色等) | 首期仅提供深色主题，未来可扩展（antd 算法天然支持，可后续放开） |
| N6 | 净新游戏组件 | **ItemSlot / Hotbar / Minimap / RadialMenu / KeyHint / Notification** 在 `sample/ex-framework` 中**没有可参照来源**，本期不实现，留待后续 RFC（暂记为 RFC-007，见 §3.3.3） |
| N7 | 无定制的标准控件/布局 | **Button / Switch / Tooltip / Avatar / Badge / Table、Grid / Divider / ScrollArea** 旧库无定制来源；本期不再重复封装 antd，消费方在 `ReUIProvider` 主题下直接使用 antd（见 §3.3.3） |

---

## 3. 详细设计

### 3.1 Design Tokens 与主题系统

Design Tokens 是整个视觉体系的基础，定义了颜色、间距、圆角、字号、动画和阴影六大维度。Token 是**单一事实来源**，向下分别映射为 ① CSS Custom Properties（供自研组件与 SCSS 引用）、② antd `ThemeConfig.token`（供 antd 封装层使用）。

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

**① Token → CSS Custom Property 的映射规则：**

```
tokens.colors.bgPrimary   →  --reui-color-bg-primary
tokens.spacing.md         →  --reui-spacing-md
tokens.radius.lg          →  --reui-radius-lg
tokens.fontSize.sm        →  --reui-font-size-sm
tokens.animation.fast     →  --reui-animation-fast
tokens.shadow.md          →  --reui-shadow-md
```

转换函数将 camelCase 转为 kebab-case，并加上 `--reui-{category}-` 前缀（复用 `workspace/framework/src/theme/theme-utils.ts` 已有的 `camelToKebab` / `tokensToCssVars`）。

**② Token → antd `ThemeConfig` 的映射规则：**

将 Design Token 投影到 antd 的全局 token 与组件 token，使 antd 封装层与自研容器/布局层共享同一套主题来源：

```typescript
// workspace/framework/src/theme/antd-theme.ts
import type { ThemeConfig } from 'antd';
import { theme as antdTheme } from 'antd';
import type { DesignTokens } from './tokens';

export function tokensToAntdTheme(t: DesignTokens): ThemeConfig {
  return {
    // antd v6 cssVar 模式：token 注入为 CSS 变量，运行时切换不重渲染
    cssVar: true,
    hashed: false,
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: t.colors.accent,
      colorSuccess: t.colors.success,
      colorWarning: t.colors.warning,
      colorError: t.colors.danger,
      colorInfo: t.colors.info,
      colorBgContainer: t.colors.bgSecondary,
      colorBgElevated: t.colors.bgTertiary,
      colorBorder: t.colors.border,
      colorText: t.colors.textPrimary,
      colorTextSecondary: t.colors.textSecondary,
      borderRadius: parseInt(t.radius.md, 10),
      fontSize: parseInt(t.fontSize.md, 10),
      motionDurationMid: t.animation.normal,
    },
    // 必要时的组件级 override（参照旧 Framework/theme.ts 的做法，
    // 但用仓库已有的 deepMerge 取代 lodash combine）
    components: {
      Button: { /* ... */ },
      Modal: { /* ... */ },
    },
  };
}
```

> 旧库 `sample/ex-framework/src/Framework/theme.ts` 用 `lodash` 合并 antd `ThemeConfig`（dark/light + 组件 override）。本 RFC 沿用「token 驱动 antd 主题」的思路，但统一改用仓库已有的 `deepMerge`（`theme-utils.ts`），并删除旧库散落的硬编码颜色（`#2469f0` / `#1e1e1e`）。

### 3.2 主题系统：ReUIProvider

用 **antd `ConfigProvider` + CSS 变量注入** 取代早期草案的自研 `ThemeProvider`。`ReUIProvider` 是组件库的唯一根 Provider：

```tsx
// workspace/framework/src/theme/ReUIProvider.tsx
import { ConfigProvider } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { defaultTheme } from './default';
import { deepMerge, tokensToCssVars } from './theme-utils';
import { tokensToAntdTheme } from './antd-theme';
import type { DesignTokens, DeepPartial } from './tokens';

interface ReUIProviderProps {
  theme?: DeepPartial<DesignTokens>;
  children: ReactNode;
}

export function ReUIProvider({ theme, children }: ReUIProviderProps) {
  const tokens = useMemo(() => deepMerge(defaultTheme, theme ?? {}), [theme]);
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens]);
  const antdTheme = useMemo(() => tokensToAntdTheme(tokens), [tokens]);

  return (
    <ConfigProvider theme={antdTheme} prefixCls="reui-antd">
      <div style={cssVars} className="reui-theme-root">
        {children}
      </div>
    </ConfigProvider>
  );
}
```

**深层合并策略（deepMerge，复用 `theme-utils.ts`）：**

| 值类型 | 合并行为 | 示例 |
|--------|---------|------|
| 对象   | 递归合并，保留未覆盖的 key | `{ colors: { accent: '#FF0' } }` 仅覆盖 accent，其余颜色保留默认值 |
| 数组   | 用户值完整替换默认值 | `{ breakpoints: [768, 1024] }` 替换整个数组 |
| 原始值 | 用户值覆盖默认值 | `{ spacing: { md: '16px' } }` 覆盖 md 为 16px |
| undefined | 跳过，保留默认值 | 未传入的字段不受影响 |

**运行时动态切换：** antd v6 `cssVar: true` 模式 + 自研组件引用 `var(--reui-*)`，主题切换仅更新 DOM 上的 CSS 变量，不触发组件树 React 重渲染，浏览器自动应用新值。

### 3.3 组件清单与分类

**本期组件 = `sample/ex-framework` 现有组件的迁移结果。** 每个组件都能在旧库找到参照来源（视觉或交互），并标注需要落实的修复点。组件分两层：**A. 基于 antd v6 封装**（旧库定制控件 → 复用 antd 实现 + 统一主题 + 必要增强/修复）；**B. 少量自研容器/布局**（旧库有视觉或交互来源、antd 无对应物）。无旧库来源的组件见 §3.3.3（本期不做）。

#### A. 基于 antd v6 封装（迁移自旧库的定制控件）

| 组件 | antd 基座 | 旧库参照 | 封装/修复要点 |
|------|----------|---------|--------------|
| `Input` | `Input` | Input/Title | 行内可编辑模式吸收旧 Title，清理旧 `createRef` 死代码 |
| `Select` | `Select` | Input/Select、Input/SelectInput | **合并旧 SelectInput 多选模式**，修复 `onChange` 恒传 `value[1]` 的 bug |
| `Checkbox` | `Checkbox` | Input/Checkbox | 主题化；保留 indeterminate |
| `Radio` | `Radio.Group` | Input/Radio | 按钮组单选；修 typo 类名 `ExConpactSelector → ExCompactSelector` |
| `Slider` | `Slider` | Input/Slider | **吸收旧库双色范围条可视化**（亮点，见 §3.4.3）；主题化 |
| `NumberInput` | `InputNumber` | Input/Number | 加减按钮；**去掉硬编码 `#000`**，统一走 token |
| `Upload` | `Upload` | Input/Upload | **降优先级**（NUI 内上传场景少）；清理 `enablePaste` 死代码、补事件清理 |
| `List` | `List` + 虚拟滚动 | Item (ListItem) | 吸收 ListItem hover 删除交互；虚拟滚动见 §5 |
| `ProgressBar` | `Progress` | Progress | **吸收 number/loop 双模式**；修 typo `segmengts → segments`；loop 动画参数 token 化 |
| `Loading` | `Spin` | Content、Loading | 全屏/区域加载；**去掉硬编码 "CAEP" 品牌与中文文案**，文案可配置 |
| `Dialog` | `Modal` | Modal、Presence | 命令式 API（见 §3.4.4）；焦点陷阱/ESC/ARIA 复用 antd 并补强 |
| `Toast` | `message` / `notification` | Message | 命令式 API；**修复旧库 import 期 `throw`、挂载后才可用的竞态**（见 §3.4.5） |
| `ContextMenu` | `Dropdown` + `Menu` | Menu | 右键菜单、嵌套子菜单、快捷键提示（旧 Menu 仅包 antd，此处重写为右键场景） |

#### B. 自研容器/布局（旧库有视觉或交互来源）

| 组件 | 说明 | 旧库参照 | 核心特性 |
|------|------|---------|---------|
| `Panel` | 面板容器 | Content、Glass | 标题栏、可拖拽、可缩放、可关闭；吸收 Content 的 onInit/加载态与 Glass 玻璃拟物视觉（**参数化**原硬编码） |
| `Stack` | Flex 布局辅助 | styles/common.scss、Item | direction, gap, align, justify（吸收 Item 行/卡片排布） |
| `StatBar` | 状态条组 | Progress | 多个横向指标条（血量/饥饿/口渴），底层复用 ProgressBar |

> **可选样例（不进核心库）：** 旧库 `Navigation`（竖向图标导航）、`Input/Birth`（生日选择 + 算年龄）通用性一般，作为 `sample` 示例保留，不纳入核心组件清单。

#### 3.3.3 本期不迁移 / 留待后续

以下组件在 `sample/ex-framework` 中**没有可参照来源**，按 §2.2 N6/N7 移出本期：

| 类别 | 组件 | 处理 |
|------|------|------|
| **净新游戏组件** | `ItemSlot`、`Hotbar`、`Minimap`、`RadialMenu`、`KeyHint`、`Notification` | **留待后续 RFC**（暂记为 RFC-007 「游戏专用组件」）。本 RFC 不定义其 Props/实现，仅在此登记为后续候选 |
| **无定制标准控件** | `Button`、`Switch`、`Tooltip`、`Avatar`、`Badge`、`Table` | 旧库无定制需求；消费方在 `ReUIProvider` 主题下**直接使用 antd**，本期不再封装 |
| **无来源布局辅助** | `Grid`、`Divider`、`ScrollArea` | 同上直接用 antd / 原生；滚动条美化已由 `reui-scrollbar` mixin 提供（§4.1），不单独造组件 |

> 旧库中 **`Frame` / `Embed`（iframe 嵌网页）、`App`（死代码）、`Error`（空）、`theme.ts`（被新 theme 取代）** 均不迁移，理由见 §附录 C。

### 3.4 核心组件设计示例

#### 3.4.1 Panel（自研）

```tsx
interface PanelProps {
  title?: string;
  icon?: ReactNode;
  closable?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  glass?: boolean;                // 吸收旧 Glass 的玻璃拟物效果（参数化）
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

**玻璃拟物（glass）：** 吸收旧 `Framework/Glass`（SVG 滤镜 + backdrop-filter）的视觉，但将原先硬编码的模糊半径、透明度等参数化为 props/token。

#### 3.4.2 ProgressBar（封装 antd Progress）

```tsx
interface ProgressBarProps {
  value: number;                  // 当前值
  max?: number;                   // 最大值，默认 100
  mode?: 'number' | 'loop';       // 吸收旧 Progress 的双模式
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;            // 显示百分比/数值标签
  animated?: boolean;             // 值变化时的过渡动画
  segments?: number;              // 分段数（修旧库 typo segmengts）
  children?: ReactNode;           // 自定义 label 内容
}
```

**动画行为：** `animated` 为 true 时，bar 宽度变化使用 CSS transition（`width` + `animation.normal` 时长）。`mode: 'loop'` 为无限循环动画（不确定进度），动画参数取自 token（不再硬编码）。颜色可配置自动降级（如血量低于 25% 自动变红）。

#### 3.4.3 Slider（封装 antd Slider，吸收旧库双色范围条）

旧 `Framework/Input/Slider` 的亮点是**以中点为界、两侧异色的范围可视化**。迁移时保留这一交互，底层换为 antd `Slider`，硬编码颜色改走 token：

```tsx
interface SliderProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  range?: boolean;                 // 双滑块区间
  centered?: boolean;              // 吸收旧库「以中点为界双色」可视化
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  marks?: Record<number, ReactNode>;
  disabled?: boolean;
  onChange?: (value: number | [number, number]) => void;
}
```

**双色范围条：** `centered` 为 true 时，轨道以 `(min+max)/2` 为界，低于中点与高于中点用不同 token 颜色填充（旧库为硬编码色，迁移后取自 `--reui-color-*`）。常规模式下，已填充段用 `color` 指定色，未填充段用 `--reui-color-border`。

> 旧库 `Input/SelectInput` 的多选能力一并合入 `Select`（`mode="multiple"`），并**修复其 `onChange` 恒传 `value[1]` 的 bug**——多选时回传完整数组而非固定第二项。

#### 3.4.4 Dialog 命令式 API（valtio）

吸收旧 `Framework/Presence` 的 `open()/close()` 命令式设计，用 valtio store 驱动，挂载一次全局宿主即可在任意位置调用：

```tsx
import { dialog } from '@reui/framework';

// 任意逻辑位置（非组件内）即可调用
const ok = await dialog.confirm({
  title: '丢弃物品',
  content: '确定要丢弃该物品吗？',
  okText: '丢弃',
  danger: true,
});
if (ok) { /* ... */ }

const name = await dialog.prompt({ title: '重命名', label: '新名称' });
dialog.alert({ title: '提示', content: '操作完成' });
```

- 底层为 valtio proxy 的 Dialog 栈（FIFO，互斥可见），由 `<DialogHost />` 渲染（封装 antd `Modal`）。
- 焦点陷阱、ESC 关闭、`role="dialog"`/`aria-modal` 由 antd Modal 提供并补强（见 §3.6）。

#### 3.4.5 Toast 命令式 API（valtio）

吸收旧 `Framework/Message` 的命令式思路，**修复其 import 期 `throw`、挂载后才可用的竞态**——store 在模块加载时即就绪，渲染宿主缺失时静默入队，挂载后补放：

```tsx
import { toast } from '@reui/framework';

toast.success('保存成功');
toast.error('网络错误', { duration: 5000 });
const id = toast.loading('上传中…');
toast.dismiss(id);
```

- 底层为 valtio 的 Toast 队列（默认上限 5 条），`<ToastHost />` 渲染。
- 副作用全部置于 effect / 挂载后，模块 import 期**无副作用、不 throw**（见 §附录 C 风险项）。

### 3.5 Hooks 集成 @reui/core

所有 Hooks 在组件卸载时自动清理订阅，避免内存泄漏。涉及数据状态的 Hook 底层使用 valtio proxy + `useSnapshot`（见 §3.7），以获得细粒度更新。

#### useNuiEvent

```typescript
/**
 * 命令式订阅 NUI 游戏事件。
 * 适用于触发副作用（播放音效、写日志等）。
 */
function useNuiEvent(eventName: string, handler: (data: unknown) => void): void;
```

内部实现：通过 `@reui/core` 的 `nui.onGameEvent(eventName, handler)` 注册监听，`useEffect` cleanup 调用返回的 `Unsubscribe`。使用 `useRef` 存储最新 handler 引用，避免闭包过时问题。

#### useNuiState

```typescript
/**
 * 声明式订阅 NUI 事件，事件触发时自动更新 state。
 * 适用于驱动 UI 渲染的数据（如背包列表、血量）。
 */
function useNuiState<T>(eventName: string, initialValue: T): T;
```

内部实现：结合 valtio proxy + `useNuiEvent`，事件触发时更新 proxy，组件通过 `useSnapshot` 精确订阅。支持泛型类型推导。

#### useEvent

```typescript
/** 订阅 EventBus 事件（插件间通讯），底层 core event.on()。 */
function useEvent(eventName: string, handler: (data: unknown) => void): void;
```

#### usePermission

```typescript
/** 查询插件权限，返回响应式结果（初始 loading，查询完成后更新 allowed）。 */
function usePermission(permission: string): { allowed: boolean; loading: boolean };
```

#### useUser

```typescript
/** 获取当前用户信息，监听 auth 状态变化自动更新。 */
function useUser(): { user: UserInfo | null; loading: boolean };
```

#### useVisibility

```typescript
/**
 * 监听当前插件的可见性状态（Runtime 隐藏/显示 iframe 时自动更新）。
 * 可用于暂停渲染、停止轮询等优化。底层 core plugin.onVisibilityChange()。
 */
function useVisibility(): boolean;
```

**使用示例：**

```tsx
import { useNuiState, usePermission, useVisibility } from '@reui/framework';
import { Panel, Stack, List } from '@reui/framework';

function InventoryPanel() {
  const items = useNuiState<Item[]>('inventory:update', []);
  const { allowed: canDrop } = usePermission('inventory.drop');
  const visible = useVisibility();

  if (!visible) return null;

  return (
    <Panel title="背包" closable draggable>
      <Stack direction="vertical" gap="sm">
        <List
          items={items}
          renderItem={item => (
            <List.Item key={item.id} deletable={canDrop}>
              {item.name}
            </List.Item>
          )}
        />
      </Stack>
    </Panel>
  );
}
```

> 网格化的物品格子（`Grid` + `ItemSlot`）属净新游戏组件，留待后续 RFC（§3.3.3）。本期背包类场景先用 `List` / `Stack` 承载。

### 3.6 可访问性（Accessibility）

标准控件（Dialog/Select/Tooltip 等）的焦点管理、键盘导航、ARIA 由 **antd v6 内置能力** 提供；自研容器/布局组件按下表补强。

#### 焦点管理

| 场景 | 行为 |
|------|------|
| Dialog 打开 | antd Modal 自动 focus 首个可交互元素 |
| Dialog 关闭 | 恢复焦点到打开前的元素 |
| Tooltip 触发 | 键盘 focus 时显示，blur 时隐藏 |
| ContextMenu 打开 | focus 第一个菜单项 |

#### 键盘导航

| 按键 | 行为 |
|------|------|
| `Tab` / `Shift+Tab` | 在可交互元素间顺序/反向切换焦点 |
| `ESC` | 关闭当前 Dialog/ContextMenu/Select 下拉 |
| `Enter`/`Space` | 激活当前焦点元素 |
| `Arrow Keys` | 在 Select/List/ContextMenu 中导航选项 |

#### ARIA 属性

antd 组件自带相应 role/aria；自研组件需显式声明：

```tsx
// ProgressBar / StatBar
<div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>

// Toast（命令式反馈）
<div role="status" aria-live="polite" aria-atomic="true">

// ContextMenu
<div role="menu"> <div role="menuitem" aria-checked={selected}>
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

### 3.7 状态管理（valtio）

本库统一使用 **valtio** 管理组件内/跨组件状态，对齐旧库（TaskManager/SharedObject/Storage/Presence 均为 valtio）与新仓库选型。

#### 3.7.1 基本模式

```typescript
import { proxy, useSnapshot } from 'valtio';

const store = proxy({ count: 0, items: [] as Item[] });

function Counter() {
  const snap = useSnapshot(store);   // 仅订阅实际读取的字段，细粒度更新
  return <button onClick={() => store.count++}>{snap.count}</button>;
}
```

#### 3.7.2 命令式 API store（Toast / Dialog）

参照旧 `Presence`（命令式弹窗）/`Message`（单例 Toast）的 API 设计，重写为 valtio store + 全局宿主组件（`<ToastHost/>`、`<DialogHost/>`）。要点：

- **store 模块 import 期就绪、无副作用、不 throw**（修旧 `Message` 的 import 期异常）。
- 宿主未挂载时静默入队，挂载后补放。
- Dialog 栈互斥可见、Toast 队列上限可配。

#### 3.7.3 跨 frame 共享状态：`useSharedState`

重写旧 `Common/SharedObject`：

```typescript
function useSharedState<T extends object>(name: string, initial: T): T;
```

- 基于 **`@reui/core` 的 `event` 模块（EventBus）+ `reui:` 协议**同步，而非旧库直连 postMessage。
- **修复旧库缺陷**：① 用单调递增 origin 标识/版本号取代脆弱的「布尔防回环位」；② 正确处理 `delete` 操作（旧库未处理）；③ 不依赖旧 stub `EventManager`。

#### 3.7.4 本地持久化：`usePersistentState`

重写旧 `Common/Storage`：

```typescript
function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void];
```

- **修复旧库 bug**：save key 不再写死为 `"UserData"`，由参数 `key` 决定。
- valtio + `localStorage`，序列化失败/超限有降级处理。

#### 3.7.5 通用工具（吸收自旧库）

| 工具 | 来源 | 处理 |
|------|------|------|
| `TaskManager`（并发任务队列） | Common/TaskManager（`async.queue` + valtio 进度） | **吸收**；修 `removeTask` 的 `slice → splice`、abort 联动、去掉 1500ms 魔法延时 |
| `useInterval(cb, ms)` | Common/Utilis/Interval | 封装为 Hook |
| `createId()` | Common/Utilis/ExId | 改用 `crypto.randomUUID()`（避免 `Math.random()` 碰撞） |
| 防抖 | Common/Utilis/Debounce | **删除自研**，直接用 `lodash.debounce` |

---

## 4. 样式方案

### 4.1 SCSS + CSS Custom Properties + antd v6 主题

采用三层协作：

- **SCSS 层（编译时）：** 自研组件用变量、mixin、嵌套提升 DX，构建时编译为普通 CSS。
- **CSS Custom Properties 层（运行时）：** 自研组件引用 `var(--reui-*)`，`ReUIProvider` 修改 DOM style 实现动态主题。
- **antd 主题层：** antd 封装层经 `ConfigProvider` 的 `ThemeConfig`（`cssVar: true`）定制，与上面的 token 同源（§3.1 ②）。

参照旧 `sample/ex-framework/styles/_variable.scss` + `common.scss` 的工具类与变量组织，但**去除其硬编码颜色/尺寸**（`#2469f0`/`#1e1e1e`/`90vw`/`borderRadius:12` 等），统一走 token。

```scss
// styles/_variables.scss — SCSS 变量作为 fallback 与开发参考
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
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: var(--reui-color-border, rgba(255, 255, 255, 0.10));
    border-radius: var(--reui-radius-full, 9999px);
  }
}
```

### 4.2 命名约定

- **自研组件**：`.reui-` 前缀 + BEM（`.reui-{block}__{element}--{modifier}`）。
- **antd 封装层**：通过 `ConfigProvider` `prefixCls="reui-antd"` 隔离类名前缀，并以 `ThemeConfig` 定制，避免对宿主页面的 antd 产生样式串扰。

```scss
// 自研组件示例
.reui-panel { }
.reui-panel__header { }
.reui-panel--draggable { }
.reui-item-slot { }
.reui-item-slot__durability { }
.reui-item-slot--rarity-legendary { }
```

**命名规则：**
- Block 使用 kebab-case（如 `item-slot`）。
- Modifier 用 `--{category}-{value}`（如 `--variant-secondary`、`--size-lg`）；布尔 modifier 直接用名称（如 `--loading`、`--draggable`）。

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
      // antd / valtio 视情况 external 或打包；react 系列 external
      external: ['react', 'react-dom', '@reui/core', 'antd', 'valtio'],
      output: {
        preserveModules: true,  // 保持模块结构，支持 tree-shaking
        assetFileNames: 'style.css',
      },
    },
    cssCodeSplit: false,
  },
});
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
    ".": { "import": "./dist/reui-framework.js", "types": "./dist/types/index.d.ts" },
    "./style.css": "./dist/style.css"
  },
  "dependencies": {
    "antd": "^6.0.0",
    "valtio": "^2.0.0"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@reui/core": "workspace:*"
  },
  "devDependencies": {
    "sass": "^1.98.0"
  },
  "sideEffects": ["*.css", "*.scss"]
}
```

**消费方使用：**

```tsx
import '@reui/framework/style.css';                       // 引入样式（一次）
import { ReUIProvider, Panel, List, Slider } from '@reui/framework';
import { useNuiState, useVisibility, toast, dialog } from '@reui/framework';
```

---

## 5. 性能策略

| 策略 | 具体措施 | 预期效果 |
|------|---------|---------|
| valtio 细粒度订阅 | `useSnapshot` 仅订阅实际读取字段 | 避免无关状态变化导致的重渲染 |
| CSS Variables 主题切换 | antd `cssVar` + 自研 `var(--reui-*)`，切换仅更新 DOM style | 不触发组件树 React 重渲染 |
| 虚拟滚动 | List/Table 大数据启用 antd `virtual` / `rc-virtual-list`（默认阈值 50 条） | 大数据列表保持 60fps |
| antd 按需引入 | ESM Tree-shaking，仅打包用到的 antd 组件 | 控制最终产物体积 |
| SCSS 静态编译 | 构建时编译为普通 CSS，运行时零样式计算 | 无 CSS-in-JS 运行时开销 |
| GPU 动画 | 自研动画仅用 `transform` + `opacity` | 不触发 layout/paint |
| 懒加载 | ContextMenu/Dialog 等按需 `React.lazy()` | 减小初始 bundle |
| 事件委托 | 列表/网格内部使用事件委托 | 大量子元素不重复绑定 |
| `will-change` 提示 | 可拖拽元素添加 `will-change: transform` | 提前提升合成层 |
| `React.memo` | 数据展示组件默认 memo 包裹 | props 未变时跳过渲染 |

---

## 6. 测试计划

### 6.1 单元测试

| 测试对象 | 工具 | 覆盖内容 |
|---------|------|---------|
| Design Tokens | Vitest | token 值格式正确性 |
| deepMerge | Vitest | 对象递归合并、数组替换、undefined 跳过 |
| tokensToCssVars / tokensToAntdTheme | Vitest | camelCase→kebab 映射；antd token 投影正确 |
| valtio stores | Vitest | Toast 队列、Dialog 栈、useSharedState 同步与防回环、usePersistentState key 隔离 |
| 各 Hooks | Vitest + RTL | 订阅/取消订阅、状态更新、cleanup |
| 工具函数 | Vitest | TaskManager（splice/abort）、useInterval、createId、clamp、classNames |

### 6.2 组件测试

| 测试对象 | 工具 | 覆盖内容 |
|---------|------|---------|
| antd 封装层（Select/NumberInput/ProgressBar 等） | RTL | 透传、主题 prefixCls 生效、Select 多选 onChange 修复、ProgressBar segments |
| Slider | RTL | 双色范围条/centered 可视化、onChange 值正确 |
| Panel | RTL | 拖拽位移、缩放、关闭回调、glass、onInit/加载态 |
| Dialog（命令式） | RTL | 栈/互斥、焦点陷阱、ESC、ARIA |
| Toast（命令式） | RTL | 入队/补放、import 期无副作用、上限 |
| StatBar | RTL | 多指标条渲染、值/颜色降级 |
| ReUIProvider | RTL | CSS 变量注入、antd 主题应用、主题切换 |
| List（虚拟滚动） | RTL | 滚动后仅渲染可见项、overscan、hover 删除交互 |

### 6.3 集成测试

| 场景 | 工具 | 覆盖内容 |
|------|------|---------|
| Hooks + @reui/core mock | Vitest | 模拟 postMessage 通讯，验证 Hook 响应正确 |
| ReUIProvider + 组件 | RTL | 自定义主题正确应用到 antd 与自研组件 |
| 组件组合 | RTL | Panel > Stack > List 复合使用 |

### 6.4 视觉回归测试

| 工具 | 用途 |
|------|------|
| Storybook | 组件开发与文档，每个组件一组 stories |
| Chromatic / Percy（可选） | 截图对比，防止视觉回归 |

### 6.5 性能测试

| 场景 | 指标 |
|------|------|
| 100 项 List 渲染 | 首屏渲染 < 16ms (60fps) |
| 10000 条 List/Table 滚动 | 滚动帧率 > 55fps |
| 主题切换 | 无组件树 React 重渲染（仅 CSS 变量更新） |
| 按需引入 | 仅引入 Select 时，未用 antd/自研组件不进产物 |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] 所有 Design Token 定义完整，CSS Custom Property 与 antd `ThemeConfig` 映射均正确
- [ ] `ReUIProvider` 支持深层合并，自定义主题能局部覆盖（antd 层 + 自研层）
- [ ] antd 封装层与自研容器/布局组件均已实现，Props 接口完整且有 TypeScript 类型
- [ ] 六个 Hooks 功能正确，卸载时正确清理订阅
- [ ] Toast/Dialog 命令式 API 可用，**import 期无副作用、不 throw**
- [ ] `useSharedState`/`usePersistentState` 修复旧库缺陷（防回环、delete、key 隔离）
- [ ] 拖拽功能在同一 iframe 内正常工作

### 7.2 样式验收

- [ ] 自研组件使用 `.reui-` 前缀 + BEM；antd 层使用 `reui-antd` prefixCls 隔离
- [ ] SCSS 编译为普通 CSS，消费方无需额外 loader 配置
- [ ] CSS Custom Properties + antd cssVar 正确注入，主题切换即时生效
- [ ] 样式不泄漏到宿主页面（无全局标签选择器，antd 前缀隔离）
- [ ] 深色主题视觉符合游戏场景审美；无遗留硬编码颜色/品牌（"CAEP"）/中文文案

### 7.3 可访问性验收

- [ ] Dialog 打开时自动聚焦，关闭时恢复焦点，焦点陷阱正确
- [ ] 所有 interactive 元素支持 Tab 导航
- [ ] ESC 可关闭 Dialog / ContextMenu / Select
- [ ] 自研关键组件具备正确的 ARIA role 和属性
- [ ] `:focus-visible` 焦点环仅在键盘导航时显示

### 7.4 性能验收

- [ ] antd 按需引入有效：仅引入 Select 时，其他组件不在产物中
- [ ] List/Table 在 10000+ 项时不卡顿（虚拟滚动）
- [ ] Panel 拖拽/缩放保持 60fps
- [ ] 主题切换无可感知延迟（< 16ms），且无组件树重渲染
- [ ] 产物体积在合理范围（以 antd 基座为前提，按需引入后核心组件集 gzip 体积进入可接受区间；不再要求整库 < 50KB）

### 7.5 工程验收

- [ ] 所有组件/Hooks/stores 单元测试覆盖率 > 80%
- [ ] TypeScript **`strict: true`** 编译无错误（修旧库 `strict:false`）
- [ ] **模块 import 期无副作用**（副作用一律入 effect / 挂载后）
- [ ] **不引入安全倒退**：不使用通配 `postMessage('*')`、不明文存储 token（统一走 `@reui/core` 的 `reui:` 协议与 token 注入）
- [ ] Storybook stories 覆盖所有组件主要状态
- [ ] package.json 正确声明 dependencies(antd/valtio)、peerDependencies、exports、sideEffects
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

- Hooks（useNuiEvent / useEvent）底层依赖 postMessage 协议进行消息收发。
- 跨插件数据传输（替代跨 iframe 拖拽）、`useSharedState` 同步依赖 EventBus 的消息路由与 `reui:` 协议。

### 8.2 对 RFC-003 的依赖

- 所有 Hooks 通过 `@reui/core` 的模块 API（nui, event, auth, plugin）与 Runtime 通信。
- usePermission/useUser 依赖 Core SDK 的 auth 模块；useVisibility 依赖 plugin 模块的可见性管理。

### 8.3 与其他包的关系

| 依赖方 | 被依赖方 | 关系类型 | 说明 |
|--------|---------|---------|------|
| @reui/framework | @reui/core | peerDependency | Hooks 需要 Core SDK 的通信能力 |
| @reui/framework | react / react-dom | peerDependency | UI 组件使用 React 实现 |
| @reui/framework | **antd** | dependency | 标准控件基座（v6） |
| @reui/framework | **valtio** | dependency | 状态管理 |
| @reui/framework | **sass** | devDependency | SCSS 编译（产物为纯 CSS，消费方无需） |
| Plugin (子页面) | @reui/framework | 可选 dependency | 插件自行决定是否使用 |
| Plugin (子页面) | @reui/core | 必须 dependency | 所有插件必须引入 Core SDK |

### 8.4 开发顺序

1. **Phase 1** — Design Tokens + `tokensToAntdTheme` + `ReUIProvider` + valtio store 基建
2. **Phase 2** — antd 封装层定制控件（Input, Select, Checkbox, Radio, Slider, NumberInput, ProgressBar, Loading）
3. **Phase 3** — 反馈类命令式 API（Toast, Dialog）+ ContextMenu + List（含虚拟滚动）+ Upload（降优先级）
4. **Phase 4** — 自研容器/布局（Panel, Stack, StatBar）
5. **Phase 5** — Hooks 集成 + 跨 frame/持久化状态 + Storybook 文档
6. **Phase 6** — 性能优化 + 测试完善

> 净新游戏组件（ItemSlot/Hotbar/Minimap/RadialMenu/KeyHint/Notification）不在本开发序列内，留待后续 RFC（§3.3.3）。

---

## 附录 A：目录结构

```
workspace/framework/
├── src/
│   ├── index.ts                    # 统一导出
│   ├── theme/
│   │   ├── tokens.ts               # Design Tokens 类型与默认值
│   │   ├── default.ts              # 默认深色主题
│   │   ├── theme-utils.ts          # deepMerge, camelToKebab, tokensToCssVars（已存在）
│   │   ├── antd-theme.ts           # tokensToAntdTheme（token → antd ThemeConfig）
│   │   └── ReUIProvider.tsx        # ConfigProvider + CSS 变量注入
│   ├── stores/                     # valtio 状态
│   │   ├── toast.ts                # Toast 队列 store + 命令式 API
│   │   ├── dialog.ts               # Dialog 栈 store + 命令式 API
│   │   ├── shared-state.ts         # useSharedState（基于 core EventBus）
│   │   ├── persistent-state.ts     # usePersistentState
│   │   └── task-manager.ts         # 并发任务队列（吸收旧 TaskManager）
│   ├── styles/
│   │   ├── _variables.scss
│   │   ├── _mixins.scss
│   │   └── global.scss
│   ├── components/
│   │   ├── antd/                   # A. antd 封装层（迁移自旧库定制控件）
│   │   │   ├── Input/ Select/ Checkbox/ Radio/ Slider/ NumberInput/
│   │   │   ├── Upload/ List/ ProgressBar/ Loading/ ContextMenu/
│   │   │   └── feedback/ DialogHost/ ToastHost/
│   │   └── layout/                 # B. 自研容器/布局
│   │       └── Panel/ Stack/ StatBar/
│   │   # 净新游戏组件（ItemSlot/Hotbar/Minimap/RadialMenu/KeyHint/
│   │   # Notification）留待后续 RFC，本期不创建目录
│   ├── hooks/
│   │   ├── useNuiEvent.ts  useNuiState.ts  useEvent.ts
│   │   ├── usePermission.ts  useUser.ts  useVisibility.ts
│   │   └── useInterval.ts
│   └── utils/
│       ├── classNames.ts  clamp.ts  createId.ts   # createId → crypto.randomUUID()
├── package.json
├── tsconfig.json                   # strict: true
├── vite.config.ts
└── .storybook/
```

## 附录 B：与社区方案对比

| 维度 | @reui/framework | Ant Design (原生) | Radix UI | shadcn/ui |
|------|----------------|-------------------|----------|-----------|
| 定位 | 游戏 UI (FiveM)，antd 游戏化封装 | 企业后台 | 通用 headless | 通用 copy-paste |
| 基座 | **antd v6 + 迁移定制层** | antd v6 | 无（headless） | Radix + Tailwind |
| 默认主题 | 深色 + 半透明（darkAlgorithm + token） | 浅色 | 无 | 中性 |
| 样式方案 | SCSS + CSS Vars + antd cssVar | CSS-in-JS / cssVar | 无 | Tailwind |
| 状态管理 | valtio | — | — | — |
| 游戏组件 | 规划中（ItemSlot/Hotbar/RadialMenu，后续 RFC） | 无 | 无 | 无 |
| @reui/core 集成 | 内置 Hooks | 无 | 无 | 无 |
| CEF 优化 | 是 | 否 | 否 | 否 |

## 附录 C：ex-framework 迁移映射表

> 来源：`sample/ex-framework`；评估见 `docs/reports/ex-framework-review-2026-06-06.md`。
> **迁移清单的权威来源为 `docs/plans/framework_refractor.md`；本附录与之保持一致，§3.3 的本期组件即由此表推导。**
> 结论列：`否`=不迁移／`概念`=仅吸收设计思想重写／`重构`=交互保留实现重写／`吸收`=可较直接复用（重构后）。

### C.1 Common 基础设施层

| 旧组件 | 文件 | 结论 | 处理 / 修复点 |
|--------|------|------|--------------|
| BaseManager | Common/BaseManager.ts | 否 | core `event`+`client` 取代；**依赖 `q`（未声明）**、**`"*"` origin** 均不带入 |
| EventManager | Common/EventManager.ts | 否 | 不可运行骨架；core `event.ts` 取代 |
| Network | Common/Network.ts | 否 | core `http.ts`+`auth.ts` 取代；**不明文存 token**，仅借鉴 401 清 token 思路 |
| WsManager | Common/WsManager.ts | 否 | 空实现；core `ws.ts` 取代 |
| **TaskManager** | Common/TaskManager.ts | **吸收** | 落 framework `stores/task-manager.ts`；修 `removeTask` 的 **`slice→splice`**、abort 联动、去 1500ms 魔法延时 |
| SharedObject | Common/SharedObject.ts | 概念→重构 | 重写为 `useSharedState`（core EventBus + `reui:`）；修**布尔防回环位脆弱**、**delete 未处理** |
| Storage | Common/Storage.ts | 重构 | 重写为 `usePersistentState`；修 **save key 写死 `"UserData"`** |
| Utilis/ExId | Common/Utilis/ExId.ts | 重构 | 改 `crypto.randomUUID()`（避免 `Math.random()` 碰撞） |
| Utilis/Interval | Common/Utilis/Interval.ts | 吸收 | 封装为 `useInterval` |
| Utilis/Debounce | Common/Utilis/Debounce.ts | 否 | 删除自研，用 `lodash.debounce` |
| ClickUp / Config | Common/ClickUp.ts、Config.ts | 否 | 产品业务专用 |

### C.2 Framework UI 层

| 旧组件 | 文件 | 对应新组件 | 结论 | 处理 / 修复点 |
|--------|------|-----------|------|--------------|
| App | Framework/App | — | 否 | 整文件注释死代码 |
| Error | Framework/Error | — | 否 | 空文件 |
| Content | Framework/Content | Panel/Loading | 重构 | 保留 onInit+加载态，修 useEffect 依赖，去 framer-motion |
| Frame / Embed | Framework/Frame、Embed | — | 否 | 与新 Runtime（iframe 宿主）职责冲突 |
| Glass | Framework/Glass | Panel(glass) | 概念 | 视觉吸收进 Panel，硬编码参数化 |
| theme.ts | Framework/theme.ts | theme/antd-theme.ts | 否→借鉴 | 思路保留，`lodash combine` → 仓库 `deepMerge`，去硬编码色 |
| Input/Checkbox | Framework/Input/Checkbox | Checkbox | 重构 | 封装 antd，主题化 |
| Input/Number | Framework/Input/Number | NumberInput | 重构 | **去硬编码 `#000`** |
| Input/Select | Framework/Input/Select | Select | 重构 | 封装 antd Select |
| Input/SelectInput | Framework/Input/SelectInput | Select(多选) | 否→合并 | **修 onChange 恒传 `value[1]` bug**，并入 Select 多选 |
| Input/Slider | Framework/Input/Slider | Slider | 重构 | **吸收双色范围条** |
| Input/Title | Framework/Input/Title | Input(行内编辑) | 重构 | 清理未用 `createRef` |
| Input/Radio | Framework/Input/Radio | Radio | 重构 | **修 typo `ExConpactSelector→ExCompactSelector`** |
| Input/Upload | Framework/Input/Upload | Upload | 重构(降优先级) | NUI 上传场景少；清理 `enablePaste` 死代码、补事件清理 |
| Input/Birth | Framework/Input/Birth | — | 否 | 业务专用（2010 截断、算年龄） |
| Item | Framework/Item | List/Stack | 重构 | 吸收 ListItem hover 删除交互 |
| Loading | Framework/Loading | Loading | 重构 | **去硬编码 "CAEP" 与中文文案** |
| Navigation | Framework/Navigation | —（sample） | 否 | 通用性一般，作 sample 示例保留；其环形交互思路记入后续 RadialMenu（RFC-007），不进本期核心库 |
| Menu | Framework/Menu | ContextMenu | 否 | 仅包 antd 价值低；自研 ContextMenu（基于 Dropdown） |
| Message | Framework/Message | Toast | 概念→重构 | **修 import 期 `throw`/挂载后才可用竞态**，命令式 API 思路保留 |
| Modal | Framework/Modal | Dialog | 概念→重构 | 焦点陷阱/ESC/ARIA（antd Modal 提供并补强） |
| Presence | Framework/Presence | Dialog(命令式) | 重构 | 吸收 `open()/close()` 命令式 API 设计 |
| Progress | Framework/Progress | ProgressBar/StatBar | 重构 | **修 typo `segmengts→segments`**，loop 动画参数 token 化 |

### C.3 declare/ 领域类型

| 类型集 | 文件 | 结论 |
|--------|------|------|
| ExUser / ExFile / ExInterview | declare/*.d.ts | 否（业务专用）；框架级共享类型应放 `workspace/interface` |

### C.4 安全与工程红线（不可倒退）

- **不复制** 通配 `postMessage(data, "*")`（旧 BaseManager.ts:161）——统一走 core 的 `reui:` 前缀 + origin 校验。
- **不复制** token 明文存 localStorage、无刷新（旧 Network.ts:47）。
- **不带入** `Frame`/`Embed`（与 Runtime 的 iframe 宿主职责冲突）。
- **消除** 一切 import 期副作用（旧 Message `throw`、Network 读 `import.meta.env`）——副作用入 effect。
- `tsconfig` 由旧库 `strict:false` 升级为 **`strict:true`**；补齐 vitest 测试与可访问性。
