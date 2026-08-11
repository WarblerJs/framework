# SMTP

The SMTP transport uses one connection per send in v1. N concurrent sends open N
independent connections; pooling can be added later behind the same transport
contract.

TLS policy is configuration-driven. If `tls: "starttls"` is configured and the
server does not advertise `STARTTLS`, Warbler throws `SmtpTlsError` and never
sends credentials or mail in plaintext.

Recipient handling is explicit:

```ts
const result = await email.send(message);
console.log(result.accepted, result.rejected);
```

If all recipients are rejected, `Email.send()` throws
`SmtpRecipientRejectedError`. If some recipients are accepted, it resolves with
both `accepted` and `rejected`.
