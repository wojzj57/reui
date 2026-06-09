/**
 * 默认深色主题导出（RFC-004 §3.1 / 附录 A）。
 *
 * 拆分为独立模块，方便 ReUIProvider 与消费者按需导入，
 * 也避免 theme/index.ts 循环依赖。
 */

export { defaultTheme } from './tokens';
