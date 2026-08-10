import type { EncodingName } from "../encoding";

/** Password hashing algorithms supported by Warbler. */
export type PasswordAlgorithm = "argon2id" | "bcrypt";

/** Hash digest algorithms supported by Warbler. */
export type HashAlgorithm = "sha256" | "sha512";

/** Encryption algorithm supported by Warbler envelopes. */
export type EncryptionAlgorithm = "AES-256-GCM";

/** HMAC algorithms supported by Warbler. */
export type HmacAlgorithm = "SHA-256" | "SHA-512";

/** Secret material or an environment reference for key configuration. */
export type KeyMaterialReference =
  | string
  | {
      readonly env: string;
    }
  | {
      readonly material: string;
    };

/** Password hashing configuration. */
export interface PasswordCryptoConfigInput {
  readonly algorithm?: PasswordAlgorithm;
}

/** Non-cryptographic hash configuration. */
export interface HashCryptoConfigInput {
  readonly algorithm?: HashAlgorithm;
  readonly output?: EncodingName;
}

/** Authenticated encryption key configuration. */
export interface EncryptionCryptoConfigInput {
  readonly algorithm?: EncryptionAlgorithm;
  readonly activeKey?: string;
  readonly keys?: Readonly<Record<string, KeyMaterialReference>>;
  readonly envelopeVersion?: 1;
  readonly cacheSize?: number;
}

/** HMAC key configuration. */
export interface HmacCryptoConfigInput {
  readonly algorithm?: HmacAlgorithm;
  readonly activeKey?: string;
  readonly keys?: Readonly<Record<string, KeyMaterialReference>>;
  readonly cacheSize?: number;
}

/** Random generation configuration. */
export interface RandomCryptoConfigInput {
  readonly maxBytes?: number;
  readonly tokenBytes?: number;
}

/** Default textual encoding configuration. */
export interface EncodingCryptoConfigInput {
  readonly output?: EncodingName;
}

/** Public configuration accepted by configureCrypto. */
export interface CryptoConfigInput {
  readonly password?: PasswordCryptoConfigInput;
  readonly hashing?: HashCryptoConfigInput;
  readonly encryption?: EncryptionCryptoConfigInput;
  readonly hmac?: HmacCryptoConfigInput;
  readonly random?: RandomCryptoConfigInput;
  readonly encoding?: EncodingCryptoConfigInput;
}

/** Imported key pair maps compiled from crypto configuration. */
export interface CompiledCryptoKeys {
  readonly activeKey?: string;
  readonly encryption: ReadonlyMap<string, CryptoKey>;
  readonly hmac: ReadonlyMap<string, CryptoKey>;
}

/** Validated immutable crypto configuration used by runtime APIs. */
export interface CompiledCryptoConfig {
  readonly password: {
    readonly algorithm: PasswordAlgorithm;
  };
  readonly hashing: {
    readonly algorithm: HashAlgorithm;
    readonly output: EncodingName;
  };
  readonly encryption: {
    readonly algorithm: EncryptionAlgorithm;
    readonly activeKey?: string;
    readonly envelopeVersion: 1;
    readonly cacheSize: number;
  };
  readonly hmac: {
    readonly algorithm: HmacAlgorithm;
    readonly activeKey?: string;
    readonly cacheSize: number;
  };
  readonly random: {
    readonly maxBytes: number;
    readonly tokenBytes: number;
  };
  readonly encoding: {
    readonly output: EncodingName;
  };
  readonly keys: CompiledCryptoKeys;
}
