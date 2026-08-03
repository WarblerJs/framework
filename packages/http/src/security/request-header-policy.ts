import { InvalidRequestError } from "../errors";

/** Runtime request-header limits used as defense in depth after native admission limits. */
export interface RequestHeaderPolicy {
  readonly maxCount: number;
  readonly maxSize: number;
  readonly maxNameSize: number;
  readonly maxValueSize: number;
}

/** Enforces request header limits as a secondary guard. */
export function validateRequestHeaders(request: Request, policy: RequestHeaderPolicy): void {
  const encoder = new TextEncoder();
  let count = 0;
  let total = 0;
  for (const [name, value] of request.headers) {
    count++;
    const nameSize = encoder.encode(name).byteLength;
    const valueSize = encoder.encode(value).byteLength;
    total += nameSize + valueSize;
    if (count > policy.maxCount || total > policy.maxSize || nameSize > policy.maxNameSize || valueSize > policy.maxValueSize) {
      throw new InvalidRequestError("Request header limit exceeded", 431);
    }
  }
}
