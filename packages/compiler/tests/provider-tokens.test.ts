import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject } from "../src";
import { createExecutableBindingsRuntime } from "@warbler/runtime";

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function tokenProject(source: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-tokens-"));
  temporaryProjects.push(root);
  const packagesRoot = resolve(import.meta.dir, "..", "..");
  const scope = join(root, "node_modules", "@warbler");
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
  import { Graph, Service, Provider, createToken, inject } from "@warbler/core";

  export abstract class LoggerPort { abstract log(message: string): void; }
  export const APP_NAME = createToken<string>("APP_NAME");
  export const CACHE = createToken<{ hits: number }>("CACHE");
  export const ALIAS_LOGGER = createToken<LoggerPort>("ALIAS_LOGGER");

  @Service({ provide: LoggerPort })
  export class ConsoleLogger extends LoggerPort {
    log(message: string) {}
  }

  @Service()
  export class Greeter {
    readonly logger = inject(LoggerPort);
    readonly appName = inject(APP_NAME);
    readonly cache = inject(CACHE);
    readonly aliasLogger = inject(ALIAS_LOGGER);
  }

  @Graph({
    providers: [
      ConsoleLogger,
      Greeter,
      Provider({ provide: APP_NAME, useValue: "Warbler" }),
      Provider({ provide: CACHE, useFactory: () => ({ hits: 0 }) }),
      Provider({ provide: ALIAS_LOGGER, useExisting: LoggerPort }),
    ],
  })
  export class AppGraph {}
`;

describe("token-based provider resolution", () => {
  test("resolves an abstract-class token alias with no diagnostics", async () => {
    const root = await tokenProject(FIXTURE);
    const context = await compileProject(root);
    expect(context.diagnostics).toEqual([]);
    const graph = context.applicationWIR!.graphs[0]!;
    const consoleLogger = graph.providers.find((provider) => provider.name === "ConsoleLogger")!;
    expect(consoleLogger.token).toBe("LoggerPort");
    const greeter = graph.providers.find((provider) => provider.name === "Greeter")!;
    expect([...greeter.dependencies].sort()).toEqual(["ALIAS_LOGGER", "APP_NAME", "CACHE", "LoggerPort"].sort());
  });

  test("resolves Provider({...}) useValue/useFactory/useExisting registrations without unresolved (-1) dependencies", async () => {
    const root = await tokenProject(FIXTURE);
    const context = await compileProject(root);
    const optimized = context.generatedApplication!.optimized;
    expect(optimized.providerDependencies).not.toContain(-1);
  });

  test("emits providers.generated.ts with token-aliased and use* factories", async () => {
    const root = await tokenProject(FIXTURE);
    await compileProject(root);
    const providers = await Bun.file(join(root, ".warbler", "generated", "providers.generated.ts")).text();
    expect(providers).toContain("token: Binding");
    expect(providers).toContain('(context: ProviderBindingContext) => ("Warbler")');
    expect(providers).toContain("context.run(() => (() => ({ hits: 0 }))())");
    expect(providers).toMatch(/context\.resolve\(Binding\d+_LoggerPort\)/);
  });

  test("resolves the full provider graph at runtime, including chained aliases", async () => {
    const root = await tokenProject(FIXTURE);
    const context = await compileProject(root);
    expect(context.diagnostics).toEqual([]);
    const generated = await import(join(root, ".warbler", "generated", "application.generated.ts"));
    const runtime = createExecutableBindingsRuntime(generated.default);
    const greeterBinding = context.generatedApplication!.bindings!.providers.find((item) => item.implementation?.imported === "Greeter")!;
    const greeter = runtime.resolveProvider(greeterBinding.graphId, greeterBinding.id) as {
      readonly logger: { readonly log: (message: string) => void };
      readonly appName: string;
      readonly cache: { readonly hits: number };
      readonly aliasLogger: unknown;
    };
    expect(greeter.appName).toBe("Warbler");
    expect(greeter.cache).toEqual({ hits: 0 });
    expect(greeter.aliasLogger).toBe(greeter.logger);
    expect(greeter.logger.constructor.name).toBe("ConsoleLogger");
  }, 15_000);

  test("resolves string and symbol tokens", async () => {
    const root = await tokenProject(`
      import { Graph, Service, Provider, inject } from "@warbler/core";
      export const CACHE_SYMBOL = Symbol("cache");
      export class MemoryCache {}
      @Service()
      export class Consumer {
        readonly cache = inject<MemoryCache>("cache");
        readonly symbolCache = inject<MemoryCache>(CACHE_SYMBOL);
      }
      @Graph({
        providers: [
          Consumer,
          Provider({ provide: "cache", useClass: MemoryCache }),
          Provider({ provide: CACHE_SYMBOL, useClass: MemoryCache }),
        ],
      })
      export class AppGraph {}
    `);
    const context = await compileProject(root);
    expect(context.diagnostics).toEqual([]);
    const optimized = context.generatedApplication!.optimized;
    expect(optimized.providerDependencies).not.toContain(-1);
  });

  test("reports a diagnostic for Provider(...) missing a provide token", async () => {
    const root = await tokenProject(`
      import { Graph, Provider } from "@warbler/core";
      // @ts-expect-error missing required "provide"
      @Graph({ providers: [Provider({ useValue: "oops" })] })
      class AppGraph {}
    `);
    const context = await compileProject(root);
    expect(context.diagnostics).toContainEqual(expect.objectContaining({
      code: "WARBLER1005",
      message: expect.stringContaining("is missing a \"provide\" token"),
    }));
  });

  test("reports a diagnostic for Provider(...) missing a use* registration", async () => {
    const root = await tokenProject(`
      import { Graph, Provider, createToken } from "@warbler/core";
      const TOKEN = createToken<string>("TOKEN");
      // @ts-expect-error missing required use* field
      @Graph({ providers: [Provider({ provide: TOKEN })] })
      class AppGraph {}
    `);
    const context = await compileProject(root);
    expect(context.diagnostics).toContainEqual(expect.objectContaining({
      code: "WARBLER1005",
      message: expect.stringContaining("must declare useClass, useValue, useFactory, or useExisting"),
    }));
  });
});
