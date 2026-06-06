/**
 * AuthService（RFC-003 §3.4）。
 *
 * 被动模式：认证由 FiveM 游戏服务器驱动（Steam/Discord/License），
 * Runtime 仅接收认证状态并暴露查询 API 给插件。
 *
 * 关键不变量：
 *   1. token **永不**通过 PostMessageRouter 暴露给 iframe——HttpClient
 *      使用拦截器在 Runtime 侧附加 Authorization 头部；
 *   2. permissions / roles 内部以 Set 存储，对外返回**新数组**——
 *      防止调用方意外修改内部状态；
 *   3. 所有 update* 方法都会触发对应的变更通知（即使值未变化也广播——
 *      这样上游可以放心地把 update* 当作 idempotent 重置接口）。
 */

import type { UserInfo } from '@reui/interface';

export type { UserInfo };

export type Unsubscribe = () => void;

type UserHandler = (user: UserInfo | null) => void;
type PermissionHandler = (permissions: string[]) => void;
type RoleHandler = (roles: string[]) => void;
type TokenHandler = (token: string | null) => void;

export class AuthService {
  private static _instance: AuthService | null = null;

  private currentUser: UserInfo | null = null;
  private permissions = new Set<string>();
  private roles = new Set<string>();
  private token: string | null = null;

  private readonly userHandlers = new Set<UserHandler>();
  private readonly permissionHandlers = new Set<PermissionHandler>();
  private readonly roleHandlers = new Set<RoleHandler>();
  private readonly tokenHandlers = new Set<TokenHandler>();

  static getInstance(): AuthService {
    if (!AuthService._instance) AuthService._instance = new AuthService();
    return AuthService._instance;
  }

  static __resetForTests(): void {
    AuthService._instance = null;
  }

  // ── 游戏端推送接口 ────────────────────────────────────────────────────

  updateUser(user: UserInfo | null): void {
    this.currentUser = user;
    this.notifyAll(this.userHandlers, user);
  }

  updatePermissions(permissions: readonly string[]): void {
    this.permissions = new Set(permissions);
    this.notifyAll(this.permissionHandlers, [...permissions]);
  }

  updateRoles(roles: readonly string[]): void {
    this.roles = new Set(roles);
    this.notifyAll(this.roleHandlers, [...roles]);
  }

  updateToken(token: string | null): void {
    this.token = token;
    this.notifyAll(this.tokenHandlers, token);
  }

  // ── 子页面查询接口 ────────────────────────────────────────────────────

  getUser(): UserInfo | null {
    return this.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.permissions.has(permission);
  }

  hasAnyPermission(permissions: readonly string[]): boolean {
    return permissions.some((p) => this.permissions.has(p));
  }

  hasAllPermissions(permissions: readonly string[]): boolean {
    return permissions.every((p) => this.permissions.has(p));
  }

  getPermissions(): string[] {
    return [...this.permissions];
  }

  getRoles(): string[] {
    return [...this.roles];
  }

  hasRole(role: string): boolean {
    return this.roles.has(role);
  }

  // ── Token 管理（仅 Runtime 内部） ───────────────────────────────────

  /**
   * 获取 Token——**严格仅 Runtime 内部使用**。
   * 不应通过 PostMessageRouter / @reui/core 暴露给 iframe。
   */
  getToken(): string | null {
    return this.token;
  }

  // ── 事件通知 ─────────────────────────────────────────────────────────

  onUserChange(handler: UserHandler): Unsubscribe {
    this.userHandlers.add(handler);
    return () => void this.userHandlers.delete(handler);
  }

  onPermissionChange(handler: PermissionHandler): Unsubscribe {
    this.permissionHandlers.add(handler);
    return () => void this.permissionHandlers.delete(handler);
  }

  onRoleChange(handler: RoleHandler): Unsubscribe {
    this.roleHandlers.add(handler);
    return () => void this.roleHandlers.delete(handler);
  }

  onTokenChange(handler: TokenHandler): Unsubscribe {
    this.tokenHandlers.add(handler);
    return () => void this.tokenHandlers.delete(handler);
  }

  private notifyAll<T>(handlers: Set<(v: T) => void>, value: T): void {
    for (const h of [...handlers]) {
      try {
        h(value);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ReUI:Auth] notify handler threw:', err);
      }
    }
  }
}
