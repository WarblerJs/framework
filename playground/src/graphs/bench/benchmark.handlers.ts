import {
    defineHandler,
    defineValidator,
    JsonRes,
    v,
    view,
    type AppRequest,
  } from "@warblerjs/framework";
import { benchVal, queryValidator } from "./bench.validator";
  
  export const largePayload = JSON.stringify({
    id: 1,
    name: "Warbler",
    description: "x".repeat(8 * 1024),
  });
  

  
  export const bodyValidator = defineValidator({
    csrf: false,
    bodyRules: {
      email: v.string("invalid_email"),
      age: v.number("invalid_age"),
    },
  });
  
  export const plain = defineHandler({
    run: () => new Response("OK"),
  });
  
  export const json = defineHandler({
    run: () => JsonRes({
      message: "Warbler",
      success: true,
    }),
  });
  
  export const params = defineHandler({
    validator: benchVal,
    run: (request: AppRequest<typeof benchVal>) => JsonRes({
      id: request.params.id,
    }),
  });
  
  export const query = defineHandler({
    validator: queryValidator,
  
    run: (
      request: AppRequest<typeof queryValidator>,
    ) => JsonRes({
      id: request.query.id,
    }),
  });
  
  export const body = defineHandler({
    validator: bodyValidator,
  
    run: (
      request: AppRequest<typeof bodyValidator>,
    ) => JsonRes({
      email: request.body.email,
      age: request.body.age,
    }),
  });
  
  export const asynchronous = defineHandler({
    run: async () => {
      await Promise.resolve();
  
      return JsonRes({
        message: "async",
      });
    },
  });
  
  export const large = defineHandler({
    run: () => new Response(
      largePayload,
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    ),
  });
  
  export const renderedView = defineHandler({
    run: () => view("benchmark.index", {
      title: "Warbler Benchmark",
    }),
  });
