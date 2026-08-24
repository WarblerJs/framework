# Warbler Either

`Either<E, T>` is Warbler's small typed result for expected business outcomes.

```text
Expected business failure      -> Either
Unexpected exceptional failure -> throw
```

Use `Either` in use cases and domain services when a failure is part of the
business flow: `EMAIL_EXIST`, `USERNAME_TAKEN`, `INSUFFICIENT_BALANCE`,
`ORDER_ALREADY_PAID`, or `INVALID_STATE_TRANSITION`.

Keep infrastructure failures as exceptions. Database outages, filesystem
errors, framework invariant violations, and unexpected runtime failures should
still throw and flow through Warbler's `WarblerError` normalization and
transport presenters.

## API

```ts
import { type Either, left, right } from "@warblerjs/core";

const failure = left("EMAIL_EXIST");
const success = right({ id: "user_1" });
```

`Left` means expected business failure. `Right` means success.

```ts
result.match({
  left: (error) => ({ status: "failed", error }),
  right: (user) => ({ status: "created", user }),
});
```

The available methods are:

- `isLeft()`
- `isRight()`
- `match()`
- `map()`
- `mapLeft()`
- `unwrap()`
- `unwrapOr()`

## Registration Example

```ts
@Service()
export class RegisterUseCase {
  readonly #register = inject(RegisterRepositoryPort);

  async execute(data: CreateUserData): Promise<Either<AppErrorCode, UserEntity>> {
    if (await this.#register.emailExist(data.email)) {
      return left(AppErrorCode.EMAIL_EXIST);
    }

    return right(await this.#register.createNewUser(data));
  }
}
```

Controllers or other consumers decide how to present each branch:

```ts
const result = await registerUseCase.execute(data);

return result.match({
  left: (error) => JsonRes({ error }, { status: 409 }),
  right: (user) => JsonRes(user, { status: 201 }),
});
```

## `unwrap()`

`unwrap()` returns the `Right` value, but throws for `Left`. That converts an
expected business failure into an exception, so use it sparingly. It is most
appropriate at a boundary that has already handled or asserted success.

Prefer `match()` or `unwrapOr()` for ordinary application flow.
