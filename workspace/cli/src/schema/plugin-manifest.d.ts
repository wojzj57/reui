/**
 * @reui/cli - Plugin Manifest Type Declarations
 *
 * Pure TypeScript type declarations derived from `plugin-manifest.ts` (Zod schema).
 * This file contains NO runtime values — it is consumed by:
 *   - Editors / IDEs for autocompletion
 *   - Downstream packages (Runtime, Vite plugin) that only need types
 *   - JSON schema documentation generators
 *
 * Source of truth: `./plugin-manifest.ts` (Zod schemas).
 * Keep this file in sync with the Zod definitions when fields change.
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * Plugin ID: lowercase alphanumeric + hyphens, 1-64 chars.
 * Pattern: `/^[a-z][a-z0-9-]*$/`
 */
export type PluginId = string;

/**
 * Semver version string.
 * Pattern: `/^\d+\.\d+\.\d+/`
 */
export type SemverString = string;

/**
 * Safe relative path: no absolute path, no `..` traversal, no null bytes.
 */
export type SafePath = string;

/**
 * Permission string: dot-separated lowercase segments. Hyphens allowed inside segments.
 * Pattern: `/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/`
 *
 * Two categories of permissions:
 *
 * 1. Runtime module permissions — gate access to Runtime APIs:
 *    - `runtime.all`            — all Runtime modules
 *    - `runtime.websocket`      — WebSocket module
 *    - `runtime.network`        — HTTP/network module
 *    - `runtime.message`        — inter-plugin / NUI messaging
 *    - `runtime.dialog`         — dialog/overlay module
 *
 * 2. Cross-plugin access permissions — gate access to other plugins'
 *    methods and direct messaging:
 *    - `plugins.all`            — access any plugin
 *    - `plugins.<plugin-id>`    — access a specific plugin (e.g. `"plugins.inventory-ui"`)
 *
 * Wildcard suffix `.*` is allowed (e.g. `"runtime.*"`).
 */
export type PermissionString = string;

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Layer enum - which display layer the plugin belongs to. */
export type DisplayType = 'hud' | 'panel' | 'overlay';

/** Display position anchor. */
export type Position = 'center' | 'left' | 'right' | 'top' | 'bottom';

// ─── Sub-Schemas ──────────────────────────────────────────────────────────────

/** Display configuration. */
export interface Display {
  /** Width (CSS value), defaults to `"100%"`. */
  width?: string;
  /** Height (CSS value), defaults to `"100%"`. */
  height?: string;
  /** Position anchor (panel/overlay only). */
  position?: Position;
  /** Modal mode (overlay only): a new overlay will clear the entire overlay stack. */
  modal?: boolean;
  /** z-index offset within layer (0-99), default 0. */
  zOffset?: number;
}

// ─── Main Manifest ─────────────────────────────────────────────────────────
/**
 * Complete plugin manifest.
 *
 * Note: extra/unknown fields are allowed at runtime (Zod schema is non-strict)
 * for forward compatibility. This interface only declares the known fields.
 */
export interface PluginManifest {
  // ── Required Fields ──

  /** Unique plugin identifier. */
  id: PluginId;

  /** Display name (1-128 chars). */
  name: string;

  /** Plugin version (semver). */
  version: SemverString;

  /** HTML entry path (relative to plugin directory). */
  entry: SafePath;

  /** Display layer. */
  layer: DisplayType;

  // ── Optional: Entry ──

  /**
   * Dev mode entry URL (e.g. `"http://localhost:3001"`).
   * Only used when Runtime is in development mode.
   * Must be a localhost URL for security
   * (`localhost`, `127.0.0.1`, `::1`, or `*.localhost`).
   */
  devEntry?: string;

  // ── Optional: Display ──

  /** Display size/position configuration. */
  display?: Display;

  // ── Optional: Permissions ──

  /**
   * Required permissions (AND logic).
   *
   * Two categories:
   *   - Runtime module permissions (e.g. `"runtime.websocket"`, `"runtime.dialog"`)
   *   - Cross-plugin access permissions (e.g. `"plugins.inventory-ui"`)
   *
   * Runtime enforces these at every API call. Permissions do NOT affect
   * plugin load/unload — they only restrict which APIs and which other
   * plugins this plugin can call.
   */
  permissions?: PermissionString[];

  /**
   * Role-based access restriction (AND logic).
   *
   * Empty / undefined → any user can load this plugin.
   * Non-empty → user must have at least one of the listed roles, otherwise
   * the plugin will not be loaded for that user.
   *
   * Examples: `["police"]`, `["police", "firerescue"]`.
   */
  roleRestriction?: string[];

  // ── Optional: Lifecycle ──

  /**
   * Whether the plugin is enabled.
   * `false` = installed but won't be loaded (can be overridden by Runtime config).
   */
  enabled?: boolean;

  // ── Optional: Metadata ──

  /** Default hotkey binding to toggle this plugin (max 32 chars). */
  defaultHotkey?: string;
}