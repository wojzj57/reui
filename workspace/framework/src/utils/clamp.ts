/**
 * clamp —— 数值钳制工具（RFC-004 §3.7.5）。
 *
 * @example
 * clamp(5, 0, 10);  // => 5
 * clamp(-1, 0, 10); // => 0
 * clamp(11, 0, 10); // => 10
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
