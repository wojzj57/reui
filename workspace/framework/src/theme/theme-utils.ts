/**
 * Theme 工具函数（RFC-004 §3.1 / §3.2）。
 *
 * 拆出独立模块的目的：让 deepMerge / camelToKebab / tokensToCssVars
 * 这些纯函数可在 Node 环境下测试，无需挂载 React。
 *
 * - deepMerge：用户主题与默认主题的合并策略
 *     · 对象 → 递归合并；
 *     · 其它（含数组）→ 用户值完整替换；
 *     · undefined → 跳过；
 * - camelToKebab：driveBy / accentHover → drive-by / accent-hover；
 * - tokensToCssVars：把 DesignTokens 摊平为 CSS Custom Properties 对象，
 *   形如 `--reui-color-bg-primary`。
 */

import type { DesignTokens } from './tokens';

/** 类型工具：所有字段都变成可选（递归）。 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  // 排除 Date、RegExp 等特殊对象
  Object.getPrototypeOf(v) === Object.prototype;

/**
 * 深合并：保留 base 中未被 override 的字段。
 * - 数组按"完整替换"语义处理（RFC-004 §3.2 表格）；
 * - undefined 跳过——避免显式传 `undefined` 抹掉默认值；
 * - 不修改 base / override 入参。
 */
export function deepMerge<T extends object>(base: T, override: DeepPartial<T>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const v = (override as Record<string, unknown>)[key];
    if (v === undefined) continue;

    const baseVal = (base as Record<string, unknown>)[key];
    if (isPlainObject(v) && isPlainObject(baseVal)) {
      result[key] = deepMerge(baseVal, v as DeepPartial<typeof baseVal>);
    } else {
      result[key] = v;
    }
  }
  return result as T;
}

/**
 * camelCase → kebab-case。
 * - `bgPrimary` → `bg-primary`；
 * - 已经是 kebab 的字符串原样返回；
 * - 仅处理 ASCII，符合 token key 设计约束。
 */
export function camelToKebab(input: string): string {
  return input.replace(/[A-Z]/g, (m, idx) => (idx === 0 ? m.toLowerCase() : `-${m.toLowerCase()}`));
}

/**
 * 将 DesignTokens 摊平为 CSS Custom Properties 字典，
 * key 形如 `--reui-{category}-{field}`，value 直接是 token 字符串。
 *
 * 仅扁平到一级嵌套——RFC-004 中 token 树都是两层（category.field）。
 * 如果 token 内部嵌套对象（如自定义扩展），会递归追加 path。
 */
export function tokensToCssVars(
  tokens: DesignTokens,
  prefix = '--reui',
): Record<string, string> {
  const out: Record<string, string> = {};
  walk(tokens as unknown as Record<string, unknown>, prefix, out);
  return out;
}

function walk(node: Record<string, unknown>, path: string, out: Record<string, string>): void {
  for (const key of Object.keys(node)) {
    const v = node[key];
    const next = `${path}-${camelToKebab(key)}`;
    if (isPlainObject(v)) {
      walk(v, next, out);
    } else {
      out[next] = String(v);
    }
  }
}

/**
 * 仅返回前缀已存在的 token 字符串值——常用于调试 / Hooks 直接读 token 的辅助。
 */
export function flattenTokens(tokens: DesignTokens): Record<string, string> {
  const out: Record<string, string> = {};
  walk(tokens as unknown as Record<string, unknown>, '', out);
  // 移除前导短横线
  const trimmed: Record<string, string> = {};
  for (const k of Object.keys(out)) trimmed[k.replace(/^-+/, '')] = out[k]!;
  return trimmed;
}
