/** Stable states in the Warbler transport lifecycle. */
export const TransportState = Object.freeze({
  CREATED: "created",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
} as const);

/** A state in the Warbler transport lifecycle. */
export type TransportStateValue = (typeof TransportState)[keyof typeof TransportState];
