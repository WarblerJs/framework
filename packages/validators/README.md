# @warbler/validators

Transport-independent strict validation powered by Zod.

`rules` is the primary payload for every transport. `messageRules` is reserved
for a distinct message-envelope section; it is never an alias for `rules`.
Transports parse bytes and requests before passing plain values to a compiled
validator.

```ts
import { compileValidator, v } from "@warbler/validators";

const validator = compileValidator({
  rules: { name: v.string("validators.invalid_name") },
});
const result = validator.execute({ value: { name: "Warbler" } });
```

## `onValidationError`

By default, a request that fails validation short-circuits to Warbler's
standard validation-error response (HTTP 400, one translated message per
failing field) and the controller never runs. Supplying an optional
`onValidationError(req, errors)` on `defineValidator(...)` overrides that
default: when present, it runs instead, and its returned `Response` is sent
verbatim.

```
onValidationError defined     → its Response is used
onValidationError not defined → Warbler's default validation-error response is used
```

- `req` is the raw, un-validated request — `native`, `headers`, `cookies`,
  `context`, `locale`, and `tr(...)` behave exactly as on a successful
  `AppRequest`, but `body`/`params`/`query` are intentionally untyped
  (`unknown`): the input failed validation, so it is never presented as if it
  were the validated output.
- `errors` is the same structured `ValidationErrors` map (`{ [source.field]:
  ValidationIssue[] }`) produced by `compileValidator(...).execute(...)` —
  nothing is translated or reshaped for you.
- The handler may be synchronous or asynchronous (`Response | Promise<Response>`).
- The controller never runs once validation has failed, whether or not a
  handler is supplied.
- A throwing/rejecting handler is not caught here — it propagates through
  Warbler's normal runtime/HTTP error handling, the same as a controller
  throwing.

```ts
import { defineValidator, v } from "@warbler/validators";
import { view } from "@warbler/view";

export const validateUserId = defineValidator({
  paramRules: {
    id: v.uuid("id_invalid_uuid"),
  },
  headerRules: {
    "x-retries": v.coerce
      .number("validators.invalid_retries")
      .int("validators.invalid_retries")
      .nonnegative("validators.invalid_retries"),
  },
  onValidationError(req, errors) {
    return view("auth.login", {
      errors,
      old: req.body,
    });
  },
});
```

Other common shapes:

```ts
// JSON
onValidationError(req, errors) {
  return Response.json({ code: "VALIDATION_ERROR", errors }, { status: 422 });
}

// async
async onValidationError(req, errors) {
  return await createValidationResponse(req, errors);
}

// redirect
onValidationError(req, errors) {
  return Response.redirect("/login");
}
```
