/**
 * usePermission —— 查询插件权限（RFC-004 §3.5）。
 *
 * 返回响应式结果（初始 loading，查询完成后更新 allowed）。
 * 底层使用 @reui/core 的 auth 模块。
 */

import { useState, useEffect, useCallback } from 'react';
import { auth } from '@reui/core';

export interface PermissionResult {
  allowed: boolean;
  loading: boolean;
}

export function usePermission(permission: string): PermissionResult {
  const [result, setResult] = useState<PermissionResult>({
    allowed: false,
    loading: true,
  });

  const checkPermission = useCallback(async () => {
    try {
      const allowed = await auth.hasPermission(permission);
      setResult({ allowed, loading: false });
    } catch {
      setResult({ allowed: false, loading: false });
    }
  }, [permission]);

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  return result;
}
