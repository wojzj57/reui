/**
 * useUser —— 获取当前用户信息（RFC-004 §3.5）。
 *
 * 监听 auth 状态变化自动更新。
 * 底层使用 @reui/core 的 auth 模块。
 */

import { useState, useEffect } from 'react';
import { auth } from '@reui/core';

export interface UserInfo {
  id: string;
  name: string;
  [key: string]: unknown;
}

export function useUser(): { user: UserInfo | null; loading: boolean } {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 获取初始用户状态
    auth.getUser()
      .then((u: UserInfo | null) => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // 监听 auth 状态变化
    const unsub = auth.onUserChange((u: UserInfo | null) => {
      setUser(u);
    });

    return unsub;
  }, []);

  return { user, loading };
}
