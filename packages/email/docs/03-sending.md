# Sending

```ts
await email.send({
  from: "Warbler <hello@example.test>",
  to: ["Ada <ada@example.test>"],
  cc: "team@example.test",
  bcc: "audit@example.test",
  replyTo: "support@example.test",
  subject: "Welcome",
  text: "Welcome",
  html: "<p>Welcome</p>",
});
```

`Bcc` participates in the SMTP envelope but is intentionally excluded from
visible MIME headers.
