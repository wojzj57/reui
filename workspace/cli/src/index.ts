/**
 * @reui/cli 包入口（RFC-002 + RFC-005）。
 *
 * 当前阶段交付：
 *   - schema：plugin.json 的 Zod schema 与类型（已存在）
 *   - validator：校验 + Runtime 主配置覆盖 + 角色检查（RFC-002）
 *   - signer：HMAC-SHA256 嵌入式签名（RFC-002）
 *   - permission：运行时权限匹配（RFC-002）
 *   - scanner：插件目录扫描器（RFC-005 §3.2）
 *   - project：sign / verify 项目级流水线（RFC-005 §3.2.1 / §3.2.2）
 */

export * from './schema';
export * from './validator';
export * from './signer';
export * from './permission';
export * from './scanner';
export * from './project';
