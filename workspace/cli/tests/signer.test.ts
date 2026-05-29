/**
 * 单元测试：signer —— 嵌入式签名（RFC-002 §4.2）。
 */

import { describe, expect, it } from 'vitest';
import {
  attachLock,
  computeSignature,
  extractSecuredFields,
  normalizeForSigning,
  signManifest,
  verifyManifest,
} from '../src/signer';
import type { PluginManifest } from '../src/schema/plugin-manifest';

const sample: PluginManifest = {
  id: 'inventory',
  name: 'Inventory',
  version: '1.0.0',
  entry: 'index.html',
  layer: 'panel',
  permissions: ['runtime.network', 'runtime.message'],
  roleRestriction: [],
};

const KEY = 'test-secret-key';

describe('extractSecuredFields', () => {
  it('should default permissions/roleRestriction to [] and enabled to true', () => {
    const s = extractSecuredFields({
      id: 'a',
      name: 'A',
      version: '1.0.0',
      entry: 'index.html',
      layer: 'hud',
    });
    expect(s.permissions).toEqual([]);
    expect(s.roleRestriction).toEqual([]);
    expect(s.enabled).toBe(true);
  });
});

describe('normalizeForSigning', () => {
  it('should sort permissions and roleRestriction deterministically', () => {
    const n = normalizeForSigning({
      id: 'a',
      version: '1.0.0',
      entry: 'index.html',
      layer: 'hud',
      permissions: ['z', 'a', 'm'],
      roleRestriction: ['c', 'a'],
      enabled: true,
    });
    expect(n.permissions).toEqual(['a', 'm', 'z']);
    expect(n.roleRestriction).toEqual(['a', 'c']);
  });

  it('should not mutate the input array', () => {
    const input = {
      id: 'a',
      version: '1.0.0',
      entry: 'i',
      layer: 'hud' as const,
      permissions: ['z', 'a'],
      roleRestriction: [],
      enabled: true,
    };
    normalizeForSigning(input);
    expect(input.permissions).toEqual(['z', 'a']);
  });
});

describe('computeSignature', () => {
  it('should produce stable signature for same secured fields', () => {
    const a = computeSignature(sample, KEY);
    const b = computeSignature(sample, KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('should produce different signatures for different keys', () => {
    expect(computeSignature(sample, 'k1')).not.toBe(computeSignature(sample, 'k2'));
  });

  it('should ignore display/name/defaultHotkey changes', () => {
    const sig1 = computeSignature(sample, KEY);
    const modified: PluginManifest = {
      ...sample,
      name: 'Different Name',
      display: { width: '999px' },
      defaultHotkey: 'F12',
    };
    expect(computeSignature(modified, KEY)).toBe(sig1);
  });

  it('should change when secured fields change', () => {
    const sig1 = computeSignature(sample, KEY);
    expect(
      computeSignature({ ...sample, entry: 'evil.html' }, KEY),
    ).not.toBe(sig1);
    expect(
      computeSignature({ ...sample, permissions: ['runtime.all'] }, KEY),
    ).not.toBe(sig1);
    expect(
      computeSignature({ ...sample, roleRestriction: [] }, KEY),
    ).toBe(sig1); // already empty == empty
  });

  it('should be insensitive to permission ordering (normalized)', () => {
    const a = computeSignature(
      { ...sample, permissions: ['runtime.network', 'runtime.message'] },
      KEY,
    );
    const b = computeSignature(
      { ...sample, permissions: ['runtime.message', 'runtime.network'] },
      KEY,
    );
    expect(a).toBe(b);
  });

  it('should reject empty key', () => {
    expect(() => computeSignature(sample, '')).toThrow();
  });
});

describe('signManifest / attachLock', () => {
  it('should produce a lock with expected algorithm and signature', () => {
    const lock = signManifest(sample, KEY);
    expect(lock.algorithm).toBe('hmac-sha256');
    expect(lock.version).toBe(1);
    expect(lock.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(lock.signedAt).toString()).not.toBe('Invalid Date');
  });

  it('should not mutate the input manifest when attaching', () => {
    const before = JSON.stringify(sample);
    attachLock(sample, KEY);
    expect(JSON.stringify(sample)).toBe(before);
  });
});

describe('verifyManifest', () => {
  it('should accept a manifest signed with the same key', () => {
    const signed = attachLock(sample, KEY);
    expect(verifyManifest(signed, KEY)).toBe(true);
  });

  it('should reject when missing _lock', () => {
    expect(verifyManifest(sample, KEY)).toBe(false);
  });

  it('should reject manifests signed with a different key', () => {
    const signed = attachLock(sample, 'other-key');
    expect(verifyManifest(signed, KEY)).toBe(false);
  });

  it('should reject tampered secured fields', () => {
    const signed = attachLock(sample, KEY);
    const tampered = { ...signed, permissions: ['runtime.all'] };
    expect(verifyManifest(tampered, KEY)).toBe(false);
  });

  it('should accept changes to non-secured fields', () => {
    const signed = attachLock(sample, KEY);
    const changed = { ...signed, name: 'New Name', defaultHotkey: 'F9' };
    expect(verifyManifest(changed, KEY)).toBe(true);
  });

  it('should reject unsupported algorithm', () => {
    const signed = attachLock(sample, KEY);
    const broken = {
      ...signed,
      _lock: { ...signed._lock, algorithm: 'md5' as unknown as 'hmac-sha256' },
    };
    expect(verifyManifest(broken, KEY)).toBe(false);
  });

  it('should reject malformed hex signature', () => {
    const signed = attachLock(sample, KEY);
    const broken = { ...signed, _lock: { ...signed._lock, signature: '' } };
    expect(verifyManifest(broken, KEY)).toBe(false);
  });

  it('should reject signature of wrong byte length', () => {
    const signed = attachLock(sample, KEY);
    const broken = {
      ...signed,
      _lock: { ...signed._lock, signature: 'aa' }, // 1 byte
    };
    expect(verifyManifest(broken, KEY)).toBe(false);
  });
});
