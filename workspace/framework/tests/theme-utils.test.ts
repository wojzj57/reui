/**
 * 单元测试：theme-utils（RFC-004 §3.1 / §3.2）。
 */

import { describe, expect, it } from 'vitest';
import {
  camelToKebab,
  deepMerge,
  flattenTokens,
  tokensToCssVars,
} from '../src/theme/theme-utils';
import { defaultTheme, type DesignTokens } from '../src/theme/tokens';

describe('camelToKebab', () => {
  it('should convert single-word camelCase', () => {
    expect(camelToKebab('bgPrimary')).toBe('bg-primary');
  });

  it('should keep already kebab strings unchanged', () => {
    expect(camelToKebab('font-size')).toBe('font-size');
  });

  it('should hyphenate before each uppercase except the first', () => {
    // 一种朴素的 camelCase → kebab 转换；连续大写会逐字符断开。
    expect(camelToKebab('AccentHover')).toBe('accent-hover');
    expect(camelToKebab('bgPrimary')).toBe('bg-primary');
  });

  it('should pass through lowercase strings', () => {
    expect(camelToKebab('accent')).toBe('accent');
  });

  it('should not prepend a hyphen for leading uppercase', () => {
    expect(camelToKebab('Accent')).toBe('accent');
    expect(camelToKebab('AccentHover')).toBe('accent-hover');
  });
});

describe('deepMerge', () => {
  it('should override primitive values', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 99 })).toEqual({ a: 1, b: 99 });
  });

  it('should merge nested objects rather than replacing', () => {
    const r = deepMerge(
      { colors: { accent: 'red', bg: 'black' } },
      { colors: { accent: 'blue' } },
    );
    expect(r).toEqual({ colors: { accent: 'blue', bg: 'black' } });
  });

  it('should replace arrays entirely', () => {
    const r = deepMerge<{ list: number[] }>({ list: [1, 2, 3] }, { list: [9] });
    expect(r.list).toEqual([9]);
  });

  it('should skip undefined values', () => {
    const r = deepMerge<{ a: number; b: number }>(
      { a: 1, b: 2 },
      { b: undefined },
    );
    expect(r).toEqual({ a: 1, b: 2 });
  });

  it('should not mutate the base object', () => {
    const base = { colors: { a: '1' } };
    const before = JSON.stringify(base);
    deepMerge(base, { colors: { a: '2' } });
    expect(JSON.stringify(base)).toBe(before);
  });

  it('should accept full DesignTokens override', () => {
    const overridden = deepMerge(defaultTheme, {
      colors: { accent: '#FF0' },
      spacing: { md: '20px' },
    });
    expect(overridden.colors.accent).toBe('#FF0');
    expect(overridden.spacing.md).toBe('20px');
    // 未覆盖字段保留默认值
    expect(overridden.colors.bgPrimary).toBe(defaultTheme.colors.bgPrimary);
    expect(overridden.spacing.xs).toBe(defaultTheme.spacing.xs);
  });

  it('should treat non-plain objects as primitive replacement', () => {
    const date = new Date(0);
    const r = deepMerge<{ d?: Date | { x: number } }>(
      { d: { x: 1 } },
      { d: date },
    );
    expect(r.d).toBe(date);
  });
});

describe('tokensToCssVars', () => {
  it('should produce kebab-cased CSS custom properties', () => {
    const vars = tokensToCssVars(defaultTheme);
    expect(vars['--reui-colors-bg-primary']).toBe(defaultTheme.colors.bgPrimary);
    expect(vars['--reui-spacing-md']).toBe('12px');
    expect(vars['--reui-animation-easing']).toBe(defaultTheme.animation.easing);
  });

  it('should respect custom prefix', () => {
    const vars = tokensToCssVars(defaultTheme, '--my');
    expect(vars['--my-colors-accent']).toBe(defaultTheme.colors.accent);
    expect(vars['--reui-colors-accent']).toBeUndefined();
  });

  it('should output every leaf token', () => {
    const vars = tokensToCssVars(defaultTheme);
    // 默认主题有 16 colors + 6 spacing + 4 radius + 6 fontSize + 4 animation + 3 shadow = 39
    expect(Object.keys(vars).length).toBe(16 + 6 + 4 + 6 + 4 + 3);
  });

  it('should stringify non-string leaves', () => {
    const tokens = {
      colors: { ...defaultTheme.colors },
      spacing: { ...defaultTheme.spacing },
      radius: { ...defaultTheme.radius },
      fontSize: { ...defaultTheme.fontSize },
      animation: { ...defaultTheme.animation },
      shadow: { ...defaultTheme.shadow },
    } as DesignTokens & Record<string, unknown>;
    // 注入一个数字以验证 String(...) 转换
    (tokens as Record<string, unknown>).extra = 42;
    const vars = tokensToCssVars(tokens as DesignTokens);
    expect(vars['--reui-extra']).toBe('42');
  });
});

describe('flattenTokens', () => {
  it('should join keys with hyphen and drop leading prefix', () => {
    const flat = flattenTokens(defaultTheme);
    expect(flat['colors-accent']).toBe(defaultTheme.colors.accent);
    expect(flat['spacing-xl']).toBe(defaultTheme.spacing.xl);
  });
});
