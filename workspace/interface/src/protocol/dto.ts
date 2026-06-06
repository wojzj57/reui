/**
 * 跨 Runtime / @reui/core 边界共享的数据传输对象（RFC-003）。
 *
 * 这些类型描述的是「业务语义负载」，而非协议信封本身（信封在 messages.ts）。
 * 集中放在 @reui/interface，保证 Runtime 侧 service 与 iframe 侧 SDK 模块
 * 对同一份结构达成共识——避免双写漂移（与 AGENTS.md「协议真相源」一致）。
 */

/**
 * 玩家信息（AuthService 持有，`auth:getUser` / `auth:userChanged` 透传）。
 *
 * 注意：此结构**不含 token**——token 严格仅 Runtime 内部使用，永不跨越
 * postMessage 边界（RFC-003 §3.4）。
 */
export interface UserInfo {
  /** 玩家唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** FiveM identifiers，例如 ["steam:xxx", "discord:xxx"] */
  identifiers: string[];
  /** 头像 URL（可选） */
  avatar?: string;
  /** 业务方扩展字段 */
  [key: string]: unknown;
}

/**
 * WebSocketManager 连接状态（RFC-003 §3.2）。
 * `ws:state` 查询与 `ws:stateChanged` 推送均使用此字面量集合。
 */
export const WS_STATES = [
  'connecting',
  'connected',
  'disconnected',
  'reconnecting',
] as const;

export type WSState = (typeof WS_STATES)[number];
