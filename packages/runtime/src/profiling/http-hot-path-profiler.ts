/** Measured HTTP hot-path stages. */
export type HttpProfileStage =
  | "requestPreparation"
  | "contextPreparation"
  | "generatedDispatch"
  | "routeDispatch"
  | "validator"
  | "guardMiddleware"
  | "requestContext"
  | "diController"
  | "handlerExecution"
  | "responseNormalization"
  | "securityHeaders";

/** One immutable aggregate row in an HTTP profile snapshot. */
export interface HttpProfileStageSnapshot {
  readonly stage: HttpProfileStage | "total" | "other";
  readonly count: number;
  readonly totalMs: number;
  readonly averageUs: number;
  readonly minUs: number;
  readonly maxUs: number;
  readonly percentOfTotal: number;
}

/** Immutable aggregate HTTP profile snapshot. */
export interface HttpProfileSnapshot {
  readonly requests: number;
  readonly stages: readonly HttpProfileStageSnapshot[];
}

/** Lightweight in-memory HTTP hot-path profiler. */
export interface HttpHotPathProfiler {
  readonly enabled: true;
  record(stage: HttpProfileStage, durationMs: number): void;
  recordRequest(durationMs: number): void;
  snapshot(): HttpProfileSnapshot;
  summary(): string;
}

interface MutableProfileStage {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

const STAGES = Object.freeze([
  "requestPreparation",
  "contextPreparation",
  "generatedDispatch",
  "routeDispatch",
  "validator",
  "guardMiddleware",
  "requestContext",
  "diController",
  "handlerExecution",
  "responseNormalization",
  "securityHeaders",
] as const);

const EXCLUSIVE_STAGES = Object.freeze([
  "requestPreparation",
  "contextPreparation",
  "routeDispatch",
  "validator",
  "guardMiddleware",
  "requestContext",
  "diController",
  "handlerExecution",
  "responseNormalization",
  "securityHeaders",
] as const);

/** Creates one process-local HTTP profiler for a controlled benchmark run. */
export function createHttpHotPathProfiler(): HttpHotPathProfiler {
  const stages = new Map<HttpProfileStage, MutableProfileStage>();
  for (const stage of STAGES) stages.set(stage, createMutableStage());
  const total = createMutableStage();

  const record = (stage: HttpProfileStage, durationMs: number): void => {
    const bucket = stages.get(stage);
    if (bucket === undefined || !Number.isFinite(durationMs) || durationMs < 0) return;
    add(bucket, durationMs);
  };

  const recordRequest = (durationMs: number): void => {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    add(total, durationMs);
  };

  const snapshot = (): HttpProfileSnapshot => {
    const totalMs = total.totalMs;
    const rows = STAGES.map((stage) => snapshotStage(stage, stages.get(stage)!, totalMs));
    const exclusiveMs = EXCLUSIVE_STAGES.reduce((sum, stage) => sum + stages.get(stage)!.totalMs, 0);
    return Object.freeze({
      requests: total.count,
      stages: Object.freeze([
        snapshotStage("total", total, totalMs),
        ...rows,
        snapshotStage("other", otherStage(total.count, Math.max(0, totalMs - exclusiveMs)), totalMs),
      ]),
    });
  };

  const summary = (): string => formatSnapshot(snapshot());

  return Object.freeze({ enabled: true, record, recordRequest, snapshot, summary });
}

function createMutableStage(): MutableProfileStage {
  return { count: 0, totalMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
}

function add(stage: MutableProfileStage, durationMs: number): void {
  stage.count += 1;
  stage.totalMs += durationMs;
  if (durationMs < stage.minMs) stage.minMs = durationMs;
  if (durationMs > stage.maxMs) stage.maxMs = durationMs;
}

function otherStage(count: number, totalMs: number): MutableProfileStage {
  return { count, totalMs, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
}

function snapshotStage(stage: HttpProfileStage | "total" | "other", value: MutableProfileStage, totalMs: number): HttpProfileStageSnapshot {
  const averageMs = value.count === 0 ? 0 : value.totalMs / value.count;
  return Object.freeze({
    stage,
    count: value.count,
    totalMs: value.totalMs,
    averageUs: averageMs * 1000,
    minUs: value.count === 0 || value.minMs === Number.POSITIVE_INFINITY ? 0 : value.minMs * 1000,
    maxUs: value.count === 0 ? 0 : value.maxMs * 1000,
    percentOfTotal: totalMs <= 0 ? 0 : (value.totalMs / totalMs) * 100,
  });
}

function formatSnapshot(snapshot: HttpProfileSnapshot): string {
  const lines = [
    "",
    "Warbler HTTP hot-path profile",
    `requests=${snapshot.requests}`,
    "stage                 count       avg_us      min_us      max_us   pct_total",
  ];
  for (const stage of snapshot.stages) {
    lines.push([
      stage.stage.padEnd(20),
      String(stage.count).padStart(8),
      stage.averageUs.toFixed(2).padStart(12),
      stage.minUs.toFixed(2).padStart(11),
      stage.maxUs.toFixed(2).padStart(11),
      `${stage.percentOfTotal.toFixed(2)}%`.padStart(10),
    ].join(" "));
  }
  lines.push("note: generatedDispatch is inclusive of generated validation-input preparation plus runtime executor work.");
  return `${lines.join("\n")}\n`;
}
