export type {
  RuntimeExecutionContext,
  RuntimeTransportLauncher,
  RuntimeTransportStartInput,
  RuntimeTransportStopOptions,
} from "@warblerjs/transport";

/** Public immutable record for one started transport. */
export interface RunningTransport {
  readonly kind: string;
  readonly handle: unknown;
}
