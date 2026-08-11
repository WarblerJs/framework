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
