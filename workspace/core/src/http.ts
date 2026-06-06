/**
 * http 模块（RFC-003 §4.2）—— 经 Runtime HttpClient 代理的 HTTP 客户端。
 *
 * 认证 token 由 Runtime 侧拦截器自动附加，**iframe 永远拿不到 token**。
 * 每个方法返回响应体（`data`）而非完整响应信封。需要 `runtime.network` 权限。
 */

import { Client } from './client';

export interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  /** 覆盖默认超时（ms）。 */
  timeout?: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface ProxyResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

const send = async <T>(
  method: Method,
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<T> => {
  const res = await Client.getInstance().request<ProxyResponse<T>>(
    'http:request',
    { method, url, data, ...config },
  );
  return res.data;
};

export const http = {
  get<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return send<T>('GET', url, undefined, config);
  },
  post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return send<T>('POST', url, data, config);
  },
  put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return send<T>('PUT', url, data, config);
  },
  delete<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return send<T>('DELETE', url, undefined, config);
  },
  patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return send<T>('PATCH', url, data, config);
  },
};
