import { defineMetadata, MetadataKeys } from "../metadata";
import type { Constructor } from "../types";
import type { ProviderScope } from "../di";

/** Metadata attached to injectable provider classes. */
export interface ProviderMetadata {
  readonly kind: "service" | "repository" | "injectable";
  readonly scope: ProviderScope;
}

function providerDecorator(kind: ProviderMetadata["kind"], scope: ProviderScope) {
  return <T extends Constructor>(target: T): T => {
    defineMetadata(target, MetadataKeys.PROVIDER, Object.freeze({ kind, scope } satisfies ProviderMetadata));
    return target;
  };
}

/** Marks a class as a service provider. */
export function Service(options: { readonly scope?: ProviderScope } = {}) {
  return providerDecorator("service", options.scope ?? "singleton");
}

/** Marks a class as a repository provider. */
export function Repository(options: { readonly scope?: ProviderScope } = {}) {
  return providerDecorator("repository", options.scope ?? "singleton");
}

/** Marks a class as a generic injectable provider. */
export function Injectable(options: { readonly scope?: ProviderScope } = {}) {
  return providerDecorator("injectable", options.scope ?? "singleton");
}
