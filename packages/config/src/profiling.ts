import { resolve } from "node:path";

/** Runtime profiling configuration normalized at startup. */
export interface ProfilingConfig {
  readonly http: boolean;
  readonly summaryOnStop: boolean;
}

/** User-facing `profilingConfig` shape. */
export interface ProfilingConfigInput {
  readonly http?: boolean;
  readonly summaryOnStop?: boolean;
}

/** Normalizes profiling config into an immutable startup policy. */
export function normalizeProfilingConfig(input: ProfilingConfigInput = Object.freeze({})): ProfilingConfig {
  return Object.freeze({
    http: input.http ?? false,
    summaryOnStop: input.summaryOnStop ?? true,
  });
}

/** Loads `src/config/profiling.config.ts`, accepting `profilingConfig` or default export. */
export async function loadProfilingConfig(projectRoot: string): Promise<ProfilingConfig> {
  const path = resolve(projectRoot, "src/config/profiling.config.ts");
  if (!await Bun.file(path).exists()) return normalizeProfilingConfig();
  const module = await import(path) as Readonly<Record<string, unknown>>;
  const candidate = module.profilingConfig ?? module.default ?? Object.freeze({});
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new TypeError("Profiling configuration must export profilingConfig or a default object.");
  }
  return normalizeProfilingConfig(candidate as ProfilingConfigInput);
}
