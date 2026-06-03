/**
 * Vite plugin for ReUI — dev server HMR + build-time signing.
 *
 * - `configureServer`: watches plugin.json changes under basePath via
 *   Vite's built-in `server.watcher` (chokidar wrapper); re-validates
 *   the affected plugin and pushes results to the browser overlay / ws clients.
 * - `closeBundle`: when `signOnBuild` is true, calls `signProject`
 *   (from ../project.js) to write dist/plugin.json.
 *
 * This module deliberately avoids importing `vite` as a runtime dep.
 * Vite types are consumed via `devDependencies` + `peerDependenciesMeta`.
 */
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { scanPlugins } from '../scanner.js';
import { validateManifest } from '../validator.js';
import { signProject, type SignedOutput, type ProjectIssue } from '../project.js';

export interface VitePluginReUIOptions {
  // Project root containing plugin.json. Defaults to Vite's `config.root`.
  basePath?: string;
  // Glob patterns to watch for plugin.json / source changes.
  // Default `['**\/plugin.json', 'src/**/*']`.
  watch?: string[];
  // Whether to sign on `vite build`. Default true.
  signOnBuild?: boolean;
  // Sign key (raw). Falls back to `keyEnv` env var, then REUI_SIGN_KEY.
  // Required when signOnBuild=true.
  key?: string;
  // Env var name to read the sign key from. Default 'REUI_SIGN_KEY'.
  keyEnv?: string;
  // When true, allow signing high-privilege plugins without prompt (CI).
  // Default false.
  allowHighPrivilege?: boolean;
}

const DEFAULT_WATCH = ['**\/plugin.json', 'src/**/*'];

function resolveBasePath(opts: VitePluginReUIOptions, config: ResolvedConfig): string {
  if (opts.basePath) return opts.basePath;
  if (config.root) return config.root;
  return process.cwd();
}

/**
 * Debounce helper — returns a function that delays `fn` until `ms` have
 * elapsed since the last call. Single-flight per timer.
 */
function debounce(
  fn: (filePath: string) => Promise<void>,
  ms: number,
): (filePath: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (filePath: string) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { void fn(filePath); }, ms);
  };
}

export function vitePluginReUI(options: VitePluginReUIOptions = {}): Plugin {
  const {
    watch = DEFAULT_WATCH,
    signOnBuild = true,
    key,
    keyEnv = 'REUI_SIGN_KEY',
    allowHighPrivilege = false,
  } = options;

  let resolvedBasePath: string | undefined;
  let resolvedKey: string | undefined;
  let server: ViteDevServer | undefined;

  function resolveSignKey(): string | undefined {
    if (key !== undefined && key !== '') return key;
    const envKey = process.env[keyEnv!];
    if (envKey !== undefined && envKey !== '') return envKey;
    const fallback = process.env.REUI_SIGN_KEY;
    if (fallback !== undefined && fallback !== '') return fallback;
    return undefined;
  }

  return {
    name: 'reui',

    configResolved(config) {
      resolvedBasePath = resolveBasePath(options, config);
    },

    async buildStart() {
      const { plugins, errors } = scanPlugins(resolvedBasePath!);
      const allIssues: { pluginId: string; message: string }[] = [];

      for (const err of errors) {
        if (err.kind === 'MISSING') continue;
        allIssues.push({ pluginId: path.basename(err.basePath), message: err.message });
      }

      for (const p of plugins) {
        const v = validateManifest(p.manifest);
        if (!v.valid) {
          for (const iss of v.issues) {
            allIssues.push({
              pluginId: String(p.manifest.id ?? path.basename(p.basePath)),
              message: `${iss.path}: ${iss.message}`,
            });
          }
        }
      }

      if (allIssues.length > 0) {
        const messages = allIssues
          .map((i) => `  [${i.pluginId}] ${i.message}`)
          .join('\n');
        this.error(`ReUI validation failed:\n${messages}`);
      }
    },

    configureServer(devServer) {
      server = devServer;
      const watcher = devServer.watcher;
      const base = resolvedBasePath!;

      // Debounced re-validation of a single plugin directory.
      const revalidate = debounce(async (pluginJsonPath: string) => {
        // Derive plugin id from the directory containing plugin.json.
        const dir = path.dirname(pluginJsonPath);
        const id = path.basename(dir);

        const { plugins, errors } = scanPlugins(base);
        const allIssues: { pluginId: string; message: string }[] = [];
        for (const err of errors) {
          if (err.kind === 'MISSING') continue;
          allIssues.push({ pluginId: path.basename(err.basePath), message: err.message });
        }
        for (const p of plugins) {
          const v = validateManifest(p.manifest);
          if (!v.valid) {
            for (const iss of v.issues) {
              allIssues.push({
                pluginId: String(p.manifest.id ?? path.basename(p.basePath)),
                message: `${iss.path}: ${iss.message}`,
              });
            }
          }
        }

        if (allIssues.length > 0) {
          devServer.ws.send({
            type: 'error',
            err: { message: allIssues.map(i => `  [${i.pluginId}] ${i.message}`).join('\n'), stack: '' },
          });
          return;
        }

        const target = plugins.find((p: { manifest: { id?: string } }) => p.manifest.id === id);
        if (!target) {
          // Plugin directory removed — broadcast change.
          const all = scanPlugins(base);
          devServer.ws.send({
            type: 'custom',
            event: 'reui:plugins-changed',
            data: { plugins: all.plugins.map((p: { manifest: { id?: string; layer?: string } }) => ({ id: p.manifest.id ?? '', layer: p.manifest.layer ?? '' })) },
          });
          return;
        }

        devServer.ws.send({
          type: 'custom',
          event: 'reui:plugin-updated',
          data: { id: target.manifest.id ?? '', layer: target.manifest.layer ?? '', version: target.manifest.version ?? '' },
        });
      }, 250);

      watcher.on('change', (filePath: string) => {
        if (!filePath.endsWith('plugin.json')) return;
        const rel = path.relative(base, filePath);
        if (rel.startsWith('..')) return;
        revalidate(filePath);
      });

      watcher.on('add', (filePath: string) => {
        if (!filePath.endsWith('plugin.json')) return;
        const rel = path.relative(resolvedBasePath!, filePath);
        if (rel.startsWith('..')) return;
        // New plugin — broadcast full list.
        const { plugins: allPlugins } = scanPlugins(resolvedBasePath!);
        devServer.ws.send({
          type: 'custom',
          event: 'reui:plugins-changed',
          data: { plugins: allPlugins.map((p: { manifest: { id?: string; layer?: string } }) => ({ id: p.manifest.id ?? '', layer: p.manifest.layer ?? '' })) },
        });
      });

      watcher.on('unlink', (filePath: string) => {
        if (!filePath.endsWith('plugin.json')) return;
        const rel = path.relative(resolvedBasePath!, filePath);
        if (rel.startsWith('..')) return;
        const { plugins: allPlugins } = scanPlugins(resolvedBasePath!);
        devServer.ws.send({
          type: 'custom',
          event: 'reui:plugins-changed',
          data: { plugins: allPlugins.map((p: { manifest: { id?: string; layer?: string } }) => ({ id: p.manifest.id ?? '', layer: p.manifest.layer ?? '' })) },
        });
      });
    },

    async closeBundle() {
      if (!signOnBuild) return;

      resolvedKey = resolveSignKey();
      if (resolvedKey === undefined) {
        this.error(
          'REUI sign key missing: pass `key` option or set `' + keyEnv + '` env var.',
        );
        return;
      }

      const scanned = scanPlugins(resolvedBasePath!);
      try {
        signProject(scanned, {
          secretKey: resolvedKey,
          confirmedHighPrivilege: allowHighPrivilege ? new Set<string>() : undefined,
        });
      } catch (err) {
        this.error(`ReUI signing failed: ${(err as Error).message}`);
      }
    },
  };
}
