/**
 * @reui/cli - Plugin Manifest Zod Schema
 *
 * Single source of truth for plugin.json validation.
 * Used by: CLI commands, Vite plugin, Runtime (schema validation).
 */
import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

/** Plugin ID: lowercase alphanumeric + hyphens, 1-64 chars */
export const PluginId = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    'Plugin ID must start with a letter, contain only lowercase alphanumeric and hyphens'
  );

/** Semver version string */
export const SemverString = z
  .string()
  .regex(/^\d+\.\d+\.\d+/, 'Must be semver format (e.g., 1.0.0)');

/** Safe relative path: no absolute path, no traversal */
export const SafePath = z
  .string()
  .min(1)
  .refine(
    (val) => !val.startsWith('/') && !val.startsWith('\\'),
    'Must be a relative path (cannot start with / or \\)'
  )
  .refine(
    (val) => !val.includes('..'),
    'Path traversal (..) is not allowed'
  )
  .refine(
    (val) => !val.includes('\0'),
    'Null bytes are not allowed in paths'
  );

/**
 * Permission string: dot-separated lowercase segments. Hyphens allowed inside segments.
 *
 * Two categories of permissions:
 *
 * 1. Runtime module permissions — gate access to Runtime APIs:
 *      "runtime.all", "runtime.websocket", "runtime.network",
 *      "runtime.message", "runtime.dialog"
 *
 * 2. Cross-plugin access permissions — gate access to other plugins'
 *    methods and direct messaging:
 *      "plugins.all", "plugins.<plugin-id>" (e.g. "plugins.inventory-ui")
 *
 * Wildcard suffix `.*` is allowed (e.g. "runtime.*").
 */
export const PermissionString = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\.\*)?$/,
    'Permission must be dot-separated lowercase (e.g., runtime.websocket, plugins.inventory-ui). Wildcard suffix .* is allowed.'
  );

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Layer enum - which display layer the plugin belongs to */
export const LayerEnum = z.enum(['hud', 'panel', 'overlay']);

/** Display position anchor */
export const PositionEnum = z.enum(['center', 'left', 'right', 'top', 'bottom']);

// ─── Sub-Schemas ──────────────────────────────────────────────────────────────

/** Display configuration */
export const DisplaySchema = z.object({
  /** Width (CSS value), defaults to "100%" */
  width: z.string().optional(),
  /** Height (CSS value), defaults to "100%" */
  height: z.string().optional(),
  /** Position anchor (panel/overlay only) */
  position: PositionEnum.optional(),
  /** Modal mode (overlay only): new overlay will clear the entire overlay stack */
  modal: z.boolean().optional(),
  /** z-index offset within layer (0-99), default 0 */
  zOffset: z.number().int().min(0).max(99).optional(),
});

// ─── Main Schema ─────────────────────────────────────────────────────────────

/**
 * Complete PluginManifest schema.
 *
 * Does NOT use .strict() — unknown fields pass through for forward compatibility.
 * New CLI versions can add fields without breaking old Runtime validation.
 */
export const PluginManifestSchema = z.object({
  // ── Required Fields ──

  /** Unique plugin identifier */
  id: PluginId,

  /** Display name */
  name: z.string().min(1).max(128),

  /** Plugin version (semver) */
  version: SemverString,

  /** HTML entry path (relative to plugin directory) */
  entry: SafePath,

  /** Display layer */
  layer: LayerEnum,

  // ── Optional: Entry ──

  /**
   * Dev mode entry URL (e.g., http://localhost:3001).
   * Only used when Runtime is in development mode.
   * Must be a localhost URL for security.
   */
  devEntry: z
    .string()
    .url('devEntry must be a valid URL')
    .refine(
      (val) => {
        try {
          const url = new URL(val);
          return (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '::1' ||
            url.hostname.endsWith('.localhost')
          );
        } catch {
          return false;
        }
      },
      'devEntry must point to localhost (localhost, 127.0.0.1, or ::1) for security'
    )
    .optional(),

  // ── Optional: Display ──

  /** Display size/position configuration */
  display: DisplaySchema.optional(),

  // ── Optional: Permissions ──

  /**
   * Required permissions (AND logic).
   *
   * Two categories:
   *   - Runtime module permissions (e.g. "runtime.websocket", "runtime.dialog")
   *   - Cross-plugin access permissions (e.g. "plugins.inventory-ui")
   *
   * Runtime enforces these at every API call. Permissions do NOT affect
   * plugin load/unload — they only restrict which APIs and which other
   * plugins this plugin can call.
   */
  permissions: z.array(PermissionString).optional(),

  /**
   * Role-based access restriction (AND logic).
   *
   * Empty / undefined → any user can load this plugin.
   * Non-empty → user must have at least one of the listed roles, otherwise
   * the plugin will not be loaded for that user.
   *
   * Examples: ["police"], ["police", "firerescue"].
   */
  roleRestriction: z.array(z.string().min(1).max(64)).optional(),

  // ── Optional: Lifecycle ──

  /**
   * Whether the plugin is enabled.
   * false = installed but won't be loaded (can be overridden by Runtime config).
   */
  enabled: z.boolean().optional(),

  // ── Optional: Metadata ──

  /** Default hotkey binding to toggle this plugin */
  defaultHotkey: z.string().max(32).optional(),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────

/** Inferred TypeScript type for a complete plugin manifest */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** Inferred TypeScript type for layer / display-type values */
export type DisplayType = z.infer<typeof LayerEnum>;

/** @deprecated Use `DisplayType` instead. */
export type Layer = DisplayType;

/** Inferred TypeScript type for display position values */
export type Position = z.infer<typeof PositionEnum>;

/** Inferred TypeScript type for display configuration */
export type Display = z.infer<typeof DisplaySchema>;
