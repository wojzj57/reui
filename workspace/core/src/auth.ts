/**
 * auth 模块（RFC-003 §4.4）—— 认证状态查询的 iframe 侧封装。
 *
 * 被动模式：认证由游戏服务器驱动，插件只能查询，不能登录/登出。
 * **token 永不暴露给插件**——只能通过 http 模块间接使用。
 * 读取类 API 无需 capability。
 */

import { Client, type Unsubscribe } from './client';
import type { UserInfo } from '@reui/interface';

export type { UserInfo };

export const auth = {
  /** 查询当前玩家信息。 */
  getUser(): Promise<UserInfo | null> {
    return Client.getInstance().request<UserInfo | null>('auth:getUser');
  },

  /** 单个权限校验。 */
  hasPermission(permission: string): Promise<boolean> {
    return Client.getInstance().request<boolean>('auth:hasPermission', {
      permission,
    });
  },

  /** 批量权限校验：是否**同时**具备列表中所有权限。 */
  checkPermissions(permissions: string[]): Promise<boolean> {
    return Client.getInstance().request<boolean>('auth:checkPermissions', {
      permissions,
    });
  },

  /** 获取当前角色列表。 */
  getRoles(): Promise<string[]> {
    return Client.getInstance().request<string[]>('auth:getRoles');
  },

  /** 订阅玩家信息变更。 */
  onUserChange(handler: (user: UserInfo | null) => void): Unsubscribe {
    return Client.getInstance().onPush('auth:userChanged', (payload) =>
      handler(payload as UserInfo | null),
    );
  },

  /** 订阅权限列表变更。 */
  onPermissionChange(handler: (permissions: string[]) => void): Unsubscribe {
    return Client.getInstance().onPush('auth:permissionsChanged', (payload) =>
      handler(payload as string[]),
    );
  },
};
