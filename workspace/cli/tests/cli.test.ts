/**
 * End-to-end tests for the `reui` CLI command runners (RFC-005 §3.4).
 *
 * Strategy:
 *   - Drive the public `run*` functions directly (no subprocess spawn).
 *   - Use real temp directories — that is the natural seam for CLI tests
 *     and matches how the runners interact with the filesystem.
 *   - Capture stdout/stderr through the injectable CliIO so we can assert
 *     on exact lines without colour codes interfering.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runValidate,
  runSign,
  runVerify,
  runList,
  runInit,
} from '../src/cli/commands';
import type { CliIO } from '../src/cli/commands';
import { signProject } from '../src/project';
import { scanPlugins } from '../src/scanner';

// chalk respects FORCE_COLOR/NO_COLOR; strip ANSI for stable assertions.
const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

interface Captured {
  io: CliIO;
  stdout: string[];
  stderr: string[];
  out(): string;
  err(): string;
}

function capture(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line) => stdout.push(stripAnsi(line)),
      stderr: (line) => stderr.push(stripAnsi(line)),
    },
    stdout,
    stderr,
    out() {
      return stdout.join('\n');
    },
    err() {
      return stderr.join('\n');
    },
  };
}

let cwdSpy: string | null = null;
let originalCwd: string;

function makeTempPlugins(): { root: string; pluginsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'reui-cli-'));
  const pluginsDir = join(root, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  return { root, pluginsDir };
}

function writePlugin(
  pluginsDir: string,
  id: string,
  manifest: Record<string, unknown>,
): string {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  return dir;
}

const validManifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'inv',
  name: 'Inventory',
  version: '1.0.0',
  entry: 'index.html',
  layer: 'panel',
  ...overrides,
});

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  if (cwdSpy && cwdSpy !== originalCwd) {
    try {
      process.chdir(originalCwd);
    } catch {
      // ignore
    }
  }
  cwdSpy = null;
});

describe('runValidate', () => {
  it('should exit 0 and print green check when all manifests are valid', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runValidate({ dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toContain('✓');
    expect(cap.out()).toContain('inv');
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 1 and print INVALID when manifest is missing entry', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'broken', { id: 'broken', name: 'X', version: '1.0.0', layer: 'panel' });
    const cap = capture();

    // act
    const code = await runValidate({ dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toContain('INVALID');
    expect(cap.out()).toContain('entry');
    rmSync(root, { recursive: true, force: true });
  });

  it('should report scan JSON errors as failures', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const dir = join(pluginsDir, 'broken-json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), '{ not valid json', 'utf8');
    const cap = capture();

    // act
    const code = await runValidate({ dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toMatch(/Failed to parse/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('runSign', () => {
  it('should exit 1 with message when no key is provided', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runSign({ dir: pluginsDir, io: cap.io, env: {} });

    // assert
    expect(code).toBe(1);
    expect(cap.err()).toMatch(/requires a signing key/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should sign valid plugin and write dist/plugin.json when key provided', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const base = writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      key: 'sk-test',
      io: cap.io,
      env: {},
    });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/signed/);
    const written = JSON.parse(readFileSync(join(base, 'dist', 'plugin.json'), 'utf8'));
    expect(written._lock.algorithm).toBe('hmac-sha256');
    rmSync(root, { recursive: true, force: true });
  });

  it('should resolve key from --key-env when provided', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      keyEnv: 'MY_KEY',
      io: cap.io,
      env: { MY_KEY: 'sk-from-env' },
    });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/signed/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 2 when high-privilege manifest is detected without --yes', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(
      pluginsDir,
      'admin',
      validManifest({ id: 'admin', permissions: ['runtime.all'] }),
    );
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      key: 'sk-test',
      io: cap.io,
      env: {},
    });

    // assert
    expect(code).toBe(2);
    expect(cap.out()).toMatch(/high-privilege/);
    expect(cap.out()).toMatch(/--yes/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should sign high-privilege manifest when --yes is passed', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const base = writePlugin(
      pluginsDir,
      'admin',
      validManifest({ id: 'admin', permissions: ['runtime.all'] }),
    );
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      key: 'sk-test',
      yes: true,
      io: cap.io,
      env: {},
    });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/admin signed/);
    const written = JSON.parse(readFileSync(join(base, 'dist', 'plugin.json'), 'utf8'));
    expect(written._lock.algorithm).toBe('hmac-sha256');
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 1 and surface scan errors when a plugin.json is malformed JSON', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const dir = join(pluginsDir, 'broken-json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), '{ not valid', 'utf8');
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      key: 'sk-test',
      io: cap.io,
      env: {},
    });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toMatch(/Failed to parse/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 1 and skip writing when manifest is invalid', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'broken', {
      id: 'broken',
      name: 'X',
      version: '1.0.0',
      layer: 'panel',
    });
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      key: 'sk-test',
      io: cap.io,
      env: {},
    });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toMatch(/INVALID/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('runVerify', () => {
  it('should report tampered when dist manifest is mutated post-sign', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const base = writePlugin(pluginsDir, 'inv', validManifest());
    const scanned = scanPlugins(pluginsDir);
    const result = signProject(scanned, { secretKey: 'sk-test' });
    const distDir = join(base, 'dist');
    mkdirSync(distDir, { recursive: true });
    const tampered = { ...result.signed[0]!.signed, entry: 'evil.html' };
    writeFileSync(join(distDir, 'plugin.json'), JSON.stringify(tampered, null, 2), 'utf8');
    const cap = capture();

    // act
    const code = await runVerify({ dir: pluginsDir, key: 'sk-test', io: cap.io, env: {} });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toMatch(/tampered/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should report verified when dist manifest matches signature', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const base = writePlugin(pluginsDir, 'inv', validManifest());
    const scanned = scanPlugins(pluginsDir);
    const result = signProject(scanned, { secretKey: 'sk-test' });
    const distDir = join(base, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, 'plugin.json'),
      JSON.stringify(result.signed[0]!.signed, null, 2),
      'utf8',
    );
    const cap = capture();

    // act
    const code = await runVerify({ dir: pluginsDir, key: 'sk-test', io: cap.io, env: {} });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/verified/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 1 when verify is invoked without a key', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const cap = capture();

    // act
    const code = await runVerify({ dir: pluginsDir, io: cap.io, env: {} });

    // assert
    expect(code).toBe(1);
    expect(cap.err()).toMatch(/requires a signing key/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should report unsigned when dist manifest lacks _lock', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const base = writePlugin(pluginsDir, 'inv', validManifest());
    const distDir = join(base, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, 'plugin.json'),
      JSON.stringify(validManifest(), null, 2),
      'utf8',
    );
    const cap = capture();

    // act
    const code = await runVerify({ dir: pluginsDir, key: 'sk-test', io: cap.io, env: {} });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toMatch(/unsigned/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should report unsupported-algorithm when dist manifest lock uses unknown algorithm', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const base = writePlugin(pluginsDir, 'inv', validManifest());
    const distDir = join(base, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, 'plugin.json'),
      JSON.stringify(
        {
          ...validManifest(),
          _lock: {
            version: 1,
            signedAt: '2025-01-01T00:00:00.000Z',
            algorithm: 'rsa-sha256',
            signature: 'aa',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    const cap = capture();

    // act
    const code = await runVerify({ dir: pluginsDir, key: 'sk-test', io: cap.io, env: {} });

    // assert
    expect(code).toBe(1);
    expect(cap.out()).toMatch(/unsupported-algorithm/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('defaultIO fallback', () => {
  it('should write to process.stdout when no io is injected (runList happy path)', async () => {
    // arrange — capture process.stdout writes by replacing the write fn
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      captured.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stdout.write;

    // act
    const code = await runList({ dir: pluginsDir, json: true });

    // restore
    process.stdout.write = originalWrite;

    // assert
    expect(code).toBe(0);
    expect(captured.join('')).toMatch(/"plugins"/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should write to process.stderr when no io is injected and key missing', async () => {
    // arrange
    const captured: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      captured.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const originalEnv = process.env.REUI_SIGN_KEY;
    delete process.env.REUI_SIGN_KEY;

    // act
    const code = await runSign({ dir: '/__definitely__not__exists__' });

    // restore
    process.stderr.write = originalWrite;
    if (originalEnv !== undefined) process.env.REUI_SIGN_KEY = originalEnv;

    // assert
    expect(code).toBe(1);
    expect(captured.join('')).toMatch(/requires a signing key/);
  });
});

describe('resolveKey precedence', () => {
  it('should prefer --key over --key-env over REUI_SIGN_KEY', async () => {
    // arrange — both env vars set, --key takes precedence
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      key: 'sk-direct',
      keyEnv: 'IGNORED',
      io: cap.io,
      env: { IGNORED: 'env-key', REUI_SIGN_KEY: 'fallback' },
    });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/signed/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should fall back to REUI_SIGN_KEY when --key and --key-env are absent', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runSign({
      dir: pluginsDir,
      io: cap.io,
      env: { REUI_SIGN_KEY: 'sk-fallback' },
    });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/signed/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('runList', () => {
  it('should output valid JSON when --json is passed', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runList({ dir: pluginsDir, json: true, io: cap.io });

    // assert
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].id).toBe('inv');
    expect(parsed.plugins[0].valid).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('should print a text table with column headers by default', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'inv', validManifest());
    const cap = capture();

    // act
    const code = await runList({ dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toMatch(/ID\s+LAYER\s+VERSION\s+PATH/);
    expect(cap.out()).toMatch(/inv\s+panel\s+1\.0\.0/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should mark invalid manifest with valid:false and unknown placeholders for non-string fields', async () => {
    // arrange — every field is the wrong type so the partial-fallback branch runs
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'broken', {
      id: 123,
      name: null,
      version: 5,
      layer: false,
    });
    const cap = capture();

    // act
    const code = await runList({ dir: pluginsDir, json: true, io: cap.io });

    // assert
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.plugins[0].valid).toBe(false);
    expect(parsed.plugins[0].id).toBe('<unknown>');
    expect(parsed.plugins[0].name).toBe('<unknown>');
    expect(parsed.plugins[0].layer).toBe('<unknown>');
    expect(parsed.plugins[0].version).toBe('<unknown>');
    rmSync(root, { recursive: true, force: true });
  });

  it('should mark invalid manifest with valid:false when entry is missing', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    writePlugin(pluginsDir, 'broken', { id: 'broken', name: 'x', version: '1.0.0', layer: 'panel' });
    const cap = capture();

    // act
    const code = await runList({ dir: pluginsDir, json: true, io: cap.io });

    // assert
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.plugins[0].valid).toBe(false);
    expect(parsed.plugins[0].issues.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it('should print "(no plugins found)" when directory is empty', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const cap = capture();

    // act
    const code = await runList({ dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(0);
    expect(cap.out()).toContain('(no plugins found)');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('runInit', () => {
  it('should scaffold a plugin directory with a valid plugin.json', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const cap = capture();

    // act
    const code = await runInit({ name: 'MyPlugin', dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(0);
    const created = join(pluginsDir, 'my-plugin');
    const manifest = JSON.parse(readFileSync(join(created, 'plugin.json'), 'utf8'));
    expect(manifest.id).toBe('my-plugin');
    expect(manifest.name).toBe('My Plugin');
    expect(manifest.layer).toBe('panel');
    rmSync(root, { recursive: true, force: true });
  });

  it('should be discoverable via runList after init', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const initIO = capture();
    await runInit({ name: 'inventory', dir: pluginsDir, io: initIO.io });
    const listIO = capture();

    // act
    const code = await runList({ dir: pluginsDir, json: true, io: listIO.io });

    // assert
    expect(code).toBe(0);
    const parsed = JSON.parse(listIO.out());
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].id).toBe('inventory');
    rmSync(root, { recursive: true, force: true });
  });

  it('should respect --layer when scaffolding', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const cap = capture();

    // act
    const code = await runInit({
      name: 'minimap',
      layer: 'hud',
      dir: pluginsDir,
      io: cap.io,
    });

    // assert
    expect(code).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(pluginsDir, 'minimap', 'plugin.json'), 'utf8'),
    );
    expect(manifest.layer).toBe('hud');
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 1 when target directory already exists', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    mkdirSync(join(pluginsDir, 'taken'), { recursive: true });
    const cap = capture();

    // act
    const code = await runInit({ name: 'taken', dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(1);
    expect(cap.err()).toMatch(/already exists/);
    rmSync(root, { recursive: true, force: true });
  });

  it('should exit 1 when name has no usable kebab characters', async () => {
    // arrange
    const { root, pluginsDir } = makeTempPlugins();
    const cap = capture();

    // act
    const code = await runInit({ name: '!!!', dir: pluginsDir, io: cap.io });

    // assert
    expect(code).toBe(1);
    expect(cap.err()).toMatch(/invalid plugin name/);
    rmSync(root, { recursive: true, force: true });
  });
});
