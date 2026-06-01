/**
 * `reui` CLI entry (RFC-005 §3.4).
 *
 * Glue layer only — argv parsing via commander, the actual work lives in
 * `./cli/commands.ts`. Each subcommand maps options 1:1 to the matching
 * `run*` function and forwards its returned exit code to `process.exit`.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  runValidate,
  runSign,
  runVerify,
  runList,
  runInit,
} from './cli/commands';

function packageVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const json = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return typeof json.version === 'string' ? json.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('reui')
    .description('ReUI plugin tooling — validate / sign / verify / list / init')
    .version(packageVersion());

  program
    .command('validate')
    .description('Validate plugin manifests under the plugins directory')
    .option('--dir <path>', 'plugins directory (default: ./plugins)')
    .option('--strict', 'treat MISSING scanner errors as failures')
    .action(async (opts: { dir?: string; strict?: boolean }) => {
      process.exit(await runValidate(opts));
    });

  program
    .command('sign')
    .description('Sign plugin manifests and write dist/plugin.json')
    .option('--dir <path>', 'plugins directory (default: ./plugins)')
    .option('--key <hex>', 'signing key literal')
    .option('--key-env <name>', 'env var name to read the signing key from')
    .option('--yes', 'confirm high-privilege permissions non-interactively')
    .action(
      async (opts: { dir?: string; key?: string; keyEnv?: string; yes?: boolean }) => {
        process.exit(await runSign(opts));
      },
    );

  program
    .command('verify')
    .description('Verify signed dist/plugin.json against the signing key')
    .option('--dir <path>', 'plugins directory (default: ./plugins)')
    .option('--key <hex>', 'signing key literal')
    .option('--key-env <name>', 'env var name to read the signing key from')
    .action(async (opts: { dir?: string; key?: string; keyEnv?: string }) => {
      process.exit(await runVerify(opts));
    });

  program
    .command('list')
    .description('List plugins discovered under the plugins directory')
    .option('--dir <path>', 'plugins directory (default: ./plugins)')
    .option('--json', 'emit JSON instead of a text table')
    .action(async (opts: { dir?: string; json?: boolean }) => {
      process.exit(await runList(opts));
    });

  program
    .command('init <name>')
    .description('Scaffold a new plugin directory')
    .option('--layer <layer>', 'plugin layer: hud | panel | overlay', 'panel')
    .option('--dir <path>', 'plugins directory (default: ./plugins)')
    .action(
      async (
        name: string,
        opts: { layer?: 'hud' | 'panel' | 'overlay'; dir?: string },
      ) => {
        process.exit(await runInit({ name, ...opts }));
      },
    );

  return program;
}

const program = buildProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    chalk.red('reui: ' + (err instanceof Error ? err.message : String(err))) + '\n',
  );
  process.exit(1);
});
