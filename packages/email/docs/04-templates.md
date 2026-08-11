# Templates

Templates use Warbler dot notation and the active compiled view artifact:
`mail.welcome` maps to the compiled view named `mail.welcome`.

```ts
await email.send({
  to: "user@example.test",
  subject: "Welcome",
  template: "mail.welcome",
  data: { email: "user@example.test" },
});
```
