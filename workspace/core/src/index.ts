/**
 * @reui/core 包入口（RFC-001 §4.3）。
 *
 * 当前阶段 RFC-001 仅交付通讯核心 `Client`。RFC-003 将在此处补充
 * `event` / `http` / `ws` / `auth` / `nui` / `plugin` 6 个公开模块。
 */

export { Client } from './client';
export type { Handler, InitOptions, Unsubscribe } from './client';
export { ReUIError } from './error';
export {
  HANDSHAKE_MAX_RETRIES,
  HANDSHAKE_RETRY_DELAYS_MS,
  HANDSHAKE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  SDK_VERSION,
} from './constants';

// 重导出协议常量与错误码类型，方便插件方直接使用。
export { PROTOCOL_VERSION } from '@reui/interface';
export type { ErrorCode } from '@reui/interface';

import { Client } from './client';
import type { InitOptions } from './client';

/** 顶层 init —— 走单例，避免插件意外创建多个 Client。 */
export const init = (options?: InitOptions): Promise<void> =>
  Client.getInstance().init(options ?? {});

/** 默认导出单例 Client，供高级用户直接操作。 */
export default Client.getInstance();
