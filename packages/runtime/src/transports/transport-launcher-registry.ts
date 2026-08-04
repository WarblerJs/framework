import { RuntimeDiagnosticCode } from "../diagnostics/runtime-diagnostic-codes";
import { InvalidApplicationBindingsError } from "../errors/runtime-errors";
import type { RuntimeTransportLauncher } from "./runtime-transport-launcher";

/** Direct keyed launcher registry constructed once during startup. */
export class TransportLauncherRegistry {
  readonly #launchers = new Map<string, RuntimeTransportLauncher>();
  public constructor(launchers: readonly RuntimeTransportLauncher[]) {
    for (const launcher of launchers) {
      if (launcher.kind.length === 0 || this.#launchers.has(launcher.kind)) {
        throw new InvalidApplicationBindingsError(RuntimeDiagnosticCode.INVALID_APPLICATION_BINDINGS, `Duplicate or invalid transport launcher: ${launcher.kind}`);
      }
      this.#launchers.set(launcher.kind, launcher);
    }
  }
  /** Returns one launcher through direct keyed lookup. */
  public get(kind: string): RuntimeTransportLauncher | undefined { return this.#launchers.get(kind); }
}
