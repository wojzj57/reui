/**
 * Token → antd ThemeConfig 映射（RFC-004 §3.1 ②）。
 *
 * 将 DesignTokens 投影到 antd 的全局 token 与组件 token，
 * 使 antd 封装层与自研容器/布局层共享同一套主题来源。
 *
 * 使用仓库已有的 `deepMerge` 取代 lodash combine。
 */

import type { ThemeConfig } from 'antd';
import { theme as antdTheme } from 'antd';
import type { DesignTokens } from './tokens';
import { deepMerge } from './theme-utils';

/**
 * 将 DesignTokens 转换为 antd v6 ThemeConfig。
 *
 * - cssVar: true  → token 注入为 CSS 变量，运行时切换不重渲染
 * - hashed: false → 避免 antd 生成随机 hash 类名，便于样式覆盖
 * - algorithm     → 使用 darkAlgorithm 作为默认深色主题基础
 */
export function tokensToAntdTheme(t: DesignTokens): ThemeConfig {
  const base: ThemeConfig = {
    cssVar: { prefix: 'reui' },
    hashed: false,
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: t.colors.accent,
      colorPrimaryHover: t.colors.accentHover,
      colorSuccess: t.colors.success,
      colorWarning: t.colors.warning,
      colorError: t.colors.danger,
      colorInfo: t.colors.info,
      colorBgContainer: t.colors.bgSecondary,
      colorBgElevated: t.colors.bgTertiary,
      colorBorder: t.colors.border,
      colorText: t.colors.textPrimary,
      colorTextSecondary: t.colors.textSecondary,
      colorTextQuaternary: t.colors.textMuted,
      borderRadius: parseInt(t.radius.md, 10),
      fontSize: parseInt(t.fontSize.md, 10),
      motionDurationMid: t.animation.normal,
      motionEaseInOut: t.animation.easing,
    },
    components: {
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
      },
      Modal: {
        contentBg: t.colors.bgSecondary,
        headerBg: t.colors.bgSecondary,
        footerBg: t.colors.bgSecondary,
      },
      Input: {
        activeShadow: `0 0 0 2px ${t.colors.accent}33`,
      },
      Slider: {
        trackBg: t.colors.border,
        trackHoverBg: t.colors.borderHover,
      },
    },
  };

  return base;
}

/**
 * 支持用局部 override 与默认主题做 deepMerge。
 */
export function createAntdTheme(
  base: DesignTokens,
  override?: Partial<DesignTokens>,
): ThemeConfig {
  const merged = deepMerge(base, override ?? {}) as DesignTokens;
  return tokensToAntdTheme(merged);
}
