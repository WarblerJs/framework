import {
  activateCompiledViews,
  compileViewProject,
  publishViewDevelopmentUpdate,
  type CompiledViewArtifact,
  type ViewProjectConfig,
} from "@warbler/view";
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
    const isScript = (path: string): boolean =>
      scriptEntries.includes(path) || /^resources\/(?:js|scripts)\/.*\.[cm]?[jt]sx?$/u.test(path);
    const isStyle = (path: string): boolean =>
      styleEntries.includes(path) || /^resources\/(?:css|styles)\/.*\.(?:css|scss|sass)$/u.test(path);
    const assetChange = paths.some((path) => isScript(path) || isStyle(path));
    const configChange = paths.includes("src/config/view.ts");
    if (!viewChange && !assetChange && !configChange) return false;
    if (configChange) {
      this.#report(event("view", "started", "Reloading View configuration."));
      this.#config = await loadViewConfig(`${this.#projectRoot}/src/config/view.ts`, ++this.#revision);
    }
    await this.#compile(viewChange ? paths.filter((path) => path.startsWith(viewPrefix)) : undefined);
    const update = assetChange
      ? paths.some(isStyle) && !paths.some(isScript)
        ? "css"
        : "javascript"
      : "reload";
    publishViewDevelopmentUpdate(update, String(++this.#build));
    this.#report(event(
      assetChange ? "assets" : "hmr",
      "success",
      assetChange ? "Frontend assets rebuilt; browser reload is required." : "Compiled View artifact replaced atomically.",
    ));
    return !configChange && paths.every((path) =>
      path.startsWith(viewPrefix) || isScript(path) || isStyle(path)
    );
  }

  async #compile(changedTemplates?: readonly string[]): Promise<void> {
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
    });
    activateCompiledViews(result.artifact);
    this.#artifact = result.artifact;
    this.#report(event("view", "success", `View artifact ready (${result.compiled.length} template(s) compiled).`, {
      fingerprint: result.fingerprint,
      templates: result.compiled,
    }));
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
function event(
  stage: Parameters<DevelopmentReporter>[0]["stage"],
  status: Parameters<DevelopmentReporter>[0]["status"],
  message: string,
  metadata?: Readonly<Record<string, unknown>>,
): Parameters<DevelopmentReporter>[0] {
  return Object.freeze({ stage, status, message, ...(metadata === undefined ? {} : { metadata }) });
}
