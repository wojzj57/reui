/**
 * CLI command runners (RFC-005 §3.2 / §3.4).
 *
 * Each `run*` function is a thin shell over the pure APIs in scanner /
 * validator / project; it owns argument parsing, IO and exit-code mapping
 * but **never** re-implements signing / verification logic.
 *
 * IO is injectable (`stdout` / `stderr`) so tests can capture output without
 * spawning a subprocess. File-system access stays as `node:fs` because CLI
 * tests use real temp directories — that is the intended end-to-end shape.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { scanPlugins } from '../scanner';
import { validateManifest } from '../validator';
import { signProject, verifyProject } from '../project';
import type { ProjectIssue } from '../project';
import type { PluginManifest } from '../schema/plugin-manifest';

// ─── IO interface ────────────────────────────────────────────────────────────

/** Minimal write sink — matches `process.stdout.write` / `console.log` shim. */
export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIO: CliIO = {
  stdout: (line) => process.stdout.write(line + '\n'),
  stderr: (line) => process.stderr.write(line + '\n'),
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Resolve key from --key / --key-env / REUI_SIGN_KEY. Empty string = missing. */
function resolveKey(opts: {
  key?: string;
  keyEnv?: string;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const env = opts.env ?? process.env;
  if (opts.key && opts.key.length > 0) return opts.key;
  if (opts.keyEnv) {
    const v = env[opts.keyEnv];
    if (v && v.length > 0) return v;
  }
  const fallback = env.REUI_SIGN_KEY;
  if (fallback && fallback.length > 0) return fallback;
  return null;
}

function defaultDir(dir: string | undefined): string {
  return resolve(process.cwd(), dir ?? 'plugins');
}

// ─── validate ────────────────────────────────────────────────────────────────

export interface ValidateOptions {
  dir?: string;
  strict?: boolean;
  io?: CliIO;
}

export async function runValidate(opts: ValidateOptions = {}): Promise<number> {
  const io = opts.io ?? defaultIO;
  const dir = defaultDir(opts.dir);
  const scan = scanPlugins(dir);

  let failures = 0;

  for (const err of scan.errors) {
    if (err.kind === 'MISSING' && !opts.strict) continue;
    io.stdout(`${chalk.red('✗')} ${err.basePath} - ${err.message}`);
    failures += 1;
  }

  for (const { basePath, manifest } of scan.plugins) {
    const v = validateManifest(manifest);
    if (v.valid) {
      io.stdout(`${chalk.green('✓')} ${basePath} - ${v.manifest.id}`);
    } else {
      io.stdout(`${chalk.red('✗')} ${basePath} - INVALID`);
      for (const issue of v.issues) {
        io.stdout(`    • ${issue.path}: ${issue.message}`);
      }
      failures += 1;
    }
  }

  return failures > 0 ? 1 : 0;
}

// ─── sign ────────────────────────────────────────────────────────────────────

export interface SignOptions {
  dir?: string;
  key?: string;
  keyEnv?: string;
  yes?: boolean;
  io?: CliIO;
  env?: NodeJS.ProcessEnv;
}

function printIssues(io: CliIO, issues: ProjectIssue[]): void {
  for (const issue of issues) {
    switch (issue.kind) {
      case 'scan':
        io.stdout(`${chalk.red('✗')} ${issue.basePath} - ${issue.reason}`);
        break;
      case 'invalid':
        io.stdout(`${chalk.red('✗')} ${issue.basePath} - INVALID (${issue.pluginId})`);
        for (const sub of issue.issues) {
          io.stdout(`    • ${sub.path}: ${sub.message}`);
        }
        break;
      case 'high-privilege':
        io.stdout(
          `${chalk.yellow('⚠')} ${issue.pluginId} requires high-privilege permissions: ${issue.permissions.join(
            ', ',
          )}. Re-run with --yes to confirm.`,
        );
        break;
      case 'unsigned':
        io.stdout(`${chalk.red('✗')} ${issue.pluginId} - unsigned`);
        break;
      case 'tampered':
        io.stdout(`${chalk.red('✗')} ${issue.pluginId} - tampered`);
        break;
      case 'unsupported-algorithm':
        io.stdout(`${chalk.red('✗')} ${issue.pluginId} - unsupported-algorithm`);
        break;
    }
  }
}

export async function runSign(opts: SignOptions = {}): Promise<number> {
  const io = opts.io ?? defaultIO;
  const key = resolveKey({ key: opts.key, keyEnv: opts.keyEnv, env: opts.env });
  if (!key) {
    io.stderr(
      chalk.red(
        'reui sign requires a signing key (use --key, --key-env, or REUI_SIGN_KEY).',
      ),
    );
    return 1;
  }

  const dir = defaultDir(opts.dir);
  const scanned = scanPlugins(dir);

  // First pass — discover high-privilege plugins.
  const probe = signProject(scanned, { secretKey: key });
  const highIds = new Set(
    probe.issues
      .filter((i): i is Extract<ProjectIssue, { kind: 'high-privilege' }> => i.kind === 'high-privilege')
      .map((i) => i.pluginId),
  );

  if (highIds.size > 0 && !opts.yes) {
    printIssues(io, probe.issues);
    return 2;
  }

  // Either no high-privilege issue, or user confirmed via --yes.
  const final = signProject(scanned, {
    secretKey: key,
    confirmedHighPrivilege: highIds,
  });

  let failed = false;
  for (const issue of final.issues) {
    if (issue.kind === 'high-privilege') continue; // already confirmed
    failed = true;
  }
  printIssues(
    io,
    final.issues.filter((i) => i.kind !== 'high-privilege'),
  );

  for (const out of final.signed) {
    const distDir = join(out.basePath, 'dist');
    mkdirSync(distDir, { recursive: true });
    const target = join(distDir, 'plugin.json');
    writeFileSync(target, JSON.stringify(out.signed, null, 2) + '\n', 'utf8');
    io.stdout(`${chalk.green('✓')} ${out.pluginId} signed → ${target}`);
  }

  return failed ? 1 : 0;
}

// ─── verify ──────────────────────────────────────────────────────────────────

export interface VerifyOptions {
  dir?: string;
  key?: string;
  keyEnv?: string;
  io?: CliIO;
  env?: NodeJS.ProcessEnv;
}

export async function runVerify(opts: VerifyOptions = {}): Promise<number> {
  const io = opts.io ?? defaultIO;
  const key = resolveKey({ key: opts.key, keyEnv: opts.keyEnv, env: opts.env });
  if (!key) {
    io.stderr(
      chalk.red(
        'reui verify requires a signing key (use --key, --key-env, or REUI_SIGN_KEY).',
      ),
    );
    return 1;
  }

  const dir = defaultDir(opts.dir);
  const scanned = scanPlugins(dir, { signed: true });
  const result = verifyProject(scanned, { secretKey: key });

  for (const ok of result.passed) {
    io.stdout(`${chalk.green('✓')} ${ok.pluginId} verified`);
  }
  printIssues(io, result.issues);

  return result.issues.length > 0 ? 1 : 0;
}

// ─── list ────────────────────────────────────────────────────────────────────

export interface ListOptions {
  dir?: string;
  json?: boolean;
  io?: CliIO;
}

interface ListEntry {
  id: string;
  name: string;
  layer: string;
  version: string;
  basePath: string;
  valid: boolean;
  issues?: { path: string; message: string }[];
}

export async function runList(opts: ListOptions = {}): Promise<number> {
  const io = opts.io ?? defaultIO;
  const dir = defaultDir(opts.dir);
  const scanned = scanPlugins(dir);

  const entries: ListEntry[] = [];
  for (const { basePath, manifest } of scanned.plugins) {
    const v = validateManifest(manifest);
    if (v.valid) {
      entries.push({
        id: v.manifest.id,
        name: v.manifest.name,
        layer: v.manifest.layer,
        version: v.manifest.version,
        basePath,
        valid: true,
      });
    } else {
      const m = manifest as Partial<PluginManifest>;
      entries.push({
        id: typeof m.id === 'string' ? m.id : '<unknown>',
        name: typeof m.name === 'string' ? m.name : '<unknown>',
        layer: typeof m.layer === 'string' ? m.layer : '<unknown>',
        version: typeof m.version === 'string' ? m.version : '<unknown>',
        basePath,
        valid: false,
        issues: v.issues,
      });
    }
  }

  if (opts.json) {
    io.stdout(JSON.stringify({ plugins: entries }, null, 2));
    return 0;
  }

  if (entries.length === 0) {
    io.stdout('(no plugins found)');
    return 0;
  }

  const headers = ['ID', 'LAYER', 'VERSION', 'PATH'];
  const rows = entries.map((e) => [e.id, e.layer, e.version, e.basePath]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const fmt = (cols: string[]): string =>
    cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  io.stdout(fmt(headers));
  for (const row of rows) io.stdout(fmt(row));
  return 0;
}

// ─── init ────────────────────────────────────────────────────────────────────

export interface InitOptions {
  name: string;
  layer?: 'hud' | 'panel' | 'overlay';
  dir?: string;
  io?: CliIO;
}

function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function toTitle(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export async function runInit(opts: InitOptions): Promise<number> {
  const io = opts.io ?? defaultIO;
  const id = toKebab(opts.name);
  if (!id) {
    io.stderr(chalk.red(`reui init: invalid plugin name '${opts.name}'`));
    return 1;
  }
  const layer = opts.layer ?? 'panel';
  const pluginsDir = defaultDir(opts.dir);
  const basePath = join(pluginsDir, id);

  if (existsSync(basePath)) {
    io.stderr(chalk.red(`reui init: '${basePath}' already exists`));
    return 1;
  }

  mkdirSync(basePath, { recursive: true });
  const manifest = {
    id,
    name: toTitle(id),
    version: '0.1.0',
    entry: 'index.html',
    layer,
  };
  writeFileSync(
    join(basePath, 'plugin.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(basePath, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>${manifest.name}</title><body><h1>Hello ${manifest.name}</h1>\n`,
    'utf8',
  );

  io.stdout(`${chalk.green('✓')} Created plugin '${id}' at ${basePath}`);
  return 0;
}
