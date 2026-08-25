import { env, envBoolean } from "@warblerjs/config";

export const profilingConfig = {
  /*
   * HTTP hot-path profiling.
   *
   * Disabled by default in every environment, including production. When enabled,
   * Warbler selects an instrumented HTTP/runtime pipeline at startup and aggregates
   * in memory. It never prints per-request data and should only be enabled during a
   * controlled benchmark run because every timing call adds measurement overhead.
   */
  http: envBoolean("WARBLER_HTTP_PROFILING", false),

  /*
   * Aggregate shutdown summary.
   *
   * Enabled by default so a benchmark run can be stopped with SIGINT/SIGTERM and
   * emit one summary after the runtime has left the request hot path.
   */
  summaryOnStop: envBoolean("WARBLER_HTTP_PROFILING_SUMMARY", true),
} as const;
