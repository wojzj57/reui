/**
 * 单元测试：validator —— Schema 校验、Runtime 覆盖、角色检查（RFC-002 §3.3 / §3.4.4）。
 */

import { describe, expect, it } from 'vitest';
import { validateManifest, applyOverrides, checkRoleAccess } from '../src/validator';
import type { PluginManifest } from '../src/schema/plugin-manifest';

const baseManifest: PluginManifest = {
  id: 'inventory',
  name: 'Inventory',
  version: '1.2.3',
  entry: 'index.html',
  layer: 'panel',
};

describe('validateManifest', () => {
  it('should accept a minimal valid manifest', () => {
    // act
    const r = validateManifest(baseManifest);

    // assert
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.manifest.id).toBe('inventory');
  });

  it('should reject id with uppercase', () => {
    const r = validateManifest({ ...baseManifest, id: 'Inventory' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.issues.some((i) => i.path === 'id')).toBe(true);
  });

  it('should reject path traversal in entry', () => {
    const r = validateManifest({ ...baseManifest, entry: '../../etc/passwd' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.issues.some((i) => i.path === 'entry')).toBe(true);
  });

  it('should reject non-localhost devEntry', () => {
    const r = validateManifest({
      ...baseManifest,
      devEntry: 'https://evil.example.com',
    });
    expect(r.valid).toBe(false);
  });

  it('should accept localhost devEntry', () => {
    const r = validateManifest({
      ...baseManifest,
      devEntry: 'http://localhost:3000',
    });
    expect(r.valid).toBe(true);
  });

  it('should reject malformed permission strings', () => {
    const r = validateManifest({
      ...baseManifest,
      permissions: ['Bad Permission'],
    });
    expect(r.valid).toBe(false);
  });

  it('should reject layer outside the allowed enum', () => {
    const r = validateManifest({ ...baseManifest, layer: 'unknown' });
    expect(r.valid).toBe(false);
  });

  it('should report multiple issues with their paths', () => {
    const r = validateManifest({
      ...baseManifest,
      id: '',
      version: 'not-semver',
    });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('id');
      expect(paths).toContain('version');
    }
  });
});

describe('applyOverrides', () => {
  it('should be a no-op when no config is given', () => {
    expect(applyOverrides(baseManifest, undefined)).toEqual(baseManifest);
  });

  it('should disable when disableAll is true', () => {
    const result = applyOverrides(baseManifest, { plugins: { disableAll: true } });
    expect(result.enabled).toBe(false);
  });

  it('should override enabled and defaultHotkey when present', () => {
    const result = applyOverrides(baseManifest, {
      plugins: { overrides: { inventory: { enabled: false, defaultHotkey: 'F4' } } },
    });
    expect(result.enabled).toBe(false);
    expect(result.defaultHotkey).toBe('F4');
  });

  it('should merge display fields rather than replacing entirely', () => {
    const m: PluginManifest = {
      ...baseManifest,
      display: { width: '800px', height: '600px' },
    };
    const result = applyOverrides(m, {
      plugins: { overrides: { inventory: { display: { width: '1000px' } } } },
    });
    expect(result.display).toEqual({ width: '1000px', height: '600px' });
  });

  it('should leave non-target plugins untouched', () => {
    const result = applyOverrides(baseManifest, {
      plugins: { overrides: { other: { enabled: false } } },
    });
    expect(result).toEqual(baseManifest);
  });
});

describe('checkRoleAccess', () => {
  it('should grant access when no roleRestriction is set', () => {
    expect(checkRoleAccess({}, [])).toBe(true);
    expect(checkRoleAccess({ roleRestriction: [] }, [])).toBe(true);
  });

  it('should grant when user has at least one matching role (OR logic)', () => {
    expect(checkRoleAccess({ roleRestriction: ['police', 'ems'] }, ['ems'])).toBe(true);
  });

  it('should deny when user has none of the required roles', () => {
    expect(checkRoleAccess({ roleRestriction: ['admin'] }, ['user'])).toBe(false);
  });
});
