import { join } from "node:path";
import { joinPaths } from "../internal";
import { mimeTypeForPath } from "./mime-types";
import type { StaticPolicy } from "./static-policy";
import { resolveStaticPath } from "./resolve-static-path";

/** A static route value suitable for direct insertion into Bun's native route table. */
export type StaticRouteValue = Bun.BunFile | Readonly<Partial<Record<"GET" | "HEAD", Bun.BunFile | Response>>>;

/** Builds a static asset table once, validating every canonical file boundary. */
export async function createStaticRouteTable(
  workspaceRoot: string,
  policy: StaticPolicy,
  development = false,
): Promise<Readonly<Record<string, StaticRouteValue>>> {
  if (!policy.enabled) return Object.freeze({});
  const root = join(workspaceRoot, policy.root);
  const output: Record<string, StaticRouteValue> = Object.create(null);
  const glob = new Bun.Glob("**/*");
  for await (const relative of glob.scan({ cwd: root, onlyFiles: true })) {
    const segments = relative.split("/");
    let hidden = false;
    for (const segment of segments) if (segment.startsWith(".")) hidden = true;
    if ((!policy.exposeDotfiles && hidden) || (!policy.exposeSourceMaps && relative.endsWith(".map"))) continue;
    const canonical = await resolveStaticPath(root, relative);
    const file = Bun.file(canonical, { type: mimeTypeForPath(canonical) });
    const headers = new Headers({ "content-type": mimeTypeForPath(canonical), "x-content-type-options": "nosniff" });
    if (development) {
      headers.set("cache-control", "no-store");
    } else if (policy.cacheControl.enabled) {
      headers.set("cache-control", policy.cacheControl.immutableAssets && /\.[a-f0-9]{8,}\./iu.test(relative)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600");
    }
    const route = joinPaths(policy.prefix, relative);
    const routeValue = Object.freeze({
      GET: development ? new Response(file, { headers }) : file,
      HEAD: new Response(null, { headers }),
    });
    output[route] = routeValue;
    const lastSlash = relative.lastIndexOf("/");
    const filename = lastSlash === -1 ? relative : relative.slice(lastSlash + 1);
    if (policy.indexFiles.includes(filename)) {
      const directory = lastSlash === -1 ? "" : relative.slice(0, lastSlash);
      const indexRoute = joinPaths(policy.prefix, directory);
      if (output[indexRoute] === undefined) output[indexRoute] = routeValue;
    }
  }
  return Object.freeze(output);
}
