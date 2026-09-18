import { describe, expect, test } from "bun:test";
import type { HandlerFunction, HandlerObject, ResolvedUseCases } from "../src";

class GetUserUseCase {
  execute(): "typed-user" {
    return "typed-user";
  }
}

describe("handler types", () => {
  test("contextually type declared use-case dependencies", () => {
    const handler = {
      useCase: { getUser: GetUserUseCase },
      run: (_ctx: { readonly requestId: string }, { getUser }: ResolvedUseCases<{ readonly getUser: typeof GetUserUseCase }>) => {
        const user: "typed-user" = getUser.execute();

        // @ts-expect-error use-case dependencies must not collapse to any.
        getUser.missingMethod();

        return new Response(user);
      },
    } satisfies HandlerObject<{ readonly requestId: string }, { readonly getUser: typeof GetUserUseCase }>;

    const simple = (() => new Response("ok")) satisfies HandlerFunction;

    expect(handler.useCase.getUser).toBe(GetUserUseCase);
    expect(simple()).toBeInstanceOf(Response);
  });
});
