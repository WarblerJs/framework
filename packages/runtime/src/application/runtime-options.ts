import type { RuntimeConfig } from "@warblerjs/config";
import type { GeneratedApplicationSource, RuntimeRouteHandler, RuntimeSocketHandler } from "../generated/generated-types";
import type { RuntimeHooks } from "../hooks/runtime-hooks";
import type { RuntimeProviderDisposer, RuntimeProviderFactory } from "../providers/provider-types";
import type { RuntimeTransportConfigLoader, RuntimeTransportLoaders } from "../transports/runtime-transports";

/** Runtime configuration loader injection point. */
export type RuntimeConfigLoader = (workspaceRoot: string) => Promise<RuntimeConfig>;

/** Production Runtime bootstrap options. */
export interface RuntimeOptions {
  readonly generated: GeneratedApplicationSource;
  readonly providerFactories: readonly RuntimeProviderFactory[];
  readonly routeHandlers: readonly RuntimeRouteHandler[];
  readonly socketHandlers: readonly RuntimeSocketHandler[];
  readonly transportLoaders?: RuntimeTransportLoaders;
  readonly providerDisposers?: Readonly<Record<number, RuntimeProviderDisposer>>;
  readonly hooks?: RuntimeHooks;
  readonly workspaceRoot?: string;
  readonly installSignalHandlers?: boolean;
  readonly runtimeConfigLoader?: RuntimeConfigLoader;
  readonly transportConfigLoader?: RuntimeTransportConfigLoader;
}
