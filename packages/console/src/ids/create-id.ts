let sequence = 0;
export function createCorrelationId(prefix: "req" | "conn" | "build" | "compile"): string {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  const time = Date.now().toString(36);
  const count = sequence.toString(36).padStart(4, "0");
  return `${prefix}_${time}${count}`;
}
