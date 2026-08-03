import { validateWebrtc } from "./transport-validation";

/** Validates WebRTC transport configuration and throws on the first invalid value. */
export function validateWebrtcConfig(value: unknown): void {
  validateWebrtc(value);
}
