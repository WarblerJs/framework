export type WebSocketLifecycleEvent = "OPEN" | "CLOSE" | "DRAIN";
export type WebSocketChannelEvent = `SUB ${string}` | `MSG ${string}`;
export type WebSocketEventKey = WebSocketLifecycleEvent | WebSocketChannelEvent;
export type WebSocketEventTable<TEntry> = {
  readonly [TKey in WebSocketEventKey]?: TEntry;
};
type StrictWebSocketEventTable<TEvents extends object> =
  TEvents & Readonly<Record<Exclude<keyof TEvents, WebSocketEventKey>, never>>;

export type WebSocketGraphEvent<THandler = unknown> =
  | THandler
  | Readonly<{
    readonly handler: THandler;
    readonly name?: string;
    readonly middlewares?: readonly unknown[];
  }>;

export interface WebSocketGraphDefinition<
  TEvents extends WebSocketEventTable<WebSocketGraphEvent> = WebSocketEventTable<WebSocketGraphEvent>,
> {
  readonly prefix?: string;
  readonly middlewares?: readonly unknown[];
  readonly providers?: readonly unknown[];
  readonly events: TEvents;
}

/** Defines a declarative WebSocket graph without decorators or controller classes. */
export function defineWebSocketGraph<
  const TEvents extends WebSocketEventTable<WebSocketGraphEvent>,
  const TDefinition extends WebSocketGraphDefinition<TEvents>,
>(
  definition: Omit<TDefinition, "events"> & { readonly events: StrictWebSocketEventTable<TEvents> },
): Readonly<Omit<TDefinition, "events"> & { readonly events: StrictWebSocketEventTable<TEvents> }> {
  return Object.freeze({
    ...definition,
    ...(definition.middlewares === undefined ? {} : { middlewares: Object.freeze([...definition.middlewares]) }),
    ...(definition.providers === undefined ? {} : { providers: Object.freeze([...definition.providers]) }),
    events: Object.freeze({ ...definition.events }),
  }) as Readonly<Omit<TDefinition, "events"> & { readonly events: StrictWebSocketEventTable<TEvents> }>;
}
