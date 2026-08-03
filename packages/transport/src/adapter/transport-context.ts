/** Immutable application-owned context shared with a transport adapter. */
export interface TransportContext<TShared = undefined> {
  /** Application-owned shared data supplied to the transport. */
  readonly shared: TShared;
}

/** Creates an immutable transport context without cloning application-owned data. */
export function createTransportContext<TShared>(shared: TShared): TransportContext<TShared> {
  return Object.freeze({ shared });
}
