import type { CompilerContext } from "@warbler/compiler";
import { resolveInside } from "../filesystem";
import type { DevelopmentRuntimeHandle, DevelopmentRuntimeLauncher, DevelopmentRuntimeOverrides } from "./dev-session";

/** Default launcher for the real application entry until generated executable bindings are available. */
export class ApplicationEntryRuntimeLauncher implements DevelopmentRuntimeLauncher {
  public start(projectRoot: string, _compiler: CompilerContext, overrides: DevelopmentRuntimeOverrides = {}): DevelopmentRuntimeHandle {
    const child = Bun.spawn(["bun", resolveInside(projectRoot, "src/main.ts")], {
      cwd: projectRoot, stdin: "inherit", stdout: "inherit", stderr: "inherit",
      env: {
        ...process.env,
        ...(overrides.host === undefined ? {} : { WARBLER_HOST: overrides.host }),
        ...(overrides.port === undefined ? {} : { WARBLER_PORT: overrides.port }),
        ...(overrides.mode === undefined ? {} : { WARBLER_MODE: overrides.mode }),
      },
    });
    return Object.freeze({
      stop(): void { child.kill("SIGTERM"); },
    });
  }
}
