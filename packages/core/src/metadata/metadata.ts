import type { Constructor } from "../types";

const metadataStore = new WeakMap<Constructor, Map<symbol, unknown>>();

/** Defines immutable metadata for a class token. */
export function defineMetadata<T>(target: Constructor, key: symbol, value: T): void {
  let map = metadataStore.get(target);
  if (!map) {
    map = new Map();
    metadataStore.set(target, map);
  }
  map.set(key, value);
}

/** Reads metadata previously attached to a class token. */
export function readMetadata<T>(target: Constructor, key: symbol): T | undefined {
  return metadataStore.get(target)?.get(key) as T | undefined;
}
