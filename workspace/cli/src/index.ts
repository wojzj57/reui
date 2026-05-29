/**
 * @reui/cli 包入口（RFC-002 + RFC-005）。
 *
 * 当前阶段交付：
 *   - schema：plugin.json 的 Zod schema 与类型（已存在）
 *   - validator：校验 + Runtime 主配置覆盖 + 角色检查
 *   - signer：HMAC-SHA256 嵌入式签名
 *   - permission：运行时权限匹配
 */

export * from './schema';
export * from './validator';
export * from './signer';
export * from './permission';
