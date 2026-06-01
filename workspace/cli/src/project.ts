/**
 * Project-level CLI 命令的纯逻辑实现（RFC-005 §3.2）。
 *
 * 把"读取 → 校验 → 签名/验证 → 汇总报告"这条流水线抽出，
 * 让 CLI 入口只负责 IO/着色/退出码，上面这层用纯数据测试。
 */

import { validateManifest } from './validator';
import { attachLock, verifyManifest } from './signer';
import type { ScanError, ScanResult } from './scanner';
import type { PluginManifest } from './schema/plugin-manifest';
import type { ManifestLock } from './signer';

/** 单个插件的处理结果。 */
export type ProjectIssue =
  | { kind: 'scan'; basePath: string; reason: string }
  | { kind: 'invalid'; basePath: string; pluginId: string; issues: { path: string; message: string }[] }
  | { kind: 'high-privilege'; basePath: string; pluginId: string; permissions: string[] }
  | { kind: 'unsigned'; basePath: string; pluginId: string }
  | { kind: 'tampered'; basePath: string; pluginId: string }
  | { kind: 'unsupported-algorithm'; basePath: string; pluginId: string };

/** 已签名的 manifest 输出，便于测试断言或 CLI 写盘。 */
export interface SignedOutput {
  basePath: string;
  pluginId: string;
  signed: PluginManifest & { _lock: ManifestLock };
  highPrivilege: boolean;
}

/** sign 命令的运行结果。 */
export interface SignProjectResult {
  signed: SignedOutput[];
  issues: ProjectIssue[];
}

/** RFC-005 §3.2.1 「高权限」识别——`runtime.all` 与 `plugins.all`。 */
const HIGH_PRIVILEGE = new Set(['runtime.all', 'plugins.all']);

function detectHighPrivilege(manifest: PluginManifest): string[] {
  const ps = manifest.permissions ?? [];
  return ps.filter((p) => HIGH_PRIVILEGE.has(p));
}

/**
 * 对扫描结果批量签名。
 *
 * - 调用方负责扫描（scanner.scanPlugins），把 errors 传入 `scanErrors`；
 * - schema 校验失败 → `invalid` issue，**不签名**该插件；
 * - 高权限 + 未确认 → `high-privilege` issue，仍输出签名结果，
 *   由 CLI 决定是否在交互模式下中止；
 * - 不修改入参，签名后的对象通过 `signed` 数组返回。
 */
export function signProject(
  scanned: { plugins: ScanResult[]; errors: ScanError[] },
  options: {
    secretKey: string;
    /** 已通过交互或 --yes 确认的高权限 plugin id 集合。 */
    confirmedHighPrivilege?: ReadonlySet<string>;
  },
): SignProjectResult {
  if (!options.secretKey) {
    throw new Error('[ReUI] sign requires a non-empty secretKey');
  }

  const signed: SignedOutput[] = [];
  const issues: ProjectIssue[] = [];

  for (const err of scanned.errors) {
    if (err.kind === 'MISSING') continue; // 缺 plugin.json 不是错误，跳过
    issues.push({ kind: 'scan', basePath: err.basePath, reason: err.message });
  }

  const confirmed = options.confirmedHighPrivilege ?? new Set<string>();

  for (const { basePath, manifest } of scanned.plugins) {
    const v = validateManifest(manifest);
    if (!v.valid) {
      issues.push({
        kind: 'invalid',
        basePath,
        pluginId: typeof manifest.id === 'string' ? manifest.id : '<unknown>',
        issues: v.issues,
      });
      continue;
    }
    const high = detectHighPrivilege(v.manifest);
    const highPrivilege = high.length > 0;
    if (highPrivilege && !confirmed.has(v.manifest.id)) {
      issues.push({
        kind: 'high-privilege',
        basePath,
        pluginId: v.manifest.id,
        permissions: high,
      });
    }
    signed.push({
      basePath,
      pluginId: v.manifest.id,
      signed: attachLock(v.manifest, options.secretKey),
      highPrivilege,
    });
  }

  return { signed, issues };
}

/** verify 命令的运行结果。 */
export interface VerifyProjectResult {
  /** 通过验证的插件。 */
  passed: { basePath: string; pluginId: string }[];
  /** 未通过的插件（细节见 issues）。 */
  issues: ProjectIssue[];
}

/**
 * 验证已签名的 dist/plugin.json 是否被篡改。
 *
 * 规则：
 *   - 缺 `_lock` → `unsigned`；
 *   - algorithm 不支持 → `unsupported-algorithm`；
 *   - 重新计算签名不一致 → `tampered`；
 *   - schema 校验失败 → `invalid`（已签名产物理论不应失败，但仍纳入兜底）。
 */
export function verifyProject(
  scanned: { plugins: ScanResult[]; errors: ScanError[] },
  options: { secretKey: string },
): VerifyProjectResult {
  const passed: VerifyProjectResult['passed'] = [];
  const issues: ProjectIssue[] = [];

  for (const err of scanned.errors) {
    if (err.kind === 'MISSING') continue;
    issues.push({ kind: 'scan', basePath: err.basePath, reason: err.message });
  }

  for (const { basePath, manifest } of scanned.plugins) {
    const v = validateManifest(manifest);
    if (!v.valid) {
      issues.push({
        kind: 'invalid',
        basePath,
        pluginId: typeof manifest.id === 'string' ? manifest.id : '<unknown>',
        issues: v.issues,
      });
      continue;
    }
    const lock = (manifest as { _lock?: ManifestLock })._lock;
    if (!lock) {
      issues.push({ kind: 'unsigned', basePath, pluginId: v.manifest.id });
      continue;
    }
    if (lock.algorithm !== 'hmac-sha256') {
      issues.push({
        kind: 'unsupported-algorithm',
        basePath,
        pluginId: v.manifest.id,
      });
      continue;
    }
    const ok = verifyManifest(
      manifest as PluginManifest & { _lock: ManifestLock },
      options.secretKey,
    );
    if (!ok) {
      issues.push({ kind: 'tampered', basePath, pluginId: v.manifest.id });
      continue;
    }
    passed.push({ basePath, pluginId: v.manifest.id });
  }

  return { passed, issues };
}
