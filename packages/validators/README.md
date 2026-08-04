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
