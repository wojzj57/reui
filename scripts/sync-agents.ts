#!/usr/bin/env bun
/**
 * sync-agents.ts
 *
 * 将 `.agents/{rules,skills}` 同步到本地存在的各 AI 工具配置文件夹：
 *   .opencode, .cursor, .claude, .cline, .codebuddy, .trae
 *
 * 行为：
 *   - 仅同步「本地已存在」的目标文件夹（不会主动创建工具根目录）
 *   - 复制 `.agents/rules/*` → `<tool>/rules/*`
 *   - 复制 `.agents/skills/*` → `<tool>/skills/*`
 *   - 对于 `skills` 下的「同名子文件夹」，先清空目标，再用 `.agents` 中的内容覆盖
 *     （即 `.agents` 为权威源；其它工具夹下未重名的子文件夹保持不动）
 *   - 对于 `rules` 下的「同名文件 / 子文件夹」，同样以 `.agents` 为准覆盖
 *
 * 用法：
 *   bun run scripts/sync-agents.ts            # 正常同步
 *   bun run scripts/sync-agents.ts --dry-run  # 仅打印计划，不写盘
 */

import { existsSync, statSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- 配置 ----------------------------------------------------------------

const TOOL_DIRS = [
  ".opencode",
  ".cursor",
  ".claude",
  ".cline",
  ".codebuddy",
  ".trae",
] as const;

const SYNC_CATEGORIES = ["rules", "skills"] as const;
type Category = (typeof SYNC_CATEGORIES)[number];

// ---- 路径解析 ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const AGENTS_DIR = join(PROJECT_ROOT, ".agents");

const DRY_RUN = process.argv.includes("--dry-run");

// ---- 工具函数 ------------------------------------------------------------

function log(msg: string) {
  console.log(msg);
}

function logStep(prefix: string, msg: string) {
  const tag = DRY_RUN ? "[dry-run]" : "[sync]";
  log(`${tag} ${prefix} ${msg}`);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function listEntries(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return readdir(dir);
}

async function removePath(target: string) {
  if (!existsSync(target)) return;
  logStep("•", `remove   ${rel(target)}`);
  if (DRY_RUN) return;
  await rm(target, { recursive: true, force: true });
}

async function copyPath(src: string, dest: string) {
  logStep("→", `copy     ${rel(src)}  ⇒  ${rel(dest)}`);
  if (DRY_RUN) return;
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}

function rel(p: string): string {
  const r = p.startsWith(PROJECT_ROOT)
    ? p.slice(PROJECT_ROOT.length + 1)
    : p;
  return r.split("\\").join("/");
}

// ---- 同步逻辑 ------------------------------------------------------------

/**
 * 将 `.agents/<category>` 中的每个条目同步到 `<toolDir>/<category>` 下。
 * 同名条目（文件或文件夹）会先被删除再覆盖。其余条目保持不动。
 */
async function syncCategory(toolDir: string, category: Category) {
  const sourceRoot = join(AGENTS_DIR, category);
  const destRoot = join(toolDir, category);

  if (!isDir(sourceRoot)) {
    logStep("!", `skip     missing source ${rel(sourceRoot)}`);
    return;
  }

  const entries = await listEntries(sourceRoot);
  if (entries.length === 0) {
    logStep("·", `empty    ${rel(sourceRoot)} (nothing to copy)`);
    return;
  }

  if (!existsSync(destRoot)) {
    logStep("+", `mkdir    ${rel(destRoot)}`);
    if (!DRY_RUN) await mkdir(destRoot, { recursive: true });
  }

  for (const name of entries) {
    const src = join(sourceRoot, name);
    const dest = join(destRoot, name);
    // 同名先清理（无论是文件还是文件夹），再用 .agents 中的覆盖
    await removePath(dest);
    await copyPath(src, dest);
  }
}

async function syncToolDir(toolDir: string) {
  log("");
  log(`=== ${rel(toolDir)} ===`);
  for (const category of SYNC_CATEGORIES) {
    await syncCategory(toolDir, category);
  }
}

// ---- 入口 ----------------------------------------------------------------

async function main() {
  if (!isDir(AGENTS_DIR)) {
    console.error(`[sync-agents] missing .agents directory: ${AGENTS_DIR}`);
    process.exit(1);
  }

  log(`[sync-agents] project root: ${PROJECT_ROOT}`);
  log(`[sync-agents] source:       ${rel(AGENTS_DIR)}`);
  if (DRY_RUN) log(`[sync-agents] mode:         dry-run (no changes)`);

  const targets = TOOL_DIRS
    .map((name) => join(PROJECT_ROOT, name))
    .filter((p) => isDir(p));

  if (targets.length === 0) {
    log(`[sync-agents] no tool dirs found among: ${TOOL_DIRS.join(", ")}`);
    return;
  }

  log(`[sync-agents] tool dirs:    ${targets.map(rel).join(", ")}`);

  for (const toolDir of targets) {
    await syncToolDir(toolDir);
  }

  log("");
  log(`[sync-agents] done.`);
}

main().catch((err) => {
  console.error("[sync-agents] failed:", err);
  process.exit(1);
});
