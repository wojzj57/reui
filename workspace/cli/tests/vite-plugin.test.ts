// @vitest-environment node

/**
 * vitePluginReUI — hook behaviour tests.
 *
 * Mocks match the real scanner.ts / validator.ts / project.ts signatures.
 * AAA pattern, fake timers for debounce.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { vitePluginReUI } from '../src/vite/index.js';
import type { VitePluginReUIOptions } from '../src/vite/index.js';
import type { ScanResult, ScanError } from '../src/scanner.js';
import type { ValidationResult } from '../src/validator.js';
import type { PluginManifest } from '../src/schema/plugin-manifest.js';

// ── Mock factories (hoisted by vitest) ─────────────────────

vi.mock('../src/scanner.js', () => ({
  scanPlugins: vi.fn(),
}));

vi.mock('../src/validator.js', () => ({
  validateManifest: vi.fn(),
}));

vi.mock('../src/project.js', () => ({
  signProject: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────

/** Create a minimal valid manifest fixture. */
function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: overrides.id ?? 'my-plugin',
    name: overrides.name ?? 'My Plugin',
    version: overrides.version ?? '1.0.0',
    layer: overrides.layer ?? 'panel',
    entry: overrides.entry ?? 'src/index.html',
    permissions: overrides.permissions ?? [],
  } as PluginManifest;
}

interface MockServer {
  watcher: EventEmitter & { close?: () => void };
  ws: { send: ReturnType<typeof vi.fn> };
  config: { root: string };
}

function makeServer(basePath: string): MockServer {
  const wsSend = vi.fn();
  const watcher = new EventEmitter();
  (watcher as unknown as { close: () => void }).close = () => {};
  return {
    watcher,
    ws: { send: wsSend },
    config: { root: basePath },
  } as unknown as MockServer;
}

// ── Tests ───────────────────────────────────────────────────────

describe('vitePluginReUI.name', () => {
  it('should be "reui"', () => {
    const plugin = vitePluginReUI();
    expect(plugin.name).toBe('reui');
  });
});

describe('vitePluginReUI.hooks', () => {
  it('should expose configResolved / buildStart / configureServer / closeBundle', () => {
    const plugin = vitePluginReUI();
    expect(plugin.configResolved).toBeTypeOf('function');
    expect(plugin.buildStart).toBeTypeOf('function');
    expect(plugin.configureServer).toBeTypeOf('function');
    expect(plugin.closeBundle).toBeTypeOf('function');
  });
});

describe('vitePluginReUI.buildStart', () => {
  const FAKE_ROOT = '/fake/plugins';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call this.error when any plugin manifest is invalid', async () => {
    const { validateManifest } = await import('../src/validator.js');
    (validateManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      valid: false,
      issues: [{ path: 'permissions', message: 'unknown permission "foo"' }],
    });

    const { scanPlugins } = await import('../src/scanner.js');
    (scanPlugins as ReturnType<typeof vi.fn>).mockReturnValue({
      plugins: [{ basePath: path.join(FAKE_ROOT, 'my-plugin'), manifest: makeManifest() } satisfies ScanResult],
      errors: [],
    });

    const plugin = vitePluginReUI();
    (plugin.configResolved as Function)({ root: FAKE_ROOT });
    const errorFn = vi.fn().mockImplementation((m: string) => { throw new Error(m); });
    try { await (plugin.buildStart as Function).call({ error: errorFn }); } catch { /* expected */ }
    expect(errorFn).toHaveBeenCalledWith(
      expect.stringContaining('ReUI validation failed'),
    );
  });

  it('should NOT call this.error when all plugins are valid', async () => {
    const { validateManifest } = await import('../src/validator.js');
    (validateManifest as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true, issues: [] });

    const { scanPlugins } = await import('../src/scanner.js');
    (scanPlugins as ReturnType<typeof vi.fn>).mockReturnValue({
      plugins: [{ basePath: path.join(FAKE_ROOT, 'my-plugin'), manifest: makeManifest() } satisfies ScanResult],
      errors: [],
    });

    const plugin = vitePluginReUI();
    (plugin.configResolved as Function)({ root: FAKE_ROOT });
    const errorFn = vi.fn();
    await (plugin.buildStart as Function).call({ error: errorFn });
    expect(errorFn).not.toHaveBeenCalled();
  });
});

describe('vitePluginReUI.closeBundle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubEnv('REUI_SIGN_KEY', '');
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('should call this.error when signOnBuild=true and no key is available', async () => {
    const plugin = vitePluginReUI({ signOnBuild: true });
    const errorFn = vi.fn().mockImplementation((m: string) => { throw new Error(m); });
    try { await (plugin.closeBundle as Function).call({ error: errorFn }); } catch { /* expected */ }
    expect(errorFn).toHaveBeenCalledWith(
      expect.stringContaining('REUI sign key missing'),
    );
  });

  it('should call signProject when key is provided via options.key', async () => {
    const { signProject } = await import('../src/project.js');
    const plugin = vitePluginReUI({ signOnBuild: true, key: 'secret-key' });
    const errorFn = vi.fn();
    await (plugin.closeBundle as Function).call({ error: errorFn });
    expect(signProject).toHaveBeenCalled();
  });

  it('should call signProject when key is resolved from REUI_SIGN_KEY env var', async () => {
    vi.stubEnv('REUI_SIGN_KEY', 'env-secret');
    const { signProject } = await import('../src/project.js');
    const plugin = vitePluginReUI({ signOnBuild: true });
    const errorFn = vi.fn();
    await (plugin.closeBundle as Function).call({ error: errorFn });
    expect(signProject).toHaveBeenCalled();
  });

  it('should be a no-op when signOnBuild=false', async () => {
    const { signProject } = await import('../src/project.js');
    const plugin = vitePluginReUI({ signOnBuild: false });
    await (plugin.closeBundle as Function).call({ error: vi.fn() });
    expect(signProject).not.toHaveBeenCalled();
  });
});

describe('vitePluginReUI.configureServer', () => {
  let tmpDir: string;
  let plugin: ReturnType<typeof vitePluginReUI>;
  let server: MockServer;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reui-vite-'));
    plugin = vitePluginReUI();
    server = makeServer(tmpDir);
    // Must call configResolved before configureServer so resolvedBasePath is set
    (plugin.configResolved as Function)(server.config);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should send reui:plugin-updated when a valid plugin.json changes', async () => {
    // arrange: write a real plugin.json so scanner can read it
    const manifest = makeManifest();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest));

    const { scanPlugins } = await import('../src/scanner.js');
    (scanPlugins as ReturnType<typeof vi.fn>).mockReturnValue({
      plugins: [{ basePath: pluginDir, manifest } satisfies ScanResult],
      errors: [],
    });

    const { validateManifest } = await import('../src/validator.js');
    (validateManifest as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true, issues: [] });

    await (plugin.configureServer as Function).call({}, server);
    const wsSend = server.ws.send as ReturnType<typeof vi.fn>;

    // act
    (server.watcher as unknown as EventEmitter).emit(
      'change',
      path.join(pluginDir, 'plugin.json'),
    );
    await vi.advanceTimersByTimeAsync(250);

    // assert
    expect(wsSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'custom', event: 'reui:plugin-updated' }),
    );
  });

  it('should send error (not plugin-updated) when changed plugin.json is invalid', async () => {
    const { validateManifest } = await import('../src/validator.js');
    (validateManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      valid: false,
      issues: [{ path: 'id', message: 'missing id' }],
    });

    const { scanPlugins } = await import('../src/scanner.js');
    (scanPlugins as ReturnType<typeof vi.fn>).mockReturnValue({
      plugins: [{ basePath: path.join(tmpDir, 'my-plugin'), manifest: makeManifest() } satisfies ScanResult],
      errors: [],
    });

    await (plugin.configureServer as Function).call({}, server);
    const wsSend = server.ws.send as ReturnType<typeof vi.fn>;

    (server.watcher as unknown as EventEmitter).emit(
      'change',
      path.join(tmpDir, 'my-plugin', 'plugin.json'),
    );
    await vi.advanceTimersByTimeAsync(250);

    // Should have sent an error (not plugin-updated)
    const errorCall = wsSend.mock.calls.find((c) => c[0]?.type === 'error');
    expect(errorCall).toBeDefined();
  });

  it('should send reui:plugins-changed on add of new plugin.json', async () => {
    await (plugin.configureServer as Function).call({}, server);
    const wsSend = server.ws.send as ReturnType<typeof vi.fn>;

    (server.watcher as unknown as EventEmitter).emit(
      'add',
      path.join(tmpDir, 'new-plugin', 'plugin.json'),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(wsSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'custom', event: 'reui:plugins-changed' }),
    );
  });

  it('should send reui:plugins-changed on unlink of plugin.json', async () => {
    await (plugin.configureServer as Function).call({}, server);
    const wsSend = server.ws.send as ReturnType<typeof vi.fn>;

    (server.watcher as unknown as EventEmitter).emit(
      'unlink',
      path.join(tmpDir, 'my-plugin', 'plugin.json'),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(wsSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'custom', event: 'reui:plugins-changed' }),
    );
  });

  it('should NOT send ws messages for changes outside basePath', async () => {
    // Ensure mocks return valid state (isolated from previous tests)
    const { validateManifest } = await import('../src/validator.js');
    (validateManifest as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true, issues: [] });
    const { scanPlugins } = await import('../src/scanner.js');
    (scanPlugins as ReturnType<typeof vi.fn>).mockReturnValue({ plugins: [], errors: [] });

    await (plugin.configureServer as Function).call({}, server);
    const wsSend = server.ws.send as ReturnType<typeof vi.fn>;

    // Use a path that is guaranteed to be outside tmpDir on the same drive.
    // path.resolve(tmpDir, '../../outside/plugin.json') is always on the same
    // drive as tmpDir, so path.relative() will use '..' prefix.
    const outsidePath = path.resolve(tmpDir, '..', '..', 'outside', 'plugin.json');

    (server.watcher as unknown as EventEmitter).emit(
      'change',
      outsidePath,
    );
    await vi.advanceTimersByTimeAsync(250);

    expect(wsSend).not.toHaveBeenCalled();
  });
});
