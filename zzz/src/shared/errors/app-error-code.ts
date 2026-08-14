/** Stable, application-wide error codes thrown via `WarblerError`/its convenience subclasses. */
export const AppErrorCode = Object.freeze({
  USER_NOT_FOUND: "USER_NOT_FOUND",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  EMAIL_EXIST: "EMAIL_EXIST",
} as const);

/** One of the application's stable error codes. */
export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];
