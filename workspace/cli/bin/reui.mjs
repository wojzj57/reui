#!/usr/bin/env node
// Wrapper around tsx — lets `reui` execute the TypeScript entry directly
// without a build step. Requires Node ≥ 20.6 for `--import tsx`. The repo's
// engines.node ≥ 20.10 already covers that. tsx is declared as
// peerDependenciesMeta.optional so consumers can opt out, but inside this
// monorepo it is always installed via devDependencies.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, '..', 'src', 'cli.ts');

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', entry, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
