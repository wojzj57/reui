/**
 * @reui/runtime 包入口（RFC-003）。
 *
 * 交付 RFC-003 全部 Runtime 单例服务：EventBus、AuthService、HttpClient、
 * WebSocketManager，以及 PostMessageRouter / PluginManager / LayerSystem
 * 等核心宿主模块。
 */

export { EventBus } from './event-bus';
export type { EventHandler, Unsubscribe as EventBusUnsubscribe } from './event-bus';

export { AuthService } from './auth-service';
export type { UserInfo, Unsubscribe as AuthUnsubscribe } from './auth-service';

export { HttpClient, HttpClientError } from './http-client';
export type {
  HttpClientConfig,
  HttpClientOptions,
  HttpRequestConfig,
  HttpResponse,
  HttpMethod,
} from './http-client';

export { WebSocketManager } from './websocket-manager';
export type {
  WebSocketManagerOptions,
  WebSocketCtor,
  WebSocketLike,
  WSConnectOptions,
} from './websocket-manager';

export { NuiBridge } from './nui-bridge';
export type { NuiBridgeMode } from './nui-bridge';

export { HeartbeatMonitor } from './heartbeat-monitor';
export type { HeartbeatTarget } from './heartbeat-monitor';

export { PluginManager, PluginManagerError } from './plugin-manager';
export type {
  PluginInstance,
  PluginManifestMinimal,
  PluginState,
  PluginManagerOptions,
  PluginManagerErrorCode,
  ManifestValidator,
  PluginStateStorage,
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

export { PostMessageRouter } from './post-message-router';
export type {
  RequestHandler,
  RequestHandlerCtx,
  PostMessageRouterOptions,
} from './post-message-router';

export { LayerSystem } from './layer-system';
export type { LayerType, LayerSystemOptions } from './layer-system';
