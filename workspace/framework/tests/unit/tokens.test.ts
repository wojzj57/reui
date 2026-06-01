/**
 * 单元测试：tokens 默认值（RFC-004 §3.1）。
 */

import { describe, expect, it } from 'vitest';
import { defaultTheme } from '../../src/theme/tokens';

describe('defaultTheme', () => {
  it('should expose all six categories', () => {
    expect(Object.keys(defaultTheme).sort()).toEqual([
      'animation',
      'colors',
      'fontSize',
      'radius',
      'shadow',
      'spacing',
    ]);
  });

  it('should provide expected color palette per RFC-004 §3.1', () => {
    expect(defaultTheme.colors.accent).toBe('#4F9EF8');
    expect(defaultTheme.colors.success).toBe('#4ADE80');
    expect(defaultTheme.colors.warning).toBe('#FBBF24');
    expect(defaultTheme.colors.danger).toBe('#F87171');
  });

  it('should provide spacing values in pixels', () => {
    expect(defaultTheme.spacing.xs).toMatch(/^\d+px$/);
    expect(defaultTheme.spacing.xxl).toBe('32px');
  });

  it('should expose easing curve as cubic-bezier', () => {
    expect(defaultTheme.animation.easing).toMatch(/cubic-bezier/);
  });
});
