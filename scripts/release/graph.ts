import { ReleaseError, type WorkspacePackage } from "./types";
import { internalDependencies } from "./manifest";

export function topologicalOrder(packages: readonly WorkspacePackage[]): readonly WorkspacePackage[] {
  const byName = new Map(packages.map((item) => [item.name, item] as const));
  const names = new Set(byName.keys());
  const incoming = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const item of packages) {
    const deps = internalDependencies(item.manifest, names);
    incoming.set(item.name, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(item.name);
      dependents.set(dep, list);
    }
  }
  const ready = [...packages].filter((item) => (incoming.get(item.name) ?? 0) === 0).sort(compareByName);
  const ordered: WorkspacePackage[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);
    for (const dependent of (dependents.get(current.name) ?? []).sort()) {
      const next = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, next);
      if (next === 0) ready.push(byName.get(dependent)!);
    }
    ready.sort(compareByName);
  }
  if (ordered.length !== packages.length) {
    const cycle = [...incoming.entries()].filter(([, count]) => count > 0).map(([name]) => name).sort().join(" -> ");
    throw new ReleaseError(`Internal dependency cycle detected: ${cycle}`);
  }
  return Object.freeze(ordered);
}

function compareByName(left: WorkspacePackage, right: WorkspacePackage): number {
  return left.name.localeCompare(right.name);
}
