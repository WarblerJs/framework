import { InvalidRequestError } from "../errors";
import type { JsonBodyPolicy } from "./body-policy";
import { readLimitedBlob } from "./body-utils";

/** Parses a size-capped JSON body and iteratively enforces depth and key limits. */
export async function parseJsonBody(request: Request, policy: JsonBodyPolicy): Promise<unknown> {
  const text = await (await readLimitedBlob(request, policy.maxSize)).text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new InvalidRequestError("Malformed JSON body", 400, { cause: error });
  }
  const stack: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 1 }];
  let keyCount = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (typeof current.value !== "object" || current.value === null) continue;
    if (current.depth > policy.maxDepth) throw new InvalidRequestError("JSON depth limit exceeded");
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    for (const key of Object.keys(current.value)) {
      keyCount++;
      if (keyCount > policy.maxKeys) throw new InvalidRequestError("JSON key limit exceeded");
      stack.push({
        value: Object.getOwnPropertyDescriptor(current.value, key)?.value,
        depth: current.depth + 1,
      });
    }
  }
  return value;
}
