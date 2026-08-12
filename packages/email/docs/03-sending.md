# Sending

```ts
import { inject } from "@warbler/core";
import { Email } from "@warbler/email";

const email = inject(Email);

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

When `template` is omitted, `text` is required. When both `text` and `template`
are present, Warbler sends a multipart alternative message with plain text and
rendered HTML.
