import { compileProject } from "@warblerjs/compiler";
import { loadCLIConfig, resolveEnabledTransports } from "../config";
import { CLIError } from "../errors";
import type { ProjectLayout } from "../project";
import { ExitCode } from "../types";

/** Stable application inspection data. */
export interface InspectionResult {
  readonly graphs: number;
  readonly providers: number;
  readonly controllers: number;
  readonly handlers: number;
  readonly guards: number;
  readonly validators: number;
  readonly routes: number;
  readonly socketEvents: number;
  readonly transports: Readonly<Record<string, boolean>>;
  readonly applicationEntry?: string;
  readonly fingerprint?: string;
  readonly detail: unknown;
}
/** Inspects compiler WIR and Runtime configuration without independent analysis. */
export async function inspectCommand(layout: ProjectLayout, section = "summary"): Promise<InspectionResult> {
  if (!["summary", "graphs", "routes", "providers", "transports", "config"].includes(section)) throw new CLIError("CLI4101", `Unknown inspect section: ${section}`, ExitCode.INVALID_ARGUMENTS);
  const [compiler, config] = await Promise.all([compileProject(layout.root), loadCLIConfig(layout.root)]);
  const errors = compiler.diagnostics.filter((diagnostic) => diagnostic.category === "error");
  if (errors.length > 0) throw new CLIError("CLI4102", "Application cannot be inspected because compilation failed.", ExitCode.FAILURE);
  const wir = compiler.applicationWIR!;
  const controllers = wir.graphs.flatMap((graph) => graph.controllers);
  const providers = [...wir.rootProviders, ...wir.graphs.flatMap((graph) => graph.providers)];
  const routes = controllers.flatMap((controller) => controller.routes);
  const socketEvents = controllers.flatMap((controller) => controller.socketEvents);
  const transports = Object.freeze(Object.fromEntries(Object.entries(config.transports).map(([name, value]) => [name, value.enabled])));
  const detail = section === "graphs" ? wir.graphs : section === "routes" ? routes : section === "providers" ? providers : section === "transports" ? transports : section === "config" ? config : undefined;
  const optimized = compiler.generatedApplication?.optimized;
  return Object.freeze({
    graphs: wir.graphs.length,
    providers: providers.length,
    controllers: controllers.length,
    handlers: optimized?.handlers.length ?? 0,
    guards: optimized?.guards.length ?? 0,
    validators: optimized?.validators.length ?? 0,
    routes: routes.length,
    socketEvents: socketEvents.length,
    transports,
    ...(compiler.applicationEntry === undefined ? {} : { applicationEntry: compiler.applicationEntry }),
    ...(compiler.fingerprint === undefined ? {} : { fingerprint: compiler.fingerprint }),
    detail,
  });
}
