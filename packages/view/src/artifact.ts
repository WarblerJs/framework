import type {
  CompiledPublicAsset,
  CompiledTemplateMap,
  CompiledViewArtifact,
  CompiledViewArtifactInput,
  ViewToolingHook,
  CompiledAstMap,
  ViewDependencyMap,
} from "./types";
import { parseTemplate } from "./parser";

const emptyTemplates = Object.freeze({}) as CompiledTemplateMap;
const emptyAssets =
  Object.freeze([]) as readonly CompiledPublicAsset[];
const emptyAst = Object.freeze({}) as CompiledAstMap;
const emptyDependencies = Object.freeze({}) as ViewDependencyMap;

const compareText = (left: string, right: string): number =>
  left.localeCompare(right, "en");

const freezeTemplateMap = (
  values: CompiledTemplateMap | undefined,
): CompiledTemplateMap => {
  if (values === undefined) {
    return emptyTemplates;
  }

  const output: Record<string, string> = Object.create(null);

  for (const key of Object.keys(values).sort(compareText)) {
    output[key] = String(values[key] ?? "");
  }

  return Object.freeze(output);
};

const freezeToolingHook = (
  hook: Partial<ViewToolingHook> | undefined,
): ViewToolingHook =>
  Object.freeze({
    enabled: hook?.enabled === true,
    ...(hook?.entry === undefined
      ? {}
      : { entry: hook.entry }),
  });

const freezeDependencies = (input: ViewDependencyMap | undefined): ViewDependencyMap => {
  if (input === undefined) return emptyDependencies;
  const output: Record<string, readonly string[]> = Object.create(null);
  for (const key of Object.keys(input).sort(compareText)) {
    output[key] = Object.freeze([...(input[key] ?? [])].sort(compareText));
  }
  return Object.freeze(output);
};

const freezeAst = (sources: CompiledTemplateMap, input?: CompiledAstMap): CompiledAstMap => {
  const output: Record<string, ReturnType<typeof parseTemplate>> = Object.create(null);
  for (const key of Object.keys(sources).sort(compareText)) {
    output[key] = deepFreeze(input?.[key] ?? parseTemplate(sources[key] ?? ""));
  }
  return Object.freeze(output);
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const createCompiledViewArtifact = (
  input: CompiledViewArtifactInput = Object.freeze({}),
): CompiledViewArtifact => {
  const templates = freezeTemplateMap(Object.freeze({
    ...(input.layouts ?? emptyTemplates),
    ...(input.partials ?? emptyTemplates),
    ...(input.components ?? emptyTemplates),
    ...(input.templates ?? emptyTemplates),
  }));

  return Object.freeze({
    schemaVersion: 1,
    ...(input.defaultLayout === undefined
      ? {}
      : { defaultLayout: input.defaultLayout }),
    hotReload: input.hotReload === true,
    cache: input.cache !== false,
    minify: input.minify === true,
    tailwind: freezeToolingHook(input.tailwind),
    sass: freezeToolingHook(input.sass),
    templates,
    ast: freezeAst(templates, input.ast),
    dependencies: freezeDependencies(input.dependencies),
    dependents: freezeDependencies(input.dependents),
    layouts: emptyTemplates,
    partials: emptyTemplates,
    components: emptyTemplates,
    publicAssets:
      input.publicAssets === undefined
        ? emptyAssets
        : Object.freeze([...input.publicAssets]),
  });
};
