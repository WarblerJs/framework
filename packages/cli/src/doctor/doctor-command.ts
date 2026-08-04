import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import type { CLIDiagnostic } from "../diagnostics";
import { cliDiagnostic } from "../diagnostics";
import { loadCLIConfig, loadEnabledTransportConfigs, resolveEnabledTransports } from "../config";
import { assertRealPathInside, pathExists, resolveInside } from "../filesystem";
import type { ProjectLayout } from "../project";
import { readProjectPackage } from "../project";

const PACKAGES: Readonly<Record<string, string>> = Object.freeze({
  http: "@warbler/http", websocket: "@warbler/websocket", tcp: "@warbler/tcp",
  udp: "@warbler/udp", mcp: "@warbler/mcp", webrtc: "@warbler/webrtc",
});
/** Runs actionable health checks without compiling or starting Runtime. */
export async function doctorCommand(layout: ProjectLayout): Promise<readonly CLIDiagnostic[]> {
  const diagnostics: CLIDiagnostic[] = [];
  const version = Bun.version.split(".").map(Number);
  if ((version[0] ?? 0) < 1 || ((version[0] ?? 0) === 1 && (version[1] ?? 0) < 3)) diagnostics.push(cliDiagnostic({ code: "CLI4001", severity: "error", message: `Bun >= 1.3 is required; found ${Bun.version}.` }));
  const packageJson = await readProjectPackage(layout.root);
  const dependencies = packageNames(packageJson);
  if (!dependencies.has("@warbler/core")) diagnostics.push(cliDiagnostic({ code: "CLI4002", severity: "error", message: "Missing @warbler/core dependency.", suggestion: "Add @warbler/core to application dependencies." }));
  try {
    const config = await loadCLIConfig(layout.root);
    await loadEnabledTransportConfigs(config, layout.root);
    for (const transport of resolveEnabledTransports(config)) {
      const packageName = PACKAGES[transport]!;
      if (!dependencies.has(packageName)) diagnostics.push(cliDiagnostic({ code: "CLI4003", severity: "error", message: `Enabled transport package is missing: ${packageName}`, metadata: { transport } }));
      else {
        try { Bun.resolveSync(packageName, layout.root); }
        catch { diagnostics.push(cliDiagnostic({ code: "CLI4006", severity: "error", message: `Enabled transport package cannot be resolved: ${packageName}`, metadata: { transport } })); }
      }
    }
  } catch (cause) {
    diagnostics.push(cliDiagnostic({ code: "CLI4004", severity: "error", message: "Runtime or enabled transport configuration is invalid.", metadata: { detail: safeMessage(cause) } }));
  }
  for (const directory of [".warbler", "dist"] as const) {
    const path = resolveInside(layout.root, directory);
    try { await mkdir(path, { recursive: true }); await access(path, constants.W_OK); }
    catch { diagnostics.push(cliDiagnostic({ code: "CLI4005", severity: "error", message: `Directory is not writable: ${directory}` })); }
  }
  if (await pathExists(layout.publicDirectory)) {
    try { await assertRealPathInside(layout.root, layout.publicDirectory); }
    catch { diagnostics.push(cliDiagnostic({ code: "CLI4007", severity: "error", message: "Public directory resolves outside the project boundary." })); }
  }
  if (diagnostics.length === 0) diagnostics.push(cliDiagnostic({ code: "CLI4000", severity: "info", message: "Project is healthy." }));
  return Object.freeze(diagnostics);
}
function packageNames(value: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const record = value[field];
    if (typeof record === "object" && record !== null && !Array.isArray(record)) for (const name of Object.keys(record)) names.add(name);
  }
  return names;
}
function safeMessage(cause: unknown): string { return cause instanceof Error ? cause.message : "Unknown configuration failure"; }
