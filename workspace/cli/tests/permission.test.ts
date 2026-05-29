/**
 * 单元测试：permission —— 运行时权限匹配（RFC-002 §4.3）。
 */

import { describe, expect, it } from 'vitest';
import {
  canAccessPlugin,
  hasPermission,
  METHOD_PERMISSIONS,
  requiredPermissionFor,
} from '../src/permission';

describe('hasPermission', () => {
  it('should match exact permission', () => {
    expect(hasPermission(['runtime.network'], 'runtime.network')).toBe(true);
  });

  it('should deny when permission is missing', () => {
    expect(hasPermission(['runtime.message'], 'runtime.network')).toBe(false);
  });

  it('should grant when runtime.all is held and required permission is runtime.*', () => {
    expect(hasPermission(['runtime.all'], 'runtime.network')).toBe(true);
    expect(hasPermission(['runtime.all'], 'runtime.websocket')).toBe(true);
  });

  it('should NOT grant runtime.all for non-runtime permissions', () => {
    expect(hasPermission(['runtime.all'], 'plugins.foo')).toBe(false);
  });

  it('should match wildcard runtime.* against runtime.network', () => {
    expect(hasPermission(['runtime.*'], 'runtime.network')).toBe(true);
  });

  it('should match nested wildcard a.b.* against a.b.c', () => {
    expect(hasPermission(['a.b.*'], 'a.b.c')).toBe(true);
    expect(hasPermission(['a.b.*'], 'a.x.c')).toBe(false);
  });

  it('should treat empty required as granted', () => {
    expect(hasPermission([], '')).toBe(true);
  });
});

describe('canAccessPlugin', () => {
  it('should grant with plugins.all', () => {
    expect(canAccessPlugin(['plugins.all'], 'inventory')).toBe(true);
  });

  it('should grant with plugins.<id>', () => {
    expect(canAccessPlugin(['plugins.inventory'], 'inventory')).toBe(true);
  });

  it('should deny when neither matches', () => {
    expect(canAccessPlugin(['plugins.hud'], 'inventory')).toBe(false);
    expect(canAccessPlugin([], 'inventory')).toBe(false);
  });
});

describe('requiredPermissionFor / METHOD_PERMISSIONS', () => {
  it('should return runtime.network for http:request', () => {
    expect(requiredPermissionFor('http:request')).toBe('runtime.network');
  });

  it('should return null for self-control methods', () => {
    expect(requiredPermissionFor('plugin:show')).toBeNull();
    expect(requiredPermissionFor('plugin:saveState')).toBeNull();
  });

  it('should return undefined for unknown methods', () => {
    expect(requiredPermissionFor('does:not:exist')).toBeUndefined();
  });

  it('should be a frozen map', () => {
    expect(Object.isFrozen(METHOD_PERMISSIONS)).toBe(true);
  });
});
