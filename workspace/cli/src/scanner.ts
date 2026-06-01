/**
 * Plugin 目录扫描器（RFC-005 §3.2.1 + §3.2.2 共享逻辑）。
 *
 * 设计意图：
 *   - 与文件系统的耦合**只在此处**——signer / validator 接受纯数据，
 *     方便单元测试用 fixture 而不需要真实 fs；
 *   - 失败采用"软失败"——单个 plugin.json 解析失败不会中断整轮扫描，
 *     而是返回一条 ScanError 让上层（CLI / Vite plugin）决定如何呈现；
 *   - 不调用 validateManifest——是否做 schema 校验由上层流水线决定。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginManifest } from './schema/plugin-manifest';

/** 单条扫描结果。 */
export interface ScanResult {
  /** 插件根目录的绝对/相对路径。 */
  basePath: string;
  /** 解析得到的 manifest（未做 Zod 校验）。 */
  manifest: PluginManifest & { _lock?: unknown };
}

/** 扫描过程中的非致命错误。 */
export interface ScanError {
  basePath: string;
  /** 错误归类：`READ` / `JSON` / `MISSING`。 */
  kind: 'READ' | 'JSON' | 'MISSING';
  message: string;
}

/** 扫描配置。 */
export interface ScanOptions {
  /**
   * 扫描已签名产物 `dist/plugin.json`（用于 `reui verify`）。
   * 默认 false，扫描源 `plugin.json`（用于 `reui sign / validate`）。
   */
  signed?: boolean;
  /**
   * 注入文件系统读写——便于单元测试 mock。
   * 默认使用 `node:fs`。
   */
  fs?: ScanFs;
}

/** 注入式 fs 接口——只用到 readdir / stat / readFile。 */
export interface ScanFs {
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { isDirectory(): boolean };
  readFileSync: (path: string, encoding: 'utf-8') => string;
}

const defaultFs: ScanFs = {
  readdirSync: (p) => readdirSync(p),
  statSync: (p) => statSync(p),
  readFileSync: (p, e) => readFileSync(p, e),
};

/**
 * 扫描 `pluginsDir` 下的全部插件目录。
 *
 * 约定：插件 = 含 `plugin.json` 的一级子目录；
 * 该目录下其它内容（vite.config / package.json 等）由 build 工具自行读取。
 */
export function scanPlugins(
  pluginsDir: string,
  options: ScanOptions = {},
): { plugins: ScanResult[]; errors: ScanError[] } {
  const fs = options.fs ?? defaultFs;
  const filename = options.signed ? join('dist', 'plugin.json') : 'plugin.json';

  const plugins: ScanResult[] = [];
  const errors: ScanError[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(pluginsDir);
  } catch (err) {
    return {
      plugins,
      errors: [
        {
          basePath: pluginsDir,
          kind: 'READ',
          message: `Cannot read pluginsDir: ${(err as Error).message}`,
        },
      ],
    };
  }

  for (const entry of entries) {
    const dir = join(pluginsDir, entry);
    let isDir = false;
    try {
      isDir = fs.statSync(dir).isDirectory();
    } catch {
      // entry 已不存在或无法 stat：忽略，扫描继续
      continue;
    }
    if (!isDir) continue;

    const manifestPath = join(dir, filename);
    let raw: string;
    try {
      raw = fs.readFileSync(manifestPath, 'utf-8');
    } catch {
      // 没有 plugin.json：当前目录不是插件，跳过；不视为错误。
      // 唯一例外：signed=true 但目录有 plugin.json 但没有 dist/plugin.json，
      // 由调用方用 validate + diff 来诊断，不在此报错。
      errors.push({
        basePath: dir,
        kind: 'MISSING',
        message: `${filename} not found`,
      });
      continue;
    }

    let manifest: ScanResult['manifest'];
    try {
      manifest = JSON.parse(raw) as ScanResult['manifest'];
    } catch (err) {
      errors.push({
        basePath: dir,
        kind: 'JSON',
        message: `Failed to parse ${filename}: ${(err as Error).message}`,
      });
      continue;
    }
    plugins.push({ basePath: dir, manifest });
  }

  return { plugins, errors };
}
