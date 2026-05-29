/**
 * Manifest 嵌入式签名（RFC-002 §4.2）。
 *
 * 设计原则：
 *   1. 仅对 SecuredFields 子集签名——name/display/defaultHotkey 等"显示性"字段
 *      允许被修改，不会破坏签名（§4.2.1）；
 *   2. 序列化前必须经 `normalizeForSigning` 规范化：固定 key 顺序 + 数组排序，
 *      避免 JSON.stringify 在不同实现下产生不同字节序；
 *   3. 验证使用 timingSafeEqual 抵御时序攻击（§4.2.2）；
 *   4. 密钥仅存在于构建端 / 服务端，**永远不传给客户端 / CEF**。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PluginManifest } from './schema/plugin-manifest';

/** 写入 plugin.json 的签名块（RFC-002 §3.1.1）。 */
export interface ManifestLock {
  /** Lock 结构版本，当前固定为 1。 */
  version: 1;
  /** 签名时间（ISO 8601）。 */
  signedAt: string;
  /** 当前仅支持 hmac-sha256。 */
  algorithm: 'hmac-sha256';
  /** hex 编码的 HMAC 摘要。 */
  signature: string;
}

/** 进入签名计算的"安全字段"子集（§4.2.1）。 */
export interface SecuredFields {
  id: string;
  version: string;
  entry: string;
  layer: 'hud' | 'panel' | 'overlay';
  permissions: string[];
  roleRestriction: string[];
  enabled: boolean;
}

/** 已签名 manifest 的类型化形态。 */
export type SignedPluginManifest = PluginManifest & { _lock: ManifestLock };

/**
 * 提取签名所覆盖的字段。
 * - permissions / roleRestriction 默认 []，enabled 默认 true，与 RFC 一致；
 * - 这里只提取，不排序——排序统一交给 `normalizeForSigning`。
 */
export function extractSecuredFields(manifest: PluginManifest): SecuredFields {
  return {
    id: manifest.id,
    version: manifest.version,
    entry: manifest.entry,
    layer: manifest.layer,
    permissions: manifest.permissions ?? [],
    roleRestriction: manifest.roleRestriction ?? [],
    enabled: manifest.enabled ?? true,
  };
}

/**
 * 规范化为确定性结构（§4.2.2）。
 *
 * - 字段顺序固定（按声明顺序）；
 * - 数组排序（permissions / roleRestriction）保证语义等价时签名一致；
 * - 不复制 source 引用，避免外部突变后续影响。
 */
export function normalizeForSigning(secured: SecuredFields): SecuredFields {
  return {
    id: secured.id,
    version: secured.version,
    entry: secured.entry,
    layer: secured.layer,
    permissions: [...secured.permissions].sort(),
    roleRestriction: [...secured.roleRestriction].sort(),
    enabled: secured.enabled,
  };
}

/**
 * 计算签名 hex（不含时间戳）。可单独使用以做"重计算并比较"。
 */
export function computeSignature(manifest: PluginManifest, secretKey: string): string {
  if (!secretKey) {
    throw new Error('[ReUI] sign key is empty — refuse to compute signature');
  }
  const normalized = normalizeForSigning(extractSecuredFields(manifest));
  // 注意：`JSON.stringify` 在所有 V8 实现下对纯对象按声明顺序序列化；
  // 因为我们使用对象字面量构造 normalized，字段顺序与声明顺序一致。
  const payload = JSON.stringify(normalized);
  return createHmac('sha256', secretKey).update(payload).digest('hex');
}

/**
 * 对 manifest 签名并返回 lock 块（不修改入参）。
 */
export function signManifest(manifest: PluginManifest, secretKey: string): ManifestLock {
  const signature = computeSignature(manifest, secretKey);
  return {
    version: 1,
    signedAt: new Date().toISOString(),
    algorithm: 'hmac-sha256',
    signature,
  };
}

/**
 * 在 manifest 上"附加"签名，返回新的 SignedPluginManifest。
 * 不修改入参；用于 CLI 写出 dist/plugin.json 时使用。
 */
export function attachLock(
  manifest: PluginManifest,
  secretKey: string,
): SignedPluginManifest {
  return { ...manifest, _lock: signManifest(manifest, secretKey) };
}

/**
 * 验证 manifest 的 _lock（§4.2.2）。
 *
 * 拒绝条件：
 *   - 缺失 _lock；
 *   - algorithm 不被支持；
 *   - hex 长度不一致 / 解析失败；
 *   - timing-safe 比较不通过。
 */
export function verifyManifest(
  manifest: PluginManifest & { _lock?: ManifestLock },
  secretKey: string,
): boolean {
  const lock = manifest._lock;
  if (!lock || lock.algorithm !== 'hmac-sha256') return false;
  let actual: Buffer;
  try {
    actual = Buffer.from(lock.signature, 'hex');
  } catch {
    return false;
  }
  if (actual.length === 0) return false;

  const expected = Buffer.from(computeSignature(manifest, secretKey), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
