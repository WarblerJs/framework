import { defineMetadata, MetadataKeys, readMetadata } from "../metadata";
import type { Constructor } from "../types";
import { ProviderScope, type ProviderLifetime, type ProviderOptions, type ProviderToken } from "../di";

/** Injectable decorator options, including the existing instance lifetime control. */
export interface InjectableProviderOptions extends ProviderOptions {
  readonly scope?: ProviderLifetime;
}

/** Metadata attached to injectable provider classes. */
export interface ProviderMetadata {
  readonly token: Constructor;
  readonly provide: ProviderScope;
  readonly providedAs?: ProviderToken<unknown>;
  readonly dependencies: readonly Constructor[];
  readonly kind: "service" | "repository" | "factory" | "resolver" | "gateway" | "injectable";
  readonly scope: ProviderLifetime;
}

const EMPTY_DEPENDENCIES: readonly Constructor[] = Object.freeze([]);

function providerDecorator(kind: ProviderMetadata["kind"], options: InjectableProviderOptions) {
  return <T extends Constructor>(target: T): T => {
    const inherited = readProviderMetadata(Object.getPrototypeOf(target));
    const { provide, providedAs } = resolveProvide(options.provide);
    defineMetadata(target, MetadataKeys.PROVIDER, Object.freeze({
      token: target,
      provide,
      ...(providedAs === undefined ? {} : { providedAs }),
      dependencies: inherited?.dependencies ?? EMPTY_DEPENDENCIES,
      kind,
      scope: options.scope ?? "singleton",
    } satisfies ProviderMetadata));
    return target;
  };
}

/** Splits a `provide:` option into its visibility scope and, when present, its token alias. */
function resolveProvide(value: ProviderOptions["provide"]): { provide: ProviderScope; providedAs?: ProviderToken<unknown> } {
  if (value === undefined || value === ProviderScope.GRAPH || value === ProviderScope.ROOT) {
    return { provide: value ?? ProviderScope.GRAPH };
  }
  return { provide: ProviderScope.GRAPH, providedAs: value };
}

/** Marks a class as a service provider. */
export function Service(options: InjectableProviderOptions = {}) {
  return providerDecorator("service", options);
}

/** Marks a class as a repository provider. */
export function Repository(options: InjectableProviderOptions = {}) {
  return providerDecorator("repository", options);
}

/** Marks a class as a generic injectable provider. */
export function Injectable(options: InjectableProviderOptions = {}) {
  return providerDecorator("injectable", options);
}

/** Marks a class as an injectable factory provider. */
export function Factory(options: InjectableProviderOptions = {}) {
  return providerDecorator("factory", options);
}

/** Marks a class as an injectable resolver provider. */
export function Resolver(options: InjectableProviderOptions = {}) {
  return providerDecorator("resolver", options);
}

/** Marks a class as an injectable gateway provider. */
export function Gateway(options: InjectableProviderOptions = {}) {
  return providerDecorator("gateway", options);
}

/** Reads immutable provider metadata for compiler/bootstrap analysis. */
export function getProviderMetadata(target: Constructor): ProviderMetadata | undefined {
  return readProviderMetadata(target);
}

function readProviderMetadata(target: unknown): ProviderMetadata | undefined {
  if (typeof target !== "function") return undefined;
  const constructor = target as Constructor;
  const direct = readMetadata<ProviderMetadata>(constructor, MetadataKeys.PROVIDER);
  if (direct !== undefined) return direct;
  const inherited = readProviderMetadata(Object.getPrototypeOf(target));
  if (inherited === undefined) return undefined;
  const metadata = Object.freeze({ ...inherited, token: constructor });
  defineMetadata(constructor, MetadataKeys.PROVIDER, metadata);
  return metadata;
}
