/** Runtime lifecycle states. */
export const RuntimeState = Object.freeze({
  CREATED: "created",
  BOOTSTRAPPING: "bootstrapping",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
} as const);

/** Runtime lifecycle state value. */
export type RuntimeStateValue = (typeof RuntimeState)[keyof typeof RuntimeState];
