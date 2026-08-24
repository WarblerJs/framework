import type { GraphGeneratedFile, GraphGenerationPlan, GraphTransport } from "./graph-generation.types";

/** The centralized default transport for Graph generation. */
export const DEFAULT_TRANSPORT = "http" as const;

export interface TransportPreset {
  readonly directory: string;
  readonly presentationDirectories: readonly string[];
  readonly renderFiles: (plan: Omit<GraphGenerationPlan, "files">, transportCount: number) => readonly GraphGeneratedFile[];
}

export const transportPresets = Object.freeze({
  http: Object.freeze({
    directory: "http",
    presentationDirectories: Object.freeze(["handlers", "validation", "guards", "middleware"]),
    renderFiles: renderHttpFiles,
  }),
  socket: Object.freeze({
    directory: "socket",
    presentationDirectories: Object.freeze(["handlers", "validation", "guards", "middleware"]),
    renderFiles: renderSocketFiles,
  }),
} as const satisfies Readonly<Record<string, TransportPreset>>);

function graphFileName(plan: Omit<GraphGenerationPlan, "files">, transport: GraphTransport, transportCount: number): string {
  return transportCount === 1
    ? `${plan.directoryName}.graph.ts`
    : `${plan.directoryName}.${transport}.graph.ts`;
}

function renderHttpFiles(plan: Omit<GraphGenerationPlan, "files">, transportCount: number): readonly GraphGeneratedFile[] {
  const handlerModule = `./presentation/http/handlers/${plan.directoryName}.handlers`;
  return Object.freeze([
    Object.freeze({
      path: `${plan.rootDirectory}/${graphFileName(plan, "http", transportCount)}`,
      content: `import { defineHttpGraph } from "@warbler/framework";

import * as handlers from ${JSON.stringify(handlerModule)};

export default defineHttpGraph({
  prefix: ${JSON.stringify(plan.routePrefix)},

  middlewares: [],

  providers: [],

  routes: {
    "GET /": {
      name: ${JSON.stringify(`${plan.routeNamePrefix}.index`)},
      handler: handlers.index,
    },
  },
});
`,
    }),
    Object.freeze({
      path: `${plan.rootDirectory}/presentation/http/handlers/${plan.directoryName}.handlers.ts`,
      content: `import { defineHandler, JsonRes } from "@warbler/framework";

const message = ${JSON.stringify(plan.routeNamePrefix)};

export const index = defineHandler({
  run: () => JsonRes({
    message,
  }),
});
`,
    }),
  ]);
}

function renderSocketFiles(plan: Omit<GraphGenerationPlan, "files">, transportCount: number): readonly GraphGeneratedFile[] {
  const handlerModule = `./presentation/socket/handlers/${plan.directoryName}.socket.handlers`;
  return Object.freeze([
    Object.freeze({
      path: `${plan.rootDirectory}/${graphFileName(plan, "socket", transportCount)}`,
      content: `import { defineWebSocketGraph } from "@warbler/framework";

import * as handlers from ${JSON.stringify(handlerModule)};

export default defineWebSocketGraph({
  prefix: ${JSON.stringify(plan.routePrefix)},

  middlewares: [],

  providers: [],

  events: {
    OPEN: {
      name: ${JSON.stringify(`${plan.routeNamePrefix}.open`)},
      handler: handlers.open,
    },
  },
});
`,
    }),
    Object.freeze({
      path: `${plan.rootDirectory}/presentation/socket/handlers/${plan.directoryName}.socket.handlers.ts`,
      content: `import { defineHandler } from "@warbler/framework";

export const open = defineHandler({
  run: () => undefined,
});
`,
    }),
  ]);
}
