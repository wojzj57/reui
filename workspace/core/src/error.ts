/**
 * ReUI 标准错误类（RFC-001 §4.3）。
 *
 * 所有 SDK 抛出 / reject 的错误都必须是 `ReUIError` 的实例，便于：
 *   1. 调用方通过 `instanceof ReUIError` 精确捕获；
 *   2. 通过 `code` 字段对接 RFC-001 §4.2 错误码枚举；
 *   3. 通过 `method` 字段定位是哪一次调用失败；
 *   4. 通过 `details` 字段读取额外的诊断信息（例如 Runtime 返回的 details）。
 */

import type { ErrorCode } from '@reui/interface';

export class ReUIError extends Error {
  /** RFC-001 §4.2 错误码。 */
  readonly code: ErrorCode;
  /** 触发错误的方法名（method）或语义阶段（如 `'handshake'`）。 */
  readonly method: string;
  /** 服务端附带的额外信息（来自 ResponseMessage.error.details）。 */
  readonly details?: unknown;

  constructor(code: ErrorCode, method: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ReUIError';
    this.code = code;
    this.method = method;
    if (details !== undefined) this.details = details;

    // 保证 `instanceof ReUIError` 在被打包/转译后仍然成立。
    Object.setPrototypeOf(this, ReUIError.prototype);
  }
}
