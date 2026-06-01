/**
 * 单元测试：signProject / verifyProject（RFC-005 §3.2.1 / §3.2.2）。
 */

import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../src/schema/plugin-manifest';
import { signProject, verifyProject } from '../src/project';
import { attachLock } from '../src/signer';
import type { ScanResult } from '../src/scanner';

const KEY = 'sk-test';

const valid: PluginManifest = {
  id: 'inv',
  name: 'Inventory',
  version: '1.0.0',
  entry: 'index.html',
  layer: 'panel',
};

const high: PluginManifest = {
  ...valid,
  id: 'admin-panel',
  permissions: ['runtime.all', 'plugins.all'],
};

const wrap = (m: PluginManifest, basePath = `plugins/${m.id}`): ScanResult => ({
  basePath,
  manifest: m,
});

describe('signProject', () => {
  it('should sign valid plugins and emit SignedOutput', () => {
    // arrange
    const scanned = { plugins: [wrap(valid)], errors: [] };

    // act
    const r = signProject(scanned, { secretKey: KEY });

    // assert
    expect(r.signed).toHaveLength(1);
    expect(r.signed[0]!.signed._lock.algorithm).toBe('hmac-sha256');
    expect(r.issues).toEqual([]);
  });

  it('should mark high-privilege plugins as issue when not confirmed', () => {
    const scanned = { plugins: [wrap(high)], errors: [] };

    const r = signProject(scanned, { secretKey: KEY });

    expect(r.signed[0]!.highPrivilege).toBe(true);
    expect(r.issues.some((i) => i.kind === 'high-privilege')).toBe(true);
  });

  it('should accept high-privilege plugin when confirmed', () => {
    const scanned = { plugins: [wrap(high)], errors: [] };

    const r = signProject(scanned, {
      secretKey: KEY,
      confirmedHighPrivilege: new Set(['admin-panel']),
    });

    expect(r.signed[0]!.highPrivilege).toBe(true);
    expect(r.issues.filter((i) => i.kind === 'high-privilege')).toHaveLength(0);
  });

  it('should report invalid manifests instead of signing them', () => {
    const scanned = {
      plugins: [wrap({ ...valid, id: 'BAD' as unknown as 'inv' })],
      errors: [],
    };

    const r = signProject(scanned, { secretKey: KEY });

    expect(r.signed).toHaveLength(0);
    expect(r.issues.some((i) => i.kind === 'invalid')).toBe(true);
  });

  it('should propagate scan errors as `scan` issues', () => {
    const scanned = {
      plugins: [],
      errors: [{ basePath: 'plugins/bad', kind: 'JSON' as const, message: 'oops' }],
    };

    const r = signProject(scanned, { secretKey: KEY });

    expect(r.issues.some((i) => i.kind === 'scan')).toBe(true);
  });

  it('should ignore MISSING scan errors silently', () => {
    const scanned = {
      plugins: [wrap(valid)],
      errors: [{ basePath: 'plugins/empty', kind: 'MISSING' as const, message: 'gone' }],
    };

    const r = signProject(scanned, { secretKey: KEY });

    expect(r.issues.filter((i) => i.kind === 'scan')).toHaveLength(0);
  });

  it('should reject empty secret key', () => {
    expect(() =>
      signProject({ plugins: [], errors: [] }, { secretKey: '' }),
    ).toThrow();
  });
});

describe('verifyProject', () => {
  it('should pass when signature is valid', () => {
    // arrange
    const signed = attachLock(valid, KEY);
    const scanned = { plugins: [wrap(signed)], errors: [] };

    // act
    const r = verifyProject(scanned, { secretKey: KEY });

    // assert
    expect(r.passed).toHaveLength(1);
    expect(r.issues).toEqual([]);
  });

  it('should report unsigned plugins', () => {
    const scanned = { plugins: [wrap(valid)], errors: [] };

    const r = verifyProject(scanned, { secretKey: KEY });

    expect(r.issues.some((i) => i.kind === 'unsigned')).toBe(true);
    expect(r.passed).toHaveLength(0);
  });

  it('should report tampered signatures', () => {
    const signed = attachLock(valid, KEY);
    const tampered = { ...signed, permissions: ['runtime.all'] };
    const scanned = { plugins: [wrap(tampered)], errors: [] };

    const r = verifyProject(scanned, { secretKey: KEY });

    expect(r.issues.some((i) => i.kind === 'tampered')).toBe(true);
  });

  it('should report unsupported algorithm', () => {
    const signed = attachLock(valid, KEY);
    const broken = {
      ...signed,
      _lock: { ...signed._lock, algorithm: 'md5' as unknown as 'hmac-sha256' },
    };
    const scanned = { plugins: [wrap(broken)], errors: [] };

    const r = verifyProject(scanned, { secretKey: KEY });

    expect(r.issues.some((i) => i.kind === 'unsupported-algorithm')).toBe(true);
  });

  it('should report invalid manifests during verify', () => {
    const scanned = {
      plugins: [wrap({ ...valid, version: 'not-semver' as unknown as '1.0.0' })],
      errors: [],
    };

    const r = verifyProject(scanned, { secretKey: KEY });

    expect(r.issues.some((i) => i.kind === 'invalid')).toBe(true);
  });

  it('should propagate scan errors', () => {
    const scanned = {
      plugins: [],
      errors: [{ basePath: 'plugins/bad', kind: 'JSON' as const, message: 'oops' }],
    };

    const r = verifyProject(scanned, { secretKey: KEY });

    expect(r.issues.some((i) => i.kind === 'scan')).toBe(true);
  });
});
