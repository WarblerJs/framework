/**
 * Application-wide shape of `AppRequest.context`.
 *
 * Starts empty and is augmented per-app by `@warblerjs/compiler`, which scans every
 * `context.set(...)` call in guards and middleware and emits a declaration-merged
 * `WarblerRequestContext` interface into `.warbler/generated/context.generated.d.ts`.
 * Controllers never need to reference this type directly — it's picked up
 * automatically as `AppRequest`'s default `TContext`.
 */
export interface WarblerRequestContext {
  readonly [key: string]: unknown;
}
