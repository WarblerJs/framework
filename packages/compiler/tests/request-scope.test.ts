import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject } from "../src";

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function requestScopeProject(source: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-request-scope-"));
  temporaryProjects.push(root);
  const packagesRoot = resolve(import.meta.dir, "..", "..");
  const scope = join(root, "node_modules", "@warblerjs");
  mkdirSync(scope, { recursive: true });
  for (const name of ["config", "console", "core", "http", "i18n", "runtime", "transport", "validators", "websocket"]) {
    symlinkSync(join(packagesRoot, name), join(scope, name));
  }
  const typesScope = join(root, "node_modules", "@types");
  mkdirSync(typesScope, { recursive: true });
  symlinkSync(join(packagesRoot, "runtime", "node_modules", "@types", "bun"), join(typesScope, "bun"));
  await Bun.write(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { lib: ["ESNext"], types: ["bun"], target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, skipLibCheck: true, experimentalDecorators: true, noEmit: true },
    include: ["src/**/*.ts"],
  }));
  await Bun.write(join(root, "src", "application.ts"), source);
  return root;
}

const FIXTURE = `
  import { Graph, Service, ProviderScope, inject } from "@warblerjs/core";

  @Service({ provide: ProviderScope.REQUEST })
  export class RequestId {
    readonly value = Math.random();
  }

  @Service()
  export class Greeter {
    readonly requestId = inject(RequestId);
  }

  @Graph({ providers: [RequestId, Greeter] })
  export class AppGraph {}
`;

describe("request-scoped providers (compiler)", () => {
  test("compiles provide: ProviderScope.REQUEST to scope: \"request\" with no diagnostics", async () => {
    const root = await requestScopeProject(FIXTURE);
    const context = await compileProject(root);
    expect(context.diagnostics).toEqual([]);
    const graph = context.applicationWIR!.graphs[0]!;
    const requestId = graph.providers.find((provider) => provider.name === "RequestId")!;
    expect(requestId.provide).toBe("request");
    const optimized = context.generatedApplication!.optimized;
    const requestRow = optimized.providers.find((provider) => optimized.strings[provider.nameId] === "RequestId")!;
    expect(requestRow.scope).toBe("request");
    expect(requestRow.graphId).toBeGreaterThanOrEqual(0);
  });

  test("emits providers.generated.ts with scope: \"request\" and a graphId", async () => {
    const root = await requestScopeProject(FIXTURE);
    await compileProject(root);
    const providers = await Bun.file(join(root, ".warbler", "generated", "providers.generated.ts")).text();
    expect(providers).toMatch(/scope: "request"/);
    expect(providers).toMatch(/scope: "request",\s*\n\s*graphId: \d+,/);
  });

  test("rejects a root provider depending on a request-scoped provider", async () => {
    const root = await requestScopeProject(`
      import { Graph, Service, ProviderScope, inject } from "@warblerjs/core";
      @Service({ provide: ProviderScope.REQUEST }) export class RequestId {}
      @Service({ provide: ProviderScope.ROOT }) export class RootThing { readonly id = inject(RequestId); }
      @Graph({ providers: [RequestId, RootThing] }) export class AppGraph {}
    `);
    const context = await compileProject(root);
    expect(context.diagnostics.length).toBeGreaterThan(0);
  });
});
