# @warblerjs/frontend

Small, dependency-free browser utilities for Warbler applications. The package stays close to native Web APIs and removes repetitive frontend boilerplate.

```bash
bun add @warblerjs/frontend
```

```ts
import { http, csrf, form, storage, debounce } from "@warblerjs/frontend";

const users = await http.get("/api/users");
await http.post("/api/users", { name: "John" });
const data = form.serialize("#login-form");
const token = csrf.token();
storage.set("theme", "dark");
```

## Native forms

```ts
import { FormBuilder } from "@warblerjs/frontend/forms";

const login = FormBuilder("login-form", (v) => ({
  email: ["", v.required(), v.email()],
  password: ["", v.required(), v.minLength(8)],
}));

login.value();                 // { email: string, password: string }
login.field("email").value(); // string
```

`FormBuilder` discovers controls by native `name`, applies equivalent HTML constraints, and
keeps values, validity, touched/dirty state, accessibility attributes, and `data-wbr-*` state in
sync. Errors render through `textContent` into `[data-wbr-error-for]` containers.

A form with an explicit `action` keeps valid native browser submission. Without `action`, a valid
submission uses Fetch with native `FormData`; GET/HEAD values are placed in the URL. `submitted`
records attempts while `submitting` represents only an active fetch. Field server errors clear
when that field changes.

`destroy()` is idempotent. It removes listeners and callbacks owned by the instance, aborts an
active submission, restores developer-provided constraints and accessibility attributes, and
prevents stale asynchronous work from updating the form. Reinitializing the same native form
automatically destroys its previous owner, which makes page-script re-execution and HMR safe.
