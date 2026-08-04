import { atomicWrite } from "../filesystem";
import { CLIError } from "../errors";
import { ExitCode } from "../types";

/** Supported code generator kinds. */
export type GeneratorKind = "graph" | "controller" | "socket-controller" | "service" | "repository" | "validator" | "guard";
/** Planned generated file. */
export interface GeneratedFilePlan { readonly path: string; readonly content: string }

/** Generates one current Warbler source declaration. */
export async function generateSource(
  projectRoot: string,
  kind: string | undefined,
  rawName: string | undefined,
  options: Readonly<{ force?: boolean; dryRun?: boolean }> = {},
): Promise<GeneratedFilePlan> {
  if (!isGeneratorKind(kind)) throw new CLIError("CLI5001", `Unknown generator: ${kind ?? ""}`, ExitCode.INVALID_ARGUMENTS);
  const name = normalizeName(rawName);
  const base = kebab(name);
  const plan = createPlan(kind, name, base);
  if (!options.dryRun) await atomicWrite(projectRoot, plan.path, plan.content, options.force);
  return plan;
}

function createPlan(kind: GeneratorKind, name: string, base: string): GeneratedFilePlan {
  switch (kind) {
    case "graph": return Object.freeze({ path: `src/graphs/${base}/${base}.graph.ts`, content: `import { Graph } from "@warbler/core";

@Graph({
  prefix: "/${base}",
  controllers: [],
  providers: [],
})
export default class ${name}Graph {}
` });
    case "controller": return Object.freeze({ path: `src/graphs/${base}/${base}.controller.ts`, content: `import { Controller, Get, JsonRes } from "@warbler/http";

@Controller()
export default class ${name}Controller {
  @Get("/")
  index(): Response {
    return JsonRes({ message: "${name}Controller.index" });
  }
}
` });
    case "socket-controller": return Object.freeze({ path: `src/graphs/${base}/${base}.socket-controller.ts`, content: `import { OnOpen, SocketController, type SocketContext } from "@warbler/websocket";

@SocketController()
export default class ${name}SocketController {
  @OnOpen()
  connected(context: SocketContext): void {
    context.send({ event: "connection.ready", data: { connectionId: context.connection.id } });
  }
}
` });
    case "service": return Object.freeze({ path: `src/graphs/${base}/${base}.service.ts`, content: `import { Service } from "@warbler/core";

@Service()
export default class ${name}Service {}
` });
    case "repository": return Object.freeze({ path: `src/graphs/${base}/${base}.repository.ts`, content: `import { Repository } from "@warbler/core";

@Repository()
export default class ${name}Repository {}
` });
    case "validator": return Object.freeze({ path: `src/graphs/${base}/${base}.validator.ts`, content: `export function validate${name}(input: unknown): boolean {
  return input !== undefined;
}
` });
    case "guard": return Object.freeze({ path: `src/graphs/${base}/${base}.guard.ts`, content: `import type { Guard } from "@warbler/core";

interface ${name}GuardContext {
  readonly [key: string]: unknown;
  readonly user?: unknown;
}

export const ${lowerFirst(name)}Guard: Guard<${name}GuardContext> = (context): boolean => {
  return context.user !== undefined;
};
` });
  }
}
function normalizeName(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) throw new CLIError("CLI5002", "Generator name must contain only letters and numbers and begin with a letter.", ExitCode.INVALID_ARGUMENTS);
  return value[0]!.toUpperCase() + value.slice(1);
}
function kebab(value: string): string { return value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase(); }
function lowerFirst(value: string): string { return value[0]!.toLowerCase() + value.slice(1); }
function isGeneratorKind(value: string | undefined): value is GeneratorKind {
  return value === "graph" || value === "controller" || value === "socket-controller" || value === "service" || value === "repository" || value === "validator" || value === "guard";
}
