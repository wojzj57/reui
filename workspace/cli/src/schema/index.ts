/**
 * @reui/cli schema 模块入口（RFC-002 §4.1）。
 *
 * 重新导出 plugin manifest 的 Zod schema 与 TypeScript 类型，
 * 供 CLI 命令、Runtime 校验逻辑、Vite 插件统一使用。
 */

export * from './plugin-manifest';
