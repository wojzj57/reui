/**
 * id.ts —— 通用 ID 生成模块（RFC-004 §3.7.5）。
 *
 * 统一导出 createId 及其他 ID 相关工具函数。
 * 新代码应从此模块导入，而非直接从 createId.ts 导入。
 */

export { createId } from './createId';

/**
 * 生成短 ID（8 位随机字符串，用于非唯一性要求的场景）。
 *
 * @example
 * createShortId(); // => "a1b2c3d4"
 */
export function createShortId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 生成数字 ID（时间戳 + 随机数，用于需要数字 ID 的场景）。
 *
 * @example
 * createNumericId(); // => 1698765432123
 */
export function createNumericId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}
