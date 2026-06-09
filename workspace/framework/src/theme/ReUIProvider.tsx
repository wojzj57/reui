/**
 * ReUIProvider —— 组件库唯一根 Provider（RFC-004 §3.2）。
 *
 * 用 antd ConfigProvider + CSS 变量注入 取代早期草案的自研 ThemeProvider。
 * 职责：
 *   1. 合并默认主题与用户传入的局部覆盖（deepMerge）；
 *   2. 将 DesignTokens 注入为 DOM 上的 CSS Custom Properties；
 *   3. 将 DesignTokens 投影为 antd ThemeConfig，交由 ConfigProvider 消费。
 *
 * 运行时动态切换：antd v6 cssVar:true 模式 + 自研组件引用 var(--reui-*)，
 * 主题切换仅更新 DOM 上的 CSS 变量，不触发组件树 React 重渲染。
 */

import { ConfigProvider } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { defaultTheme } from './default';
import { deepMerge, tokensToCssVars } from './theme-utils';
import { tokensToAntdTheme } from './antd-theme';
import type { DesignTokens } from './tokens';
import type { DeepPartial } from './theme-utils';

export interface ReUIProviderProps {
  /** 局部主题覆盖（深层合并到 defaultTheme） */
  theme?: DeepPartial<DesignTokens>;
  /** 子组件 */
  children: ReactNode;
}

/**
 * 组件库的根 Provider，应在应用入口处包裹一次。
 *
 * @example
 * import { ReUIProvider } from '@reui/framework';
 *
 * ReactDOM.createRoot(document.getElementById('root')!).render(
 *   <ReUIProvider theme={{ colors: { accent: '#ff0' } }}>
 *     <App />
 *   </ReUIProvider>
 * );
 */
export function ReUIProvider({ theme, children }: ReUIProviderProps) {
  // 合并默认主题与用户覆盖（深合并，undefined 跳过）
  const tokens = useMemo(
    () => deepMerge(defaultTheme, theme ?? {}),
    [theme],
  );

  // DesignTokens → CSS Custom Properties 对象（注入到 DOM style）
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens]);

  // DesignTokens → antd ThemeConfig
  const antdTheme = useMemo(() => tokensToAntdTheme(tokens), [tokens]);

  return (
    <ConfigProvider theme={antdTheme} prefixCls="reui-antd">
      {/* CSS Custom Properties 注入点；所有自研组件通过 var(--reui-*) 引用 */}
      <div style={cssVars} className="reui-theme-root">
        {children}
      </div>
    </ConfigProvider>
  );
}
