import { describe, it, expect } from 'vitest';
import { tokensToAntdTheme, createAntdTheme } from '../../src/theme/antd-theme';
import { defaultTheme } from '../../src/theme/tokens';

describe('tokensToAntdTheme', () => {
  const cfg = tokensToAntdTheme(defaultTheme);

  it('projects colors to antd token', () => {
    expect(cfg.token?.colorPrimary).toBe(defaultTheme.colors.accent);
    expect(cfg.token?.colorError).toBe(defaultTheme.colors.danger);
    expect(cfg.token?.colorSuccess).toBe(defaultTheme.colors.success);
  });

  it('parses px tokens to numbers', () => {
    expect(cfg.token?.borderRadius).toBe(8);
    expect(cfg.token?.fontSize).toBe(14);
  });

  it('enables cssVar with reui prefix and disables hashed', () => {
    expect(cfg.cssVar).toEqual({ prefix: 'reui' });
    expect(cfg.hashed).toBe(false);
  });

  it('includes component overrides', () => {
    expect(cfg.components?.Button).toBeDefined();
    expect(cfg.components?.Modal).toBeDefined();
  });
});

describe('createAntdTheme', () => {
  it('applies override on top of base', () => {
    const cfg = createAntdTheme(defaultTheme, {
      colors: { ...defaultTheme.colors, accent: '#ff0000' },
    });
    expect(cfg.token?.colorPrimary).toBe('#ff0000');
  });

  it('works without override', () => {
    const cfg = createAntdTheme(defaultTheme);
    expect(cfg.token?.colorPrimary).toBe(defaultTheme.colors.accent);
  });
});
