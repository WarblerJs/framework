import { atomicWrite } from "../filesystem";
import { CLIError } from "../errors";
import { ExitCode } from "../types";

/** Supported code generator kinds. */
export type GeneratorKind = "graph";
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
    case "graph": return Object.freeze({ path: `src/graphs/${base}/${base}.graph.ts`, content: `import { defineHandler, defineHttpGraph, JsonRes } from "@warblerjs/framework";

const message = "${base}";

const index = defineHandler({
  run: () => JsonRes({
    message,
  }),
});

export default defineHttpGraph({
  prefix: "/${base}",

  middlewares: [],

  providers: [],

  routes: {
    "GET /": {
      name: "${base}.index",
      handler: index,
    },
  },
});
` });
  }
}
function normalizeName(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) throw new CLIError("CLI5002", "Generator name must contain only letters and numbers and begin with a letter.", ExitCode.INVALID_ARGUMENTS);
  return value[0]!.toUpperCase() + value.slice(1);
}
function kebab(value: string): string { return value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase(); }
function isGeneratorKind(value: string | undefined): value is GeneratorKind {
  return value === "graph";
}
