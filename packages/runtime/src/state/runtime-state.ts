/** Runtime lifecycle states. */
export const RuntimeState = Object.freeze({
  CREATED: "created",
  VALIDATING: "validating",
  BOOTSTRAPPING: "bootstrapping",
  STARTING_TRANSPORTS: "starting_transports",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  FAILED: "failed",
} as const);

/** Runtime lifecycle state value. */
export type RuntimeStateValue = (typeof RuntimeState)[keyof typeof RuntimeState];
