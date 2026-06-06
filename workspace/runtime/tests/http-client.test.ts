/**
 * HttpClient 单元测试（RFC-003 §3.3）。
 *
 * 用注入的 axios 实例 + mock adapter 驱动：拦截器（token 注入）真实运行，
 * 不触达真实网络。覆盖：token 注入、可重试状态码重试、非重试状态码快速失败、
 * 错误归一化、响应头归一化。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { AuthService } from '../src/auth-service';
import { HttpClient, HttpClientError } from '../src/http-client';

interface AdapterScript {
  /** 依次返回的状态码（按调用次序）。 */
  statuses: number[];
  data?: unknown;
}

/** 构造一个记录调用并按脚本返回状态码的 mock adapter。 */
const makeAdapter = (
  script: AdapterScript,
): { adapter: AxiosAdapter; configs: InternalAxiosRequestConfig[] } => {
  const configs: InternalAxiosRequestConfig[] = [];
  let call = 0;
  const adapter: AxiosAdapter = (config) => {
    configs.push(config);
    const status = script.statuses[Math.min(call, script.statuses.length - 1)]!;
    call += 1;
    const res: AxiosResponse = {
      data: script.data ?? { ok: true },
      status,
      statusText: '',
      headers: { 'x-trace': 'abc' },
      config,
    };
    // axios 默认 validateStatus 对 >=300 抛 AxiosError（带 response）。
    if (status >= 200 && status < 300) return Promise.resolve(res);
    return Promise.reject(
      new axios.AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_RESPONSE',
        config,
        {},
        res,
      ),
    );
  };
  return { adapter, configs };
};

const makeClient = (
  script: AdapterScript,
): { client: HttpClient; configs: InternalAxiosRequestConfig[] } => {
  const { adapter, configs } = makeAdapter(script);
  const instance = axios.create({ adapter });
  const client = new HttpClient({ axios: instance });
  return { client, configs };
};

describe('HttpClient', () => {
  beforeEach(() => {
    AuthService.__resetForTests();
  });

  afterEach(() => {
    AuthService.__resetForTests();
    HttpClient.__resetForTests();
  });

  it('should attach Authorization header from AuthService token', async () => {
    // arrange
    AuthService.getInstance().updateToken('secret-xyz');
    const { client, configs } = makeClient({ statuses: [200] });

    // act
    await client.request({ url: '/api/me' });

    // assert
    expect(configs[0]!.headers.get('Authorization')).toBe('Bearer secret-xyz');
  });

  it('should not attach Authorization when no token', async () => {
    // arrange
    const { client, configs } = makeClient({ statuses: [200] });

    // act
    await client.request({ url: '/api/public' });

    // assert
    expect(configs[0]!.headers.get('Authorization')).toBeFalsy();
  });

  it('should return normalized response with status, data and headers', async () => {
    // arrange
    const { client } = makeClient({ statuses: [200], data: { hi: 1 } });

    // act
    const res = await client.request<{ hi: number }>({ url: '/x' });

    // assert
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hi: 1 });
    expect(res.headers).toMatchObject({ 'x-trace': 'abc' });
  });

  it('should retry on retryable status then succeed', async () => {
    // arrange: 先两次 503，再一次 200
    const { client, configs } = makeClient({ statuses: [503, 503, 200] });
    client.configure({ retries: 3, retryDelayMs: 0 });

    // act
    const res = await client.request({ url: '/flaky' });

    // assert
    expect(res.status).toBe(200);
    expect(configs).toHaveLength(3);
  });

  it('should not retry on non-retryable status', async () => {
    // arrange
    const { client, configs } = makeClient({ statuses: [404] });
    client.configure({ retries: 3, retryDelayMs: 0 });

    // act / assert
    await expect(client.request({ url: '/missing' })).rejects.toBeInstanceOf(
      HttpClientError,
    );
    expect(configs).toHaveLength(1);
  });

  it('should throw HttpClientError without status on non-HTTP failure', async () => {
    // arrange: adapter 抛出无 response 的网络错误（如连接被拒）。
    const adapter: AxiosAdapter = () =>
      Promise.reject(new Error('socket hang up'));
    const client = new HttpClient({ axios: axios.create({ adapter }) });
    client.configure({ retries: 0 });

    // act
    let caught: unknown;
    try {
      await client.request({ url: '/down' });
    } catch (e) {
      caught = e;
    }

    // assert
    expect(caught).toBeInstanceOf(HttpClientError);
    const err = caught as HttpClientError;
    expect(err.message).toBe('socket hang up');
    expect(err.details).toEqual({ url: '/down', method: 'GET' });
  });

  it('should throw HttpClientError with status/url/method after retries exhausted', async () => {
    // arrange
    const { client } = makeClient({ statuses: [500] });
    client.configure({ retries: 2, retryDelayMs: 0 });

    // act
    let caught: unknown;
    try {
      await client.request({ method: 'POST', url: '/boom' });
    } catch (e) {
      caught = e;
    }

    // assert
    expect(caught).toBeInstanceOf(HttpClientError);
    const err = caught as HttpClientError;
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.details).toMatchObject({
      status: 500,
      url: '/boom',
      method: 'POST',
    });
  });
});
