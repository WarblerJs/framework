import type { TextBodyPolicy } from "./body-policy";
import { readLimitedBlob } from "./body-utils";

/** Parses a size-capped plain text request body. */
export async function parseTextBody(request: Request, policy: TextBodyPolicy): Promise<string> {
  return (await readLimitedBlob(request, policy.maxSize)).text();
}
