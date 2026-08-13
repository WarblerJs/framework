import { Graph } from "@warbler/core";
import { BenchService } from "./bench.service";
import Benchontroller from "./bench.controller";

@Graph({
  prefix: "/",
  controllers: [Benchontroller],
  providers: [BenchService],
})
export default class BenchGraph {}
