/**
 * Manifest 校验工具（RFC-002 §3.3 + §4.1）。
 *
 * 提供：
 *   - validateManifest：包装 Zod 解析，返回结构化结果（成功载荷或错误列表）
 *   - applyOverrides：用 Runtime 主配置覆盖 manifest 字段（RFC-002 §3.3 「Runtime 主配置覆盖」）
 *   - checkRoleAccess：基于 OR 逻辑判断用户角色是否满足插件 roleRestriction（§3.4.4）
 */

import { PluginManifestSchema } from './schema/plugin-manifest';
import type { PluginManifest } from './schema/plugin-manifest';

/** 校验失败的字段错误描述。 */
export interface ValidationIssue {
  /** 错误路径（点分），如 `"display.zOffset"`。 */
  path: string;
  /** Zod 校验信息。 */
  message: string;
}

/** 校验结果：成功携带 parsed manifest，失败携带 issue 列表。 */
export type ValidationResult =
  | { valid: true; manifest: PluginManifest }
  | { valid: false; issues: ValidationIssue[] };

/**
 * 校验 plugin.json（RFC-002 §3.3 step 1）。
 *
 * - 失败时不抛错，返回 `{ valid: false, issues }` 让上游决定如何处理；
 *   保证一个插件的格式错误不会中断整个加载管道。
 */
export function validateManifest(input: unknown): ValidationResult {
  const result = PluginManifestSchema.safeParse(input);
  if (result.success) {
    return { valid: true, manifest: result.data };
  }
  const issues: ValidationIssue[] = result.error.errors.map((err) => ({
    path: err.path.join('.'),
    message: err.message,
  }));
  return { valid: false, issues };
}

/** Runtime 配置中允许覆盖的字段子集（RFC-002 §3.3）。 */
export interface ManifestOverride {
  enabled?: boolean;
  defaultHotkey?: string;
  display?: PluginManifest['display'];
}

/** 全局 runtime.config.json 的形态（仅本 RFC 关心的部分）。 */
export interface RuntimeConfig {
  plugins?: {
    /** 整体禁用所有插件。 */
    disableAll?: boolean;
    /** 按 pluginId 进行字段级覆盖。 */
    overrides?: Record<string, ManifestOverride | undefined>;
  };
}

/**
 * 应用 Runtime 主配置覆盖（RFC-002 §3.3）。
 *
 * 优先级：runtime.config.json > plugin.json。
 * - 若 `disableAll` 为 true，所有插件强制 `enabled = false`；
 * - 否则只在显式提供时覆盖，未提供字段保持原值。
 */
export function applyOverrides(
  manifest: PluginManifest,
  config: RuntimeConfig | undefined,
): PluginManifest {
  const pluginCfg = config?.plugins;
  if (!pluginCfg) return manifest;

  const override = pluginCfg.overrides?.[manifest.id];
  const result: PluginManifest = { ...manifest };

  if (pluginCfg.disableAll) {
    result.enabled = false;
  }
  if (override) {
    if (override.enabled !== undefined) result.enabled = override.enabled;
    if (override.defaultHotkey !== undefined) result.defaultHotkey = override.defaultHotkey;
    if (override.display !== undefined) {
      result.display = { ...(manifest.display ?? {}), ...override.display };
    }
  }
  return result;
}

/**
 * 判断用户角色是否能加载该插件（RFC-002 §3.4.4）。
 *
 * - 未配置 / 空数组 `roleRestriction` → 不限制，任何用户均可加载；
 * - 非空 → OR 逻辑：用户至少拥有一个匹配角色即可。
 */
export function checkRoleAccess(
  manifest: Pick<PluginManifest, 'roleRestriction'>,
  userRoles: readonly string[],
): boolean {
  const required = manifest.roleRestriction;
  if (!required || required.length === 0) return true;
  return required.some((r) => userRoles.includes(r));
}
