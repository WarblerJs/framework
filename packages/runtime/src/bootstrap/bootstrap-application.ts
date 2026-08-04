import { RuntimeApplication } from "../application/runtime-application";
import type { RuntimeOptions } from "../application/runtime-options";

/** Creates an unstarted Runtime application. */
export function createRuntime(options: RuntimeOptions): RuntimeApplication {
  return new RuntimeApplication(options);
}

/** Creates and fully bootstraps a Runtime application. */
export async function bootstrapApplication(options: RuntimeOptions): Promise<RuntimeApplication> {
  return new RuntimeApplication(options).bootstrap();
}
