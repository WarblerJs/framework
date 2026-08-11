import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject } from "../src";
import { EventDispatcher } from "@warbler/events";
import { createExecutableBindingsRuntime } from "@warbler/runtime";

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function eventProject(source: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-events-"));
  temporaryProjects.push(root);
  const packagesRoot = resolve(import.meta.dir, "..", "..");
  const scope = join(root, "node_modules", "@warbler");
  mkdirSync(scope, { recursive: true });
  for (const name of ["config", "console", "core", "events", "http", "i18n", "runtime", "transport", "validators", "websocket"]) {
    symlinkSync(join(packagesRoot, name), join(scope, name));
  }
  const typesScope = join(root, "node_modules", "@types");
  mkdirSync(typesScope, { recursive: true });
  symlinkSync(join(packagesRoot, "runtime", "node_modules", "@types", "bun"), join(typesScope, "bun"));
  await Bun.write(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      lib: ["ESNext"],
      types: ["bun"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      experimentalDecorators: true,
      noEmit: true,
      paths: {
        "@warbler/console": ["node_modules/@warbler/console/src/index.ts"],
        "@warbler/core": ["node_modules/@warbler/core/src/index.ts"],
        "@warbler/events": ["node_modules/@warbler/events/src/index.ts"],
        "@warbler/runtime": ["node_modules/@warbler/runtime/src/index.ts"],
      },
    },
    include: ["src/**/*.ts"],
  }));
  await Bun.write(join(root, "src", "application.ts"), source);
  return root;
}

const SOURCE = `
  import { Graph, Service, inject } from "@warbler/core";
  import { event, listen, interceptEvent, EventDispatcher } from "@warbler/events";

  export const UserCreated = event((userId: string, email: string) => ({ userId, email } as const));
  export const UserUpdated = event((userId: string) => ({ userId } as const));
  export const auditUserCreated = listen(UserCreated, event => event.userId);
  export const notifyUserCreated = listen(UserCreated, event => event.email);
  export const auditUserUpdated = listen(UserUpdated, event => event.userId);
  export const telemetry = interceptEvent(async (_context, next) => { await next(); });

  @Service()
  export class CreateUser {
    readonly events = inject(EventDispatcher);
    execute() { this.events.dispatch(UserCreated("1", "a@test")); }
  }

  @Graph({ providers: [CreateUser] })
  export class AppGraph {}
`;

describe("events compiler integration", () => {
  test("emits stable Policy A manifest IDs and executable listener bindings", async () => {
    const root = await eventProject(SOURCE);
    const first = await compileProject(root);
    const firstManifest = await Bun.file(join(root, ".warbler", "generated", "events.manifest.json")).json();
    const second = await compileProject(root);
    const secondManifest = await Bun.file(join(root, ".warbler", "generated", "events.manifest.json")).json();

    expect(first.diagnostics.filter((diagnostic) => diagnostic.category === "error")).toEqual([]);
    expect(firstManifest).toEqual(secondManifest);
    expect(firstManifest.policy).toBe("stable-by-module-path-and-export-name");
    expect(first.generatedApplication!.optimized.events.map((row) => first.generatedApplication!.optimized.strings[row.nameId])).toEqual(["UserCreated", "UserUpdated"]);

    const generatedEvents = await Bun.file(join(root, ".warbler", "generated", "events.generated.ts")).text();
    expect(generatedEvents).toContain("eventRuntimeBindings");
    expect(generatedEvents).toContain("listener:");
    expect(generatedEvents).not.toContain("addListener");
    expect(generatedEvents).not.toContain("Map(");
  }, 15_000);

  test("registers EventDispatcher as a generated root provider", async () => {
    const root = await eventProject(SOURCE);
    const context = await compileProject(root);
    expect(context.diagnostics.filter((diagnostic) => diagnostic.category === "error")).toEqual([]);
    const generated = await import(join(root, ".warbler", "generated", "application.generated.ts"));
    const runtime = createExecutableBindingsRuntime(generated.default);
    const provider = context.generatedApplication!.bindings!.providers.find((binding) => binding.implementation?.imported === "CreateUser")!;
    const useCase = runtime.resolveProvider(provider.graphId, provider.id) as { readonly events: EventDispatcher };
    expect(useCase.events).toBeInstanceOf(EventDispatcher);
  }, 15_000);

  test("reports definite cycles as errors and conditional cycles as warnings", async () => {
    const root = await eventProject(`
      import { Graph } from "@warbler/core";
      import { event, listen } from "@warbler/events";
      export const A = event(() => ({ ok: true } as const));
      export const B = event(() => ({ ok: true } as const));
      export const onA = listen(A, event => { void event; events.dispatch(B()); });
      export const onB = listen(B, event => { if (event.ok) events.dispatch(A()); });
      declare const events: { dispatch(value: object): void };
      @Graph() export class AppGraph {}
    `);
    const context = await compileProject(root);
    expect(context.diagnostics.some((diagnostic) => diagnostic.category === "warning" && diagnostic.message.includes("Event dispatch cycle"))).toBe(true);
    expect(context.diagnostics.some((diagnostic) => diagnostic.category === "error" && diagnostic.message.includes("Event dispatch cycle"))).toBe(false);
  }, 15_000);
});
