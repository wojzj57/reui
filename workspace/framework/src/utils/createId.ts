/**
 * createId —— 生成唯一 ID（RFC-004 §3.7.5）。
 *
 * 改用 crypto.randomUUID()（避免 Math.random() 碰撞）。
 *
 * @example
 * createId(); // => "a1b2c3d4-e5f6-..."
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 降级方案（旧环境）
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
