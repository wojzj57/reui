/**
 * 单元测试：scanner（RFC-005 §3.2）。
 *
 * 通过注入式 fs 替代真实文件系统，避免在测试里挂磁盘 fixture。
 */

import { describe, expect, it } from 'vitest';
import { scanPlugins, type ScanFs } from '../src/scanner';

const ok = (manifest: object) => JSON.stringify(manifest);

function makeFs(layout: Record<string, string | object | 'dir' | 'enoent'>): ScanFs {
  return {
    readdirSync: (path) => {
      const prefix = path.endsWith('/') || path.endsWith('\\') ? path : path + '/';
      const direct = new Set<string>();
      for (const k of Object.keys(layout)) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length).replace(/\\/g, '/');
        const seg = rest.split('/')[0];
        if (seg) direct.add(seg);
      }
      if (direct.size === 0 && layout[path] !== 'dir') {
        throw new Error(`ENOENT: ${path}`);
      }
      return [...direct];
    },
    statSync: (path) => {
      const norm = path.replace(/\\/g, '/');
      const value = layout[path] ?? layout[norm];
      const isDir =
        value === 'dir' ||
        Object.keys(layout).some((k) =>
          k.startsWith(path + '/') || k.startsWith(norm + '/'),
        );
      return { isDirectory: () => isDir };
    },
    readFileSync: (path) => {
      const norm = path.replace(/\\/g, '/');
      const v = layout[path] ?? layout[norm];
      if (v === undefined || v === 'dir' || v === 'enoent') {
        throw new Error(`ENOENT: ${path}`);
      }
      return typeof v === 'string' ? v : ok(v);
    },
  };
}

describe('scanPlugins', () => {
  it('should return manifest list when directories contain plugin.json', () => {
    // arrange
    const fs = makeFs({
      'plugins/hud/plugin.json': { id: 'hud', name: 'HUD' },
      'plugins/inv/plugin.json': { id: 'inv', name: 'Inventory' },
    });

    // act
    const r = scanPlugins('plugins', { fs });

    // assert
    expect(r.plugins).toHaveLength(2);
    const ids = r.plugins.map((p) => p.manifest.id).sort();
    expect(ids).toEqual(['hud', 'inv']);
  });

  it('should report MISSING for directories without plugin.json', () => {
    // arrange
    const fs = makeFs({
      'plugins/hud/plugin.json': { id: 'hud', name: 'HUD' },
      'plugins/empty/.gitkeep': '',
    });

    // act
    const r = scanPlugins('plugins', { fs });

    // assert
    expect(r.plugins).toHaveLength(1);
    expect(r.errors.some((e) => e.kind === 'MISSING' && e.basePath.endsWith('empty'))).toBe(true);
  });

  it('should report JSON kind error when plugin.json is malformed', () => {
    // arrange
    const fs = makeFs({
      'plugins/bad/plugin.json': '{not-json',
    });

    // act
    const r = scanPlugins('plugins', { fs });

    // assert
    expect(r.plugins).toHaveLength(0);
    expect(r.errors.some((e) => e.kind === 'JSON')).toBe(true);
  });

  it('should return READ error when pluginsDir does not exist', () => {
    const fs = makeFs({});

    const r = scanPlugins('plugins', { fs });

    expect(r.plugins).toHaveLength(0);
    expect(r.errors[0]?.kind).toBe('READ');
  });

  it('should look for dist/plugin.json when signed=true', () => {
    const fs = makeFs({
      'plugins/inv/dist/plugin.json': { id: 'inv', name: 'Inventory' },
      'plugins/inv/plugin.json': { id: 'inv', name: 'Inventory' },
    });

    const r = scanPlugins('plugins', { fs, signed: true });

    expect(r.plugins.length).toBe(1);
    expect(r.plugins[0]!.manifest.id).toBe('inv');
  });

  it('should fall back to real node:fs when no fs is injected', async () => {
    // arrange: 在系统临时目录写一个最小插件
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'reui-scan-'));
    try {
      mkdirSync(join(root, 'inv'));
      writeFileSync(
        join(root, 'inv', 'plugin.json'),
        JSON.stringify({ id: 'inv', name: 'Inventory' }),
      );

      // act
      const r = scanPlugins(root);

      // assert
      expect(r.plugins.length).toBe(1);
      expect(r.plugins[0]!.manifest.id).toBe('inv');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('should fall back to real node:fs when no fs is injected', async () => {
    // arrange: 在系统临时目录写一个最小插件
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'reui-scan-'));
    try {
      mkdirSync(join(root, 'inv'));
      writeFileSync(
        join(root, 'inv', 'plugin.json'),
        JSON.stringify({ id: 'inv', name: 'Inventory' }),
      );

      // act
      const r = scanPlugins(root);

      // assert
      expect(r.plugins.length).toBe(1);
      expect(r.plugins[0]!.manifest.id).toBe('inv');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
