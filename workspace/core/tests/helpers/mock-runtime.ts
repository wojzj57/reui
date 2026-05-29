import type {
  AnyMessage,
  HandshakeAckPayload,
  HandshakeMessage,
  HandshakeRejectCode,
  PingMessage,
  RequestMessage,
  ErrorCode,
} from '@reui/interface';
import { makeAck, makePing, makePush, makeReject, makeErrorResponse, makeSuccessResponse } from './factories';
import type { ControlledParent, IframeHandle } from './iframe-window';

export interface MockRuntimeOptions {
  /** Origin used when delivering inbound messages to the iframe. */
  origin?: string;
  /** Auto-ack incoming `reui:handshake` (default true). */
  autoAck?: boolean;
  /** Override fields on the auto-generated ack payload. */
  ackPayload?: Partial<HandshakeAckPayload>;
}

type RequestHandler = (msg: RequestMessage) => unknown | Promise<unknown>;

/**
 * In-memory Runtime stand-in (RFC-001 §3.2 + §3.3 surface, plan §6).
 *
 * Lives inside the same jsdom window as the Client and drives both
 * directions of the postMessage protocol so integration tests need no
 * real iframe / Runtime / network.
 */
export class MockRuntime {
  /** Every message the iframe has sent, in order. */
  readonly received: AnyMessage[] = [];
  /** Every message we have delivered to the iframe, in order. */
  readonly sent: AnyMessage[] = [];

  private readonly origin: string;
  private autoAck: boolean;
  private readonly ackPayload: Partial<HandshakeAckPayload>;
  private readonly handlers = new Map<string, RequestHandler>();
  private readonly forcedFailures = new Map<
    string,
    { code: ErrorCode; message: string }
  >();
  private rejectNextHandshake: { code: HandshakeRejectCode; reason: string } | null = null;
  private readonly originalPostMessage: ControlledParent['postMessage'];

  constructor(
    private readonly iframe: IframeHandle,
    opts: MockRuntimeOptions = {},
  ) {
    this.origin = opts.origin ?? 'https://runtime.reui.local';
    this.autoAck = opts.autoAck ?? true;
    this.ackPayload = opts.ackPayload ?? {};

    // Intercept the Client → parent flow so we can drive responses.
    this.originalPostMessage = iframe.parent.postMessage.bind(iframe.parent);
    iframe.parent.postMessage = (data, targetOrigin) => {
      this.originalPostMessage(data, targetOrigin);
      this.handleOutbound(data);
    };
  }

  /** Register a method handler used by `reui:request`. */
  on(method: string, fn: RequestHandler): this {
    this.handlers.set(method, fn);
    return this;
  }

  /** Force a method to return a `reui:response` error. */
  fail(method: string, error: { code: ErrorCode; message: string }): this {
    this.forcedFailures.set(method, error);
    return this;
  }

  /** Cause the next `reui:handshake` to be rejected instead of acked. */
  rejectHandshake(code: HandshakeRejectCode, reason: string): this {
    this.rejectNextHandshake = { code, reason };
    this.autoAck = false;
    return this;
  }

  /** Push an event to the iframe (Runtime → iframe). */
  push(event: string, payload: unknown): void {
    this.deliver(makePush(event, payload));
  }

  /** Send a heartbeat ping; the Client should reply with a pong. */
  ping(timestamp = 0): void {
    this.deliver(makePing(timestamp));
  }

  /** Tear down the postMessage interception. Call from `afterEach`. */
  dispose(): void {
    this.iframe.parent.postMessage = this.originalPostMessage;
    this.received.length = 0;
    this.sent.length = 0;
    this.handlers.clear();
    this.forcedFailures.clear();
    this.rejectNextHandshake = null;
  }

  // ── internal ────────────────────────────────────────────────────────────

  private deliver(msg: AnyMessage): void {
    this.sent.push(msg);
    this.iframe.parent.__deliver(msg, this.origin);
  }

  private handleOutbound(data: unknown): void {
    if (!isAnyMessage(data)) return;
    this.received.push(data);

    switch (data.type) {
      case 'reui:handshake':
        void this.handleHandshake(data);
        return;
      case 'reui:request':
        void this.handleRequest(data);
        return;
      // pong / notify / others: nothing to drive automatically.
      default:
        return;
    }
  }

  private async handleHandshake(msg: HandshakeMessage): Promise<void> {
    if (this.rejectNextHandshake) {
      const { code, reason } = this.rejectNextHandshake;
      this.rejectNextHandshake = null;
      this.deliver(makeReject(code, reason));
      return;
    }
    if (!this.autoAck) return;

    this.deliver(
      makeAck({
        pluginId: msg.payload.pluginId,
        runtimeOrigin: this.origin,
        ...this.ackPayload,
      }),
    );
  }

  private async handleRequest(msg: RequestMessage): Promise<void> {
    const forced = this.forcedFailures.get(msg.method);
    if (forced) {
      this.deliver(makeErrorResponse(msg.id, forced.code, forced.message));
      return;
    }

    const handler = this.handlers.get(msg.method);
    if (!handler) {
      this.deliver(
        makeErrorResponse(msg.id, 'METHOD_NOT_FOUND', `No handler for ${msg.method}`),
      );
      return;
    }

    try {
      const result = await handler(msg);
      this.deliver(makeSuccessResponse(msg.id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deliver(makeErrorResponse(msg.id, 'RUNTIME_ERROR', message));
    }
  }
}

const isAnyMessage = (v: unknown): v is AnyMessage =>
  typeof v === 'object' &&
  v !== null &&
  'type' in v &&
  typeof (v as { type: unknown }).type === 'string' &&
  (v as { type: string }).type.startsWith('reui:');
