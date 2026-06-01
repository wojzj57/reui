/**
 * 单元测试：AuthService（RFC-003 §3.4）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, type UserInfo } from '../src/auth-service';

const sampleUser: UserInfo = {
  id: 'p1',
  name: 'Tester',
  identifiers: ['steam:abc'],
};

describe('AuthService', () => {
  let auth: AuthService;

  beforeEach(() => {
    AuthService.__resetForTests();
    auth = AuthService.getInstance();
  });

  afterEach(() => {
    AuthService.__resetForTests();
  });

  it('should be a singleton', () => {
    expect(AuthService.getInstance()).toBe(auth);
  });

  it('should default to logged-out state', () => {
    expect(auth.getUser()).toBeNull();
    expect(auth.getPermissions()).toEqual([]);
    expect(auth.getRoles()).toEqual([]);
    expect(auth.getToken()).toBeNull();
  });

  it('should update and retrieve user', () => {
    // act
    auth.updateUser(sampleUser);

    // assert
    expect(auth.getUser()).toEqual(sampleUser);
  });

  it('should notify userChange handler', () => {
    // arrange
    const h = vi.fn();
    auth.onUserChange(h);

    // act
    auth.updateUser(sampleUser);
    auth.updateUser(null);

    // assert
    expect(h).toHaveBeenCalledTimes(2);
    expect(h).toHaveBeenNthCalledWith(1, sampleUser);
    expect(h).toHaveBeenNthCalledWith(2, null);
  });

  it('should update permissions and notify', () => {
    // arrange
    const h = vi.fn();
    auth.onPermissionChange(h);

    // act
    auth.updatePermissions(['admin', 'mod']);

    // assert
    expect(auth.hasPermission('admin')).toBe(true);
    expect(auth.hasPermission('user')).toBe(false);
    expect(auth.getPermissions().sort()).toEqual(['admin', 'mod']);
    expect(h).toHaveBeenCalledWith(['admin', 'mod']);
  });

  it('should support hasAnyPermission and hasAllPermissions', () => {
    // arrange
    auth.updatePermissions(['a', 'b']);

    // assert
    expect(auth.hasAnyPermission(['a', 'x'])).toBe(true);
    expect(auth.hasAnyPermission(['x', 'y'])).toBe(false);
    expect(auth.hasAllPermissions(['a', 'b'])).toBe(true);
    expect(auth.hasAllPermissions(['a', 'c'])).toBe(false);
  });

  it('should update roles and notify', () => {
    // arrange
    const h = vi.fn();
    auth.onRoleChange(h);

    // act
    auth.updateRoles(['police']);

    // assert
    expect(auth.hasRole('police')).toBe(true);
    expect(auth.hasRole('admin')).toBe(false);
    expect(auth.getRoles()).toEqual(['police']);
    expect(h).toHaveBeenCalledWith(['police']);
  });

  it('should update token and notify', () => {
    // arrange
    const h = vi.fn();
    auth.onTokenChange(h);

    // act
    auth.updateToken('eyJhbGciOi...');
    auth.updateToken(null);

    // assert
    expect(h).toHaveBeenCalledTimes(2);
    expect(h).toHaveBeenNthCalledWith(1, 'eyJhbGciOi...');
    expect(h).toHaveBeenNthCalledWith(2, null);
  });

  it('should return defensive copy from getPermissions/getRoles', () => {
    // arrange
    auth.updatePermissions(['a']);
    const perms = auth.getPermissions();

    // act
    perms.push('mutated');

    // assert
    expect(auth.getPermissions()).toEqual(['a']);
  });

  it('should remove handler when unsubscribe called', () => {
    // arrange
    const h = vi.fn();
    const off = auth.onUserChange(h);

    // act
    off();
    auth.updateUser(sampleUser);

    // assert
    expect(h).not.toHaveBeenCalled();
  });

  it('should isolate notify handler errors', () => {
    // arrange
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    auth.onUserChange(bad);
    auth.onUserChange(good);

    // act
    auth.updateUser(sampleUser);

    // assert
    expect(good).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should clear permissions when updatePermissions([]) called', () => {
    // arrange
    auth.updatePermissions(['a', 'b']);

    // act
    auth.updatePermissions([]);

    // assert
    expect(auth.getPermissions()).toEqual([]);
    expect(auth.hasPermission('a')).toBe(false);
  });
});
