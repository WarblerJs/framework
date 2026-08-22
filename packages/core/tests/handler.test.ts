import { describe, expect, test } from "bun:test";
import { defineHandler } from "../src";

class GetUserUseCase {
  execute(): "typed-user" {
    return "typed-user";
  }
}

describe("defineHandler", () => {
  test("contextually types declared use-case dependencies", () => {
    const handler = defineHandler({
      useCase: { getUser: GetUserUseCase },
      run: (_ctx: { readonly requestId: string }, { getUser }) => {
        const user: "typed-user" = getUser.execute();

        // @ts-expect-error use-case dependencies must not collapse to any.
        getUser.missingMethod();

        return user;
      },
    });

    expect(Object.isFrozen(handler)).toBe(true);
  });
});
