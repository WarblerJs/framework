# Examples

Email can be triggered from application events without `@warbler/email`
depending on `@warbler/events`.

```ts
export const sendWelcomeEmail = listen(UserCreated, async event => {
  const email = inject(Email);
  await email.send({
    to: event.email,
    subject: "Welcome",
    template: "mail.welcome",
    data: { email: event.email },
  });
});
```

Controllers use the generated injectable email provider:

```ts
import { inject } from "@warbler/core";
import { Email } from "@warbler/email";

export class UserController {
  readonly #email = inject(Email);

  async create(): Promise<Response> {
    await this.#email.send({
      to: "user@example.test",
      subject: "Welcome",
      text: "Welcome to Warbler.",
      template: "mail.welcome",
      data: { email: "user@example.test" },
    });

    return new Response("ok");
  }
}
```
