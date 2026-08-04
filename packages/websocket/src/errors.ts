/** Base error for public WebSocket package failures. */
export class WebSocketError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
/** Raised for invalid upgrade requests. */
export class WebSocketUpgradeError extends WebSocketError {}
/** Raised for rejected origins. */
export class WebSocketOriginError extends WebSocketUpgradeError {}
/** Raised for failed subprotocol negotiation. */
export class WebSocketProtocolError extends WebSocketUpgradeError {}
/** Raised for invalid message envelopes. */
export class WebSocketMessageError extends WebSocketError {}
/** Raised for invalid message payloads. */
export class WebSocketPayloadError extends WebSocketMessageError {}
/** Raised for validation rejection. */
export class WebSocketValidationError extends WebSocketMessageError {}
/** Raised for invalid server lifecycle transitions. */
export class WebSocketStateError extends WebSocketError {}
