# @warbler/email

Compile-first email for Warbler applications. The package validates messages,
renders compiled Warbler views for templates, builds MIME, and sends through a
transport without adding external dependencies.

```ts
import { Email } from "@warbler/email";

const email = new Email();

await email.send({
  to: "user@example.test",
  subject: "Welcome",
  template: "mail.welcome",
  data: { name: "Ada" },
});
```

Attachments and inline CID assets are first-class:

```ts
await email.send({
  to: "billing@example.test",
  subject: "Invoice",
  html: "<img src=\"cid:logo\"><p>Your invoice is attached.</p>",
  attachments: [
    { path: "public/images/logo.png", contentId: "logo", disposition: "inline" },
    { path: "storage/invoices/invoice.pdf", filename: "invoice.pdf" },
  ],
});
```

See `docs/` for configuration, SMTP, attachments, testing, security, and
performance notes.
