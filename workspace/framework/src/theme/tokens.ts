/**
 * Design Tokens 类型与默认值（RFC-004 §3.1）。
 *
 * 设计意图：
 *   - 把所有视觉常量集中在此处，避免组件硬编码 px / hex；
 *   - 支持运行时通过 ThemeProvider 部分覆盖（deepMerge）；
 *   - 编译期通过 `DesignTokens` 类型保证子键不会拼错。
 */

/** 颜色 token —— 含背景层级、文字层级、功能色与边框。 */
export interface ColorTokens {
  /** 最底层背景。 */
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  bgActive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  border: string;
  borderHover: string;
}

export interface SpacingTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
}

export interface RadiusTokens {
  sm: string;
  md: string;
  lg: string;
  full: string;
}

export interface FontSizeTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
}

export interface AnimationTokens {
  fast: string;
  normal: string;
  slow: string;
  easing: string;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
}

/** 完整 Design Tokens 集合。 */
export interface DesignTokens {
  colors: ColorTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  fontSize: FontSizeTokens;
  animation: AnimationTokens;
  shadow: ShadowTokens;
}

/**
 * 默认深色主题——RFC-004 §3.1 表格中的标定值。
 * 注意：此处导出为 `as const`，调用方读取仍可改写副本。
 */
export const defaultTheme: DesignTokens = {
  colors: {
    bgPrimary: 'rgba(15, 15, 20, 0.95)',
    bgSecondary: 'rgba(25, 25, 35, 0.90)',
    bgTertiary: 'rgba(35, 35, 50, 0.85)',
    bgHover: 'rgba(255, 255, 255, 0.05)',
    bgActive: 'rgba(255, 255, 255, 0.08)',
    textPrimary: 'rgba(255, 255, 255, 0.95)',
    textSecondary: 'rgba(255, 255, 255, 0.65)',
    textMuted: 'rgba(255, 255, 255, 0.40)',
    accent: '#4F9EF8',
    accentHover: '#6BB0FF',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    info: '#60A5FA',
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
