/**
 * 事件订阅命名空间路由（RFC-003 §3.5）。
 *
 * PostMessageRouter 收到子页面 `event:subscribe` 时调用此处的纯函数解析
 * 命名空间并把订阅意图分流到对应的内部服务。
 *
 * 拆出独立模块的目的：
 *   - 把"协议字符串 → 内部能力"的耦合点集中在一处；
 *   - 便于单测——无需启动 Router / Plugin 也能验证分流逻辑。
 *
 * 命名空间常量本身由 `@reui/interface` 持有（RFC-001 §3.1 的协议真相源），
 * 此处仅做透传 + 解析逻辑。
 */

import { EVENT_NAMESPACES, type EventNamespace } from '@reui/interface/protocol';

/** 已知命名空间——RFC-003 §3.5.1 表格（来自 `@reui/interface`）。 */
export const KNOWN_NAMESPACES = EVENT_NAMESPACES;
export type { EventNamespace };

/** 解析后的事件名结构。 */
export interface ParsedEventName {
  /** 命名空间前缀，例如 `event` / `nui` / `ws` / `auth` / `plugin`。 */
  namespace: EventNamespace;
  /** 去掉命名空间后的事件名。 */
  name: string;
  /** 原始事件名（含命名空间）。 */
  raw: string;
}

/** 解析失败时的结构化错误（不抛异常——交给 Router 决定如何回包）。 */
export interface NamespaceError {
  code: 'INVALID_PARAMS';
  message: string;
}

/**
 * 解析事件名。
 * - 必须包含 `:` 分隔符；
 * - 命名空间必须属于 KNOWN_NAMESPACES；
 * - 事件名不能为空字符串。
 */
export function parseEventName(event: string): ParsedEventName | NamespaceError {
  const colonIdx = event.indexOf(':');
  if (colonIdx <= 0) {
    return {
      code: 'INVALID_PARAMS',
      message: `Event name must contain a non-empty namespace prefix: "${event}"`,
    };
  }
  const namespace = event.slice(0, colonIdx);
  const name = event.slice(colonIdx + 1);
  if (!name) {
    return {
      code: 'INVALID_PARAMS',
      message: `Event name after namespace is empty: "${event}"`,
    };
  }
  if (!isKnownNamespace(namespace)) {
    return {
      code: 'INVALID_PARAMS',
      message: `Unknown event namespace: "${namespace}"`,
    };
  }
  return { namespace, name, raw: event };
}

export function isKnownNamespace(value: string): value is EventNamespace {
  return (KNOWN_NAMESPACES as readonly string[]).includes(value);
}

/** 类型守卫：返回值是否为解析失败。 */
export function isNamespaceError(
  v: ParsedEventName | NamespaceError,
): v is NamespaceError {
  return 'code' in v;
}
