import type { CryptoConfigInput } from "@warblerjs/crypto";

/*
|--------------------------------------------------------------------------
| Warbler Crypto
|--------------------------------------------------------------------------
|
| This file configures the production crypto boundary for the playground
| application. Source code imports this configuration during bootstrap and the
| crypto package performs the semantic validation: key sizes, active key ids,
| envelope versions, algorithms, and random generation limits.
|
| Keep secret values in the environment. The config below stores only names of
| environment variables so secrets do not enter source control or production
| bundles.
|
*/

const cryptoConfig: CryptoConfigInput = {
  /*
  |--------------------------------------------------------------------------
  | Password Hashing
  |--------------------------------------------------------------------------
  |
  | Argon2id is the default password hashing algorithm. Existing bcrypt hashes
  | can still be verified, and password.needsRehash() reports when a stored
  | hash should be upgraded to the configured algorithm.
  |
  */
  password: {
    algorithm: "argon2id",
  },

  /*
  |--------------------------------------------------------------------------
  | Application Encryption
  |--------------------------------------------------------------------------
  |
  | AES-256-GCM keys must decode to exactly 32 bytes. During rotation, add the
  | new key, make it active, and keep old keys listed until old envelopes no
  | longer need to decrypt.
  |
  */
  encryption: {
    activeKey: "application-v1",
    keys: {
      "application-v1": { env: "APP_CRYPTO_KEY" },
    },
  },

  /*
  |--------------------------------------------------------------------------
  | Message Authentication
  |--------------------------------------------------------------------------
  |
  | HMAC keys must decode to at least 16 bytes. Use HMAC for signed webhooks,
  | signed cookies, and integrity checks where payloads remain readable.
  |
  */
  hmac: {
    activeKey: "signing-v1",
    keys: {
      "signing-v1": { env: "APP_HMAC_KEY" },
    },
  },

  /*
  |--------------------------------------------------------------------------
  | Hashing, Encoding, And Random Tokens
  |--------------------------------------------------------------------------
  |
  | Hashing is for public, non-secret digests. Default encoding controls token,
  | signature, and helper output when a call does not pass an explicit format.
  | Random byte generation is capped by the crypto package at 1 MiB.
  |
  */
  hashing: {
    algorithm: "sha256",
    output: "hex",
  },
  encoding: {
    output: "base64url",
  },
  random: {
    maxBytes: 1024 * 1024,
    tokenBytes: 32,
  },
};

export default cryptoConfig;
