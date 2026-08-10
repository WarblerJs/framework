/** Base class for all Warbler crypto failures. */
export class CryptoError extends Error {
  /** Creates a crypto error with a safe public message. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CryptoError";
  }
}

/** Identifies invalid or incomplete crypto configuration. */
export class CryptoConfigError extends CryptoError {
  /** Creates a crypto configuration error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CryptoConfigError";
  }
}

/** Identifies a missing, malformed, or unusable key reference. */
export class KeyError extends CryptoError {
  /** Creates a key error without exposing key material. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KeyError";
  }
}

/** Identifies a failure while encrypting plaintext. */
export class EncryptionError extends CryptoError {
  /** Creates an encryption error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EncryptionError";
  }
}

/** Identifies a failure while decrypting ciphertext. */
export class DecryptionError extends CryptoError {
  /** Creates a decryption error with a generic safe message. */
  public constructor(message = "Unable to decrypt payload.", options?: ErrorOptions) {
    super(message, options);
    this.name = "DecryptionError";
  }
}

/** Identifies a malformed encrypted envelope. */
export class EnvelopeError extends CryptoError {
  /** Creates an envelope validation error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvelopeError";
  }
}

/** Identifies invalid encoded data. */
export class EncodingError extends CryptoError {
  /** Creates an encoding error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EncodingError";
  }
}

/** Identifies a hashing failure. */
export class HashingError extends CryptoError {
  /** Creates a hashing error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HashingError";
  }
}

/** Identifies a password hashing or verification failure. */
export class PasswordError extends CryptoError {
  /** Creates a password error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PasswordError";
  }
}

/** Identifies an HMAC signing or verification failure. */
export class HmacError extends CryptoError {
  /** Creates an HMAC error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HmacError";
  }
}

/** Identifies invalid random byte or token generation parameters. */
export class RandomError extends CryptoError {
  /** Creates a random generation error. */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RandomError";
  }
}
