import type { DevelopmentReporter, DevelopmentRuntimeLauncher, DevelopmentRuntimeOverrides, DevSession } from "./dev-session";
import { ManagedDevSession } from "./dev-session";
/** Starts a fully managed development session. */
export async function devCommand(projectRoot: string, launcher: DevelopmentRuntimeLauncher, watch = true, overrides: DevelopmentRuntimeOverrides = {}, report?: DevelopmentReporter): Promise<DevSession> {
  return new ManagedDevSession(projectRoot, launcher, watch, overrides, report).start();
}
