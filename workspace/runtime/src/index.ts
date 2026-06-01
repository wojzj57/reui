/**
 * @reui/runtime 包入口（RFC-003）。
 *
 * 当前阶段交付 EventBus、AuthService 与 event-namespace 路由器；
 * WebSocket / HTTP 客户端等需要真实网络栈的模块在后续 RFC 中分阶段补齐。
 */

export { EventBus } from './event-bus';
export type { EventHandler, Unsubscribe as EventBusUnsubscribe } from './event-bus';

export { AuthService } from './auth-service';
export type { UserInfo, Unsubscribe as AuthUnsubscribe } from './auth-service';

export { NuiBridge } from './nui-bridge';
export type { NuiBridgeMode } from './nui-bridge';

export { HeartbeatMonitor } from './heartbeat-monitor';
export type { HeartbeatTarget } from './heartbeat-monitor';

export { PluginManager } from './plugin-manager';
export type {
  PluginInstance,
  PluginManifestMinimal,
  PluginState,
  PluginManagerOptions,
} from './plugin-manager';

export { MessageDispatcher } from './message-dispatcher';
export type {
  MessageDispatcherRouterLike,
  MessageDispatcherOptions,
} from './message-dispatcher';

export {
  KNOWN_NAMESPACES,
  parseEventName,
  isKnownNamespace,
  isNamespaceError,
} from './event-namespace';
export type {
  EventNamespace,
  ParsedEventName,
  NamespaceError,
} from './event-namespace';
