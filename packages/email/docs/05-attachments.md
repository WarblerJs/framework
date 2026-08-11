# Attachments

Attachments may come from a path, `Uint8Array`, `ArrayBuffer`, `Blob`, or text.
Path attachments are size-checked before SMTP connects.

Inline attachments use `contentId`:

```ts
attachments: [{ path: "public/logo.png", contentId: "logo", disposition: "inline" }]
```
