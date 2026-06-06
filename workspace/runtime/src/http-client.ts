/**
 * HttpClient（RFC-003 §3.3）。
 *
 * Runtime 侧集中式 HTTP 客户端（axios 实现）。所有插件的网络请求都经由
 * `http:request` method 代理到这里，统一附加认证、统一重试、统一错误归一化。
 *
 * 关键不变量：
 *   1. **Token 注入只发生在 Runtime 侧**——通过 axios request 拦截器读取
 *      `AuthService.getToken()` 并写入 `Authorization: Bearer`。token 永不
 *      跨越 postMessage 边界回到 iframe（RFC-003 §3.4 安全约束）。
 *   2. 对幂等可重试的状态码（408/429/5xx）做有限次重试；其它一律快速失败。
 *   3. 抛出的错误实现 `{ code:'NETWORK_ERROR', message, details }`——
 *      PostMessageRouter 的 `toErrorResponse` 会原样透传给插件。
 *   4. 单例 + 依赖注入：构造可注入自定义 axios 实例（便于测试用 mock adapter，
 *      拦截器仍真实运行）。
 */

import axios, {
  isAxiosError,
  type AxiosInstance,
  type AxiosResponse,
} from 'axios';
import { AuthService } from './auth-service';

/** 全局默认配置（`configure` 注入）。 */
export interface HttpClientConfig {
  baseURL?: string;
  /** 默认超时（ms）。默认 30000。 */
  timeout?: number;
  /** 附加到每个请求的默认头部。 */
  headers?: Record<string, string>;
  /** 可重试次数（不含首次）。默认 3。 */
  retries?: number;
  /** 每次重试前的等待（ms）。默认 1000；为 0 时立即重试（测试友好）。 */
  retryDelayMs?: number;
  /** 触发重试的状态码集合。默认 [408,429,500,502,503,504]。 */
  retryStatuses?: readonly number[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** 单次请求参数（来自 `http:request` 的 params）。 */
export interface HttpRequestConfig {
  method?: HttpMethod;
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  /** 覆盖默认超时（ms）。 */
  timeout?: number;
}

/** 归一化后的响应（回传给插件的形态，绝不含内部 token）。 */
export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

/** 归一化错误：实现 CodedError 形态，便于 router 透传。 */
export class HttpClientError extends Error {
  readonly code = 'NETWORK_ERROR' as const;
  readonly details: { status?: number; url: string; method: string };
  constructor(
    message: string,
    details: { status?: number; url: string; method: string },
  ) {
    super(message);
    this.name = 'HttpClientError';
    this.details = details;
  }
}

const DEFAULT_RETRY_STATUSES: readonly number[] = [
  408, 429, 500, 502, 503, 504,
];

export interface HttpClientOptions {
  /** 注入自定义 axios 实例（测试用 mock adapter）。默认 `axios.create()`。 */
  axios?: AxiosInstance;
  /** 注入 AuthService（默认单例）。 */
  authService?: AuthService;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  private static _instance: HttpClient | null = null;

  private readonly http: AxiosInstance;
  private readonly authService: AuthService;

  private retries = 3;
  private retryDelayMs = 1_000;
  private retryStatuses: readonly number[] = DEFAULT_RETRY_STATUSES;

  constructor(opts: HttpClientOptions = {}) {
    this.http = opts.axios ?? axios.create({ timeout: 30_000 });
    this.authService = opts.authService ?? AuthService.getInstance();

    // Token 注入拦截器——只在 Runtime 侧运行，iframe 永远拿不到 token。
    this.http.interceptors.request.use((config) => {
      const token = this.authService.getToken();
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
      }
      return config;
    });
  }

  static getInstance(opts?: HttpClientOptions): HttpClient {
    if (!HttpClient._instance) HttpClient._instance = new HttpClient(opts);
    return HttpClient._instance;
  }

  /** 仅测试使用：重置单例避免用例间状态泄漏。 */
  static __resetForTests(): void {
    HttpClient._instance = null;
  }

  /** 注入全局默认配置。 */
  configure(config: HttpClientConfig): void {
    if (config.baseURL !== undefined) this.http.defaults.baseURL = config.baseURL;
    if (config.timeout !== undefined) this.http.defaults.timeout = config.timeout;
    if (config.headers !== undefined) {
      for (const [k, v] of Object.entries(config.headers)) {
        this.http.defaults.headers.common[k] = v;
      }
    }
    if (config.retries !== undefined) this.retries = config.retries;
    if (config.retryDelayMs !== undefined) this.retryDelayMs = config.retryDelayMs;
    if (config.retryStatuses !== undefined) {
      this.retryStatuses = config.retryStatuses;
    }
  }

  /**
   * 执行一次 HTTP 请求。对可重试状态码做有限次退避重试，最终失败抛
   * `HttpClientError`。
   */
  async request<T = unknown>(req: HttpRequestConfig): Promise<HttpResponse<T>> {
    const method = (req.method ?? 'GET') as HttpMethod;
    let lastStatus: number | undefined;
    let lastMessage = 'request failed';

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res: AxiosResponse<T> = await this.http.request<T>({
          method,
          url: req.url,
          data: req.data,
          headers: req.headers,
          params: req.params,
          ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
        });
        return {
          status: res.status,
          data: res.data,
          headers: normalizeHeaders(res.headers),
        };
      } catch (err) {
        const status = isAxiosError(err) ? err.response?.status : undefined;
        lastStatus = status;
        lastMessage = err instanceof Error ? err.message : String(err);

        const retryable =
          status !== undefined && this.retryStatuses.includes(status);
        if (retryable && attempt < this.retries) {
          await sleep(this.retryDelayMs);
          continue;
        }
        break;
      }
    }

    throw new HttpClientError(lastMessage, {
      ...(lastStatus !== undefined ? { status: lastStatus } : {}),
      url: req.url,
      method,
    });
  }
}

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (headers && typeof (headers as { toJSON?: unknown }).toJSON === 'function') {
    const json = (headers as { toJSON: () => Record<string, unknown> }).toJSON();
    for (const [k, v] of Object.entries(json)) out[k] = String(v);
    return out;
  }
  if (typeof headers === 'object' && headers !== null) {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      out[k] = String(v);
    }
  }
  return out;
};
