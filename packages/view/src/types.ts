export type ViewDataValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | Date
  | readonly ViewDataValue[]
  | { readonly [key: string]: ViewDataValue };

export type ViewData = Readonly<Record<string, ViewDataValue>>;

export type CompiledTemplateMap = Readonly<Record<string, string>>;
import type { TemplateAst } from "./ast";

export type CompiledAstMap = Readonly<Record<string, TemplateAst>>;
export type ViewDependencyMap = Readonly<Record<string, readonly string[]>>;

export interface CompiledPublicAsset {
  readonly path: string;
  readonly body: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ViewToolingHook {
  readonly enabled: boolean;
  readonly entry?: string;
}

export interface CompiledViewArtifact {
  readonly schemaVersion: 1;
  readonly defaultLayout?: string;
  readonly hotReload: boolean;
  readonly cache: boolean;
  readonly minify: boolean;
  readonly tailwind: ViewToolingHook;
  readonly sass: ViewToolingHook;
  readonly templates: CompiledTemplateMap;
  readonly ast: CompiledAstMap;
  readonly dependencies: ViewDependencyMap;
  readonly dependents: ViewDependencyMap;
  readonly layouts: CompiledTemplateMap;
  readonly partials: CompiledTemplateMap;
  readonly components: CompiledTemplateMap;
  readonly publicAssets: readonly CompiledPublicAsset[];
}

export interface CompiledViewArtifactInput {
  readonly defaultLayout?: string;
  readonly hotReload?: boolean;
  readonly cache?: boolean;
  readonly minify?: boolean;
  readonly tailwind?: Partial<ViewToolingHook>;
  readonly sass?: Partial<ViewToolingHook>;
  readonly templates?: CompiledTemplateMap;
  readonly ast?: CompiledAstMap;
  readonly dependencies?: ViewDependencyMap;
  readonly dependents?: ViewDependencyMap;
  readonly layouts?: CompiledTemplateMap;
  readonly partials?: CompiledTemplateMap;
  readonly components?: CompiledTemplateMap;
  readonly publicAssets?: readonly CompiledPublicAsset[];
}

export interface RenderCompiledViewOptions {
  readonly artifact: CompiledViewArtifact;
  readonly name: string;
  readonly data?: ViewData;
  readonly translate?: (key: string) => string;
}

export interface RendererContext {
  readonly viewName: string;
  readonly renderTemplate: (
    name: string,
    data: ViewData,
  ) => string;
  readonly translate?: (key: string) => string;
}

export type CompiledTemplate = (data?: ViewData) => string;

export interface ViewResponseOptions {
  readonly status?: number;
  readonly headers?: Bun.HeadersInit;
}

export interface ViewProjectConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly extension?: string;
  readonly public?: string;
  readonly cache?: boolean;
  readonly hotReload?: boolean;
  readonly minify?: boolean;
  readonly defaultLayout?: string;
  readonly assets?: Readonly<{
    readonly enabled?: boolean;
    readonly scripts?: Readonly<{ readonly entries?: Readonly<Record<string, string>> }>;
    readonly styles?: Readonly<{
      readonly entries?: Readonly<Record<string, string>>;
      readonly tailwind?: boolean;
    }>;
    readonly development?: Readonly<{ readonly sourceMaps?: boolean }>;
    readonly production?: Readonly<{ readonly minify?: boolean }>;
  }>;
}

export interface ViewCompilationResult {
  readonly artifact: CompiledViewArtifact;
  readonly compiled: readonly string[];
  readonly fingerprint: string;
}
