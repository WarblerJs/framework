import {
    defineHttpGraph,
  } from "@warblerjs/framework";
  
  import * as handlers from "./benchmark.handlers";
  
  export default defineHttpGraph({
    prefix: "/bench",
  
    middlewares: [],
    providers: [],
  
    routes: {
      "GET /plain": {
        name: "benchmark.plain",
        response: "text",
        handler: handlers.plain,
      },
  
      "GET /json": {
        name: "benchmark.json",
        handler: handlers.json,
      },
  
      "GET /params/:id": {
        name: "benchmark.params",
        handler: handlers.params,
      },
  
      "GET /query": {
        name: "benchmark.query",
        handler: handlers.query,
      },
  
      "POST /body": {
        name: "benchmark.body",
        handler: handlers.body,
      },
  
      "GET /async": {
        name: "benchmark.async",
        handler: handlers.asynchronous,
      },
  
      "GET /large": {
        name: "benchmark.large",
        handler: handlers.large,
      },
  
      "GET /view": {
        name: "benchmark.view",
        handler: handlers.renderedView,
      },
    },
  });