# @warblerjs/crypto

`@warblerjs/crypto` is Warbler's production crypto toolkit for Bun applications. It provides password hashing, non-secret digests, authenticated encryption, HMAC signatures, secure random generation, strict encoding helpers, key import utilities, and constant-time equality checks.

It is not a general cryptography lab. It does not implement custom primitives, stream ciphers, RSA helpers, source-map tooling, watchers, or development conveniences. The implementation uses Bun and Web Crypto only: `Bun.password`, `Bun.CryptoHasher`, `Bun.file`, `crypto.subtle`, `crypto.getRandomValues`, and `crypto.randomUUID`.

## Configure

Configure crypto once during application bootstrap. Configuration is side-effect-free at import time and is lazily memoized until `configureCrypto` is called.

```ts
import { configureCrypto } from "@warblerjs/crypto";

await configureCrypto({
  encryption: {
    activeKey: "application-v1",
    keys: {
      "application-v1": { env: "APP_CRYPTO_KEY" },
    },
  },
  hmac: {
    activeKey: "signing-v1",
    keys: {
      "signing-v1": { env: "APP_HMAC_KEY" },
    },
  },
});
```

Generate key material:

```ts
import { keys } from "@warblerjs/crypto";

console.log(keys.generate({ for: "encryption" }));
console.log(keys.generate({ for: "hmac" }));
```

## Passwords

Use `password` for user passwords. Use `hash` for non-secret checksums.

```ts
import { password } from "@warblerjs/crypto";

const storedHash = await password.hash("correct horse battery staple");
const valid = await password.verify("correct horse battery staple", storedHash);
const shouldRehash = await password.needsRehash(storedHash);
```

Malformed stored password hashes return `false` from `verify`.

## Hashes

Use `hash` for non-secret digests such as cache keys, file integrity, and stable identifiers. Use `hmac` when authenticity matters.

```ts
import { hash } from "@warblerjs/crypto";

const id = hash.sha256("public payload");
const digest = await hash.digest("public payload", { algorithm: "sha512", output: "base64url" });
const fileDigest = await hash.file("storage/report.csv");
```

`hash.file` streams `Bun.file(path).stream()` and does not load the whole file into memory.

## Encryption

Use `crypt` for confidential data. Use `hmac` for authenticating data that must remain readable.

```ts
import { crypt } from "@warblerjs/crypto";

const envelope = await crypt.encryptJson({ userId: "usr_123" }, { context: "tenant:acme" });
const payload = await crypt.decryptJson<{ readonly userId: string }>(envelope, {
  context: "tenant:acme",
});
```

Encrypted payloads are versioned AES-GCM envelopes:

```json
{
  "v": 1,
  "alg": "AES-256-GCM",
  "kid": "application-v1",
  "iv": "...",
  "ctx": "...",
  "ct": "..."
}
```

Keep old keys configured during rotation so old envelopes continue to decrypt. Removing an old key makes old envelopes fail with `KeyError`.

## HMAC

Use `hmac` for webhook signatures, signed cookies, and payload authenticity without confidentiality. Verification uses `crypto.subtle.verify`.

```ts
import { hmac } from "@warblerjs/crypto";

const signature = await hmac.sign("payload");
const valid = await hmac.verify("payload", signature);
```

For one-off keys:

```ts
await hmac.sign("payload", {
  key: { material: new TextEncoder().encode("at least sixteen bytes") },
});
```

## Random

Use `random.token` for application tokens and `random.bytes` when a byte array is required.

```ts
import { random } from "@warblerjs/crypto";

const token = await random.token();
const raw = random.bytes(32);
const id = random.uuid();
```

Random byte requests are capped at 1 MiB.

## Encoding

Use `encoding` when data must cross text boundaries. Decoders are strict and reject malformed payloads.

```ts
import { encoding } from "@warblerjs/crypto";

const bytes = encoding.decodeBase64Url("d2FyYmxlcg");
const text = encoding.bytesToUtf8(bytes);
```

## Secure Compare

Use `secureCompare` for equal-length secret comparisons when Web Crypto verification is not available. Use `hmac.verify` for HMAC signatures.

```ts
import { secureCompare } from "@warblerjs/crypto";

secureCompare("expected", "provided");
```
