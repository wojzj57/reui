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
 *   形如 `--reui-color-bg-primary`（注意：分类前缀为单数 `color`，
 *   与 RFC-004 §3.1 保持一致）。
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
 * 已知 DesignTokens 分类 → CSS 变量分类前缀（单数）。
 * 对齐 RFC-004 §3.1 的命名约定：`--reui-color-*` / `--reui-font-size-*` 等。
 */
const CATEGORY_PREFIX: Record<keyof DesignTokens, string> = {
  colors: 'color',
  spacing: 'spacing',
  radius: 'radius',
  fontSize: 'font-size',
  animation: 'animation',
  shadow: 'shadow',
};

/**
 * 将 DesignTokens 摊平为 CSS Custom Properties 字典，
 * key 形如 `--reui-{category}-{field}`，value 直接是 token 字符串。
 *
 * 已知分类（colors / spacing / radius / fontSize / animation / shadow）
 * 走 CATEGORY_PREFIX 映射，输出单数前缀（color / font-size / ...）。
 * 未知顶层键（例如测试注入的 `extra: 42`）走 fallback：
 *   - 原始值 → `${prefix}-${camelToKebab(key)}`；
 *   - 嵌套对象 → 递归 walk，保持原 "stringify 非 string 叶子" 契约。
 */
export function tokensToCssVars(
  tokens: DesignTokens,
  prefix = '--reui',
): Record<string, string> {
  const out: Record<string, string> = {};
  const node = tokens as unknown as Record<string, unknown>;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (key in CATEGORY_PREFIX && isPlainObject(v)) {
      const category = CATEGORY_PREFIX[key as keyof DesignTokens];
      for (const field of Object.keys(v)) {
        out[`${prefix}-${category}-${camelToKebab(field)}`] = String(v[field]);
      }
    } else if (isPlainObject(v)) {
      walk(v, `${prefix}-${camelToKebab(key)}`, out);
    } else {
      out[`${prefix}-${camelToKebab(key)}`] = String(v);
    }
  }
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
