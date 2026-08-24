import {
  activateCompiledViews,
  closeViewDevelopmentClients,
  compileViewProject,
  publishViewDevelopmentUpdate,
  type CompiledViewArtifact,
  type ViewProjectConfig,
} from "@warblerjs/view";
import { pathToFileURL } from "node:url";
import type { DevelopmentReporter } from "./dev-session";

interface ViewConfigModule {
  readonly default?: unknown;
  readonly viewConfig?: unknown;
}

/** CLI-owned orchestration for compile-first View artifacts. */
export class DevelopmentViewPipeline {
  readonly #projectRoot: string;
  readonly #report: DevelopmentReporter;
  #artifact: CompiledViewArtifact | undefined;
  #config: ViewProjectConfig | undefined;
  readonly #templateCandidates = new Map<string, string>();
  #revision = 0;
  #build = 0;

  public constructor(projectRoot: string, report: DevelopmentReporter) {
    this.#projectRoot = projectRoot;
    this.#report = report;
  }

  public async start(): Promise<void> {
    const configPath = `${this.#projectRoot}/src/config/view.ts`;
    if (!await Bun.file(configPath).exists()) {
      this.#report(event("view", "skipped", "View configuration is not present."));
      return;
    }
    this.#report(event("view", "started", "Loading View configuration."));
    this.#config = await loadViewConfig(configPath, ++this.#revision);
    if (this.#config.enabled === false) {
      this.#report(event("view", "skipped", "View integration is disabled."));
      return;
    }
    await this.#compile();
  }

  public async rebuild(paths: readonly string[]): Promise<boolean> {
    if (this.#config === undefined) return false;
    const viewPrefix = `${this.#config.path ?? "resources/views"}/`;
    const scriptEntries = Object.values(this.#config.assets?.scripts?.entries ?? {});
    const styleEntries = Object.values(this.#config.assets?.styles?.entries ?? {});
    const viewChange = paths.some((path) => path.startsWith(viewPrefix));
    const templateCandidatesChanged = viewChange
      ? await this.#updateTemplateCandidates(paths.filter((path) => path.startsWith(viewPrefix)), viewPrefix)
      : false;
    const isScript = (path: string): boolean =>
      scriptEntries.includes(path) || /^resources\/(?:js|scripts)\/.*\.[cm]?[jt]sx?$/u.test(path);
    const isStyle = (path: string): boolean =>
      styleEntries.includes(path) || /^resources\/(?:css|styles)\/.*\.(?:css|scss|sass)$/u.test(path);
    const tailwindSource = (path: string): boolean =>
      this.#config?.assets?.styles?.tailwind === true &&
      !path.startsWith(viewPrefix) &&
      /\.(?:[cm]?[jt]sx?|html?|css|scss|sass)$/iu.test(path);
    const assetChange = paths.some((path) => isScript(path) || isStyle(path) || tailwindSource(path)) ||
      (this.#config.assets?.styles?.tailwind === true && templateCandidatesChanged);
    const configChange = paths.includes("src/config/view.ts");
    if (!viewChange && !assetChange && !configChange) return false;
    if (configChange) {
      this.#report(event("view", "started", "Reloading View configuration."));
      this.#config = await loadViewConfig(`${this.#projectRoot}/src/config/view.ts`, ++this.#revision);
    }
    await this.#compile(
      viewChange ? paths.filter((path) => path.startsWith(viewPrefix)) : undefined,
      assetChange,
    );
    const update = viewChange
      ? "reload"
      : assetChange
      ? paths.some(isStyle) && !paths.some(isScript)
        ? "css"
        : paths.some(isScript)
          ? "javascript"
          : "css"
      : "reload";
    publishViewDevelopmentUpdate(update, String(++this.#build));
    this.#report(event(
      assetChange ? "assets" : "hmr",
      "success",
      assetChange ? "Frontend assets rebuilt; browser reload is required." : "Compiled View artifact replaced atomically.",
    ));
    return !configChange && paths.every((path) =>
      path.startsWith(viewPrefix) || isScript(path) || isStyle(path) ||
      (tailwindSource(path) && !path.startsWith("src/"))
    );
  }

  /** Cleanly ends active View development SSE streams before the native HTTP server is torn down or replaced. */
  public close(): void {
    closeViewDevelopmentClients();
  }

  async #compile(changedTemplates?: readonly string[], buildAssets = true): Promise<void> {
    const config = this.#config;
    if (config === undefined) return;
    this.#report(event("view", "started", changedTemplates === undefined
      ? "Compiling View templates and assets."
      : "Compiling affected View templates."));
    const result = await compileViewProject({
      projectRoot: this.#projectRoot,
      config,
      mode: "development",
      ...(this.#artifact === undefined ? {} : { previous: this.#artifact }),
      ...(changedTemplates === undefined ? {} : { changedTemplates }),
      buildAssets,
    });
    activateCompiledViews(result.artifact);
    this.#artifact = result.artifact;
    this.#resetTemplateCandidates(result.artifact.templates);
    this.#report(event("view", "success", `View artifact ready (${result.compiled.length} template(s) compiled).`, {
      fingerprint: result.fingerprint,
      templates: result.compiled,
    }));
  }

  async #updateTemplateCandidates(paths: readonly string[], viewPrefix: string): Promise<boolean> {
    const before = candidateFingerprint(this.#templateCandidates);
    const extension = this.#config?.extension ?? ".html";
    for (const path of paths) {
      const relative = path.slice(viewPrefix.length).replaceAll("\\", "/");
      const logicalName = (relative.endsWith(extension)
        ? relative.slice(0, -extension.length)
        : relative).replaceAll("/", ".");
      const file = Bun.file(`${this.#projectRoot}/${path}`);
      if (!await file.exists()) {
        this.#templateCandidates.delete(logicalName);
        continue;
      }
      this.#templateCandidates.set(logicalName, classCandidateSignature(await file.text()));
    }
    return before !== candidateFingerprint(this.#templateCandidates);
  }

  #resetTemplateCandidates(templates: Readonly<Record<string, string>>): void {
    this.#templateCandidates.clear();
    for (const [name, source] of Object.entries(templates)) {
      this.#templateCandidates.set(name, classCandidateSignature(source));
    }
  }
}

async function loadViewConfig(path: string, revision: number): Promise<ViewProjectConfig> {
  const url = pathToFileURL(path);
  url.searchParams.set("view", String(revision));
  const loaded: unknown = await import(url.href);
  const module = loaded as ViewConfigModule;
  const candidate = module.viewConfig ?? module.default;
  if (!isRecord(candidate)) throw new TypeError("View configuration must export viewConfig or a default object.");
  return candidate as ViewProjectConfig;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Stable static utility signature used to decide whether Tailwind must rebuild after HTML edits. */
export function classCandidateSignature(source: string): string {
  const candidates = new Set<string>();
  const attributes = /\bclass(?:Name)?\s*=\s*(["'])(.*?)\1/gsu;
  for (const match of source.matchAll(attributes)) {
    for (const candidate of (match[2] ?? "").split(/\s+/u)) {
      const normalized = candidate.trim();
      if (normalized.length > 0 && !normalized.includes("{{") && !normalized.includes("{!!")) {
        candidates.add(normalized);
      }
    }
  }
  return [...candidates].sort().join("\u0000");
}
function candidateFingerprint(candidates: ReadonlyMap<string, string>): string {
  const serialized = [...candidates.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  ).map(([name, value]) => `${name}\u0001${value}`).join("\u0002");
  return Bun.hash(serialized).toString(16);
}
function event(
  stage: Parameters<DevelopmentReporter>[0]["stage"],
  status: Parameters<DevelopmentReporter>[0]["status"],
  message: string,
  metadata?: Readonly<Record<string, unknown>>,
): Parameters<DevelopmentReporter>[0] {
  return Object.freeze({ stage, status, message, ...(metadata === undefined ? {} : { metadata }) });
}
