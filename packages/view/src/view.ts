import { CompiledViewEngine } from "./engine";
import { ViewNotFoundException } from "./errors";
import type { CompiledViewArtifact, ViewData, ViewResponseOptions } from "./types";
import { VIEW_DEVELOPMENT_SCRIPT } from "./development";

let activeEngine: CompiledViewEngine | undefined;
let activeArtifact: CompiledViewArtifact | undefined;

/** Atomically replaces the process-wide immutable render artifact. */
export function activateCompiledViews(
  artifact: CompiledViewArtifact,
  translate?: (key: string) => string,
): void {
  const next = new CompiledViewEngine(artifact, translate);
  activeArtifact = artifact;
  activeEngine = next;
}

/** Returns the active immutable artifact for diagnostics and development orchestration. */
export function activeCompiledViews(): CompiledViewArtifact | undefined {
  return activeArtifact;
}

/** Existing application-facing View response API. */
export function View(
  name: string,
  data: ViewData = Object.freeze({}),
  options: ViewResponseOptions = Object.freeze({}),
): Response {
  const engine = activeEngine;
  if (engine === undefined) throw new ViewNotFoundException(name);
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  let html = engine.render(name, data);
  if (activeArtifact?.hotReload === true && !html.includes("data-warbler-view")) {
    html = html.includes("</body>")
      ? html.replace("</body>", `${VIEW_DEVELOPMENT_SCRIPT}</body>`)
      : `${html}${VIEW_DEVELOPMENT_SCRIPT}`;
  }
  return new Response(html, {
    ...(options.status === undefined ? {} : { status: options.status }),
    headers,
  });
}
