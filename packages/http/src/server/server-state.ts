/** Native HTTP server owner lifecycle states. */
export const ServerState = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
} as const);

/** One native HTTP server owner lifecycle state. */
export type ServerStateValue = (typeof ServerState)[keyof typeof ServerState];
