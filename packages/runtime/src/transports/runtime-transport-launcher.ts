export type {
  RuntimeExecutionContext,
  RuntimeTransportLauncher,
  RuntimeTransportStartInput,
  RuntimeTransportStopOptions,
} from "@warbler/transport";

/** Public immutable record for one started transport. */
export interface RunningTransport {
  readonly kind: string;
  readonly handle: unknown;
}
