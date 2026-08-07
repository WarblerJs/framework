import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject } from "../src";

const temporaryProjects: string[] = [];
afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function contextProject(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "warbler-context-"));
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
    compilerOptions: { lib: ["ESNext"], types: ["bun"], target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true },
    include: ["src/**/*.ts"],
  }));
  await Bun.write(join(root, "src", "types.ts"), `
    export interface User { readonly id: string; readonly email: string }
    export interface Tenant { readonly id: string }
  `);
  await Bun.write(join(root, "src", "application.ts"), `
    import { Graph, Service, inject } from "@warbler/core";
    import { Controller, Get, type Guard, type Middleware } from "@warbler/http";
    import type { User, Tenant } from "./types";

    export const authGuard: Guard = (req, context): boolean => {
      const user: User = { id: "1", email: "a@b.com" };
      context.set("user", user);
      return true;
    };
    export const tenantMiddleware: Middleware = (req, context, next) => {
      context.set<Tenant>("tenant", { id: "t1" });
      context.set("requestId", () => "req-1");
      context.set("session", async () => "session-token");
      return next();
    };

    @Service() export class Logger {}
    @Controller("/users") export class UsersController {
      @Get("", { guards: [authGuard], middleware: [tenantMiddleware] })
      list() {}
    }
    @Graph({ prefix: "/api", controllers: [UsersController], providers: [Logger] })
    export class AppGraph {}
  `);
  return root;
}

describe("context.set(...) analysis and WarblerRequestContext generation", () => {
  test("always emits context.generated.d.ts, even before any guard/middleware exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "warbler-context-empty-"));
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
      compilerOptions: { lib: ["ESNext"], types: ["bun"], target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true },
      include: ["src/**/*.ts"],
    }));
    await Bun.write(join(root, "src", "application.ts"), `
      import { Graph, Service } from "@warbler/core";
      import { Controller, Get } from "@warbler/http";
      @Service() export class Logger {}
      @Controller("/users") export class UsersController { @Get("") list() {} }
      @Graph({ prefix: "/api", controllers: [UsersController], providers: [Logger] })
      export class AppGraph {}
    `);
    await compileProject(root);
    const text = await Bun.file(join(root, ".warbler", "generated", "context.generated.d.ts")).text();
    expect(text).toContain("declare module \"@warbler/http\"");
    expect(text).toContain("interface WarblerRequestContext");
  }, 15_000);

  test("extracts key+type from literal, explicit-generic, sync-factory, and async-factory context.set() calls", async () => {
    const root = await contextProject();
    await compileProject(root);
    const text = await Bun.file(join(root, ".warbler", "generated", "context.generated.d.ts")).text();
    expect(text).toContain("declare module \"@warbler/http\"");
    expect(text).toMatch(/readonly user\?: User;/);
    expect(text).toMatch(/readonly tenant\?: Tenant;/);
    expect(text).toMatch(/readonly requestId\?: string;/);
    expect(text).toMatch(/readonly session\?: string;/); // async factory unwrapped from Promise<string>
    expect(text).toContain("import type { User } from \"../../src/types\"");
    expect(text).toContain("import type { Tenant } from \"../../src/types\"");
  }, 15_000);

  test("every generated key is optional, since the compiler can't prove every request path sets it", async () => {
    const root = await contextProject();
    await compileProject(root);
    const text = await Bun.file(join(root, ".warbler", "generated", "context.generated.d.ts")).text();
    for (const line of text.split("\n").filter((line) => line.includes("readonly") && line.includes(":"))) {
      expect(line).toContain("?:");
    }
  }, 15_000);

  test("the generated declaration merges cleanly and produces no diagnostics when type-checked", async () => {
    const root = await contextProject();
    await compileProject(root);
    const ts = await import("typescript");
    const generatedDir = join(root, ".warbler", "generated");
    const probe = join(root, "src", "probe.ts");
    await Bun.write(probe, `
      /// <reference path="../.warbler/generated/context.generated.d.ts" />
      import type { AppRequest } from "@warbler/http";
      declare const req: AppRequest;
      const userId: string | undefined = req.context.user?.id;
      const tenantId: string | undefined = req.context.tenant?.id;
    `);
    const program = ts.createProgram({
      rootNames: [probe],
      options: {
        strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler,
        baseUrl: root, paths: { "@warbler/http": [join(root, "node_modules/@warbler/http/src/index.ts")] },
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === probe);
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    void generatedDir;
  }, 15_000);
});
