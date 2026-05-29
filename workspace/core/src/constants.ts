/**
 * SDK 内部常量（RFC-001 §3.5 / §3.6）。
 *
 * 所有时间相关常量集中在此处，便于测试用 `vi.useFakeTimers` 推进。
 */

/** SDK 版本号。手动维护，构建脚本可在发布前覆盖。 */
export const SDK_VERSION = '0.0.0-dev';

/** 单次握手等待 ack/reject 的超时（ms）。 */
export const HANDSHAKE_TIMEOUT_MS = 5_000;

/** 握手最大重试次数（不含首次）。 */
export const HANDSHAKE_MAX_RETRIES = 3;

/**
 * 握手指数退避间隔（ms）。
 * RFC-001 §3.6 指定的 1s / 2s / 4s 序列。
 */
export const HANDSHAKE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** 单次 `request` 的默认超时（ms）。 */
export const REQUEST_TIMEOUT_MS = 30_000;
