import { beforeEach, describe, expect, test } from "bun:test";
import {
  CryptoConfigError,
  DecryptionError,
  KeyError,
  configureCrypto,
  crypt,
  encoding,
  hash,
  hmac,
  keys,
  password,
  random,
  resetCryptoForTests,
  secureCompare,
} from "../src";

const encryptionKeyV1 = keys.generate({ for: "encryption" });
const encryptionKeyV2 = keys.generate({ for: "encryption" });
const hmacKey = keys.generate({ for: "hmac" });

async function configureDefaultCrypto(): Promise<void> {
  await configureCrypto({
    encoding: { output: "base64url" },
    encryption: {
      activeKey: "application-v1",
      keys: {
        "application-v1": { material: encryptionKeyV1 },
      },
    },
    hashing: { algorithm: "sha256", output: "hex" },
    hmac: {
      activeKey: "signing-v1",
      keys: {
        "signing-v1": { material: hmacKey },
      },
    },
    random: { maxBytes: 1024, tokenBytes: 24 },
  });
}

beforeEach(async () => {
  resetCryptoForTests();
  await configureDefaultCrypto();
});

describe("@warbler/crypto encoding", () => {
  test("round-trips strict text encodings", () => {
    const bytes = encoding.utf8ToBytes("warbler");

    expect(encoding.bytesToUtf8(encoding.decodeHex(encoding.encodeHex(bytes)))).toBe("warbler");
    expect(encoding.bytesToUtf8(encoding.decodeBase64(encoding.encodeBase64(bytes)))).toBe("warbler");
    expect(encoding.bytesToUtf8(encoding.decodeBase64Url(encoding.encodeBase64Url(bytes)))).toBe("warbler");
  });

  test("rejects malformed encoded payloads", () => {
    expect(() => encoding.decodeHex("abc")).toThrow();
    expect(() => encoding.decodeBase64("not base64url")).toThrow();
    expect(() => encoding.decodeBase64Url("abc*")).toThrow();
  });
});

describe("@warbler/crypto random", () => {
  test("generates bounded random bytes and tokens", async () => {
    expect(random.bytes(16)).toHaveLength(16);
    expect(random.hex(8)).toHaveLength(16);
    expect(await random.token()).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(random.uuid()).toMatch(/^[0-9a-f-]{36}$/u);
  });

  test("rejects invalid random byte lengths", () => {
    expect(() => random.bytes(0)).toThrow();
    expect(() => random.bytes(1024 * 1024 + 1)).toThrow();
  });
});

describe("@warbler/crypto secureCompare", () => {
  test("compares equal-length inputs without accepting length mismatches", () => {
    expect(secureCompare("same", "same")).toBe(true);
    expect(secureCompare("same", "diff")).toBe(false);
    expect(secureCompare("same", "same!")).toBe(false);
  });
});

describe("@warbler/crypto hash", () => {
  test("hashes bytes, text, and files with Bun.CryptoHasher", async () => {
    const known = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    expect(hash.sha256("hello")).toBe(known);
    expect(hash.sha512("hello")).toHaveLength(128);
    expect(await hash.digest("hello")).toBe(known);

    const path = `/tmp/warbler-crypto-${crypto.randomUUID()}.txt`;
    await Bun.write(path, "hello");
    expect(await hash.file(path)).toBe(known);
    await Bun.file(path).delete();
  });
});

describe("@warbler/crypto password", () => {
  test("hashes, verifies, and reports rehash requirements safely", async () => {
    const storedHash = await password.hash("correct horse battery staple");

    expect(await password.verify("correct horse battery staple", storedHash)).toBe(true);
    expect(await password.verify("wrong password", storedHash)).toBe(false);
    expect(await password.verify("secret", "not-a-password-hash")).toBe(false);
    expect(await password.needsRehash(storedHash)).toBe(false);
    expect(await password.needsRehash("$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(await password.needsRehash("unknown-format")).toBe(false);
  });
});

describe("@warbler/crypto hmac", () => {
  test("signs and verifies configured keys with subtle.verify", async () => {
    const signature = await hmac.sign("payload");

    expect(await hmac.verify("payload", signature)).toBe(true);
    expect(await hmac.verify("changed", signature)).toBe(false);
    await expect(hmac.verify("payload", signature, { key: "missing" })).rejects.toThrow(KeyError);
  });

  test("supports explicit one-off key material", async () => {
    const signature = await hmac.sign("payload", {
      key: { material: encoding.decodeBase64Url(hmacKey) },
      output: "hex",
    });

    expect(
      await hmac.verify("payload", signature, {
        encoding: "hex",
        key: { material: encoding.decodeBase64Url(hmacKey) },
      }),
    ).toBe(true);
  });
});

describe("@warbler/crypto keys", () => {
  test("imports generated material and exports only extractable keys", async () => {
    const material = keys.generate({ for: "encryption" });
    const extractableKey = await keys.import(material, { extractable: true, for: "encryption" });
    const lockedKey = await keys.import(material, { for: "encryption" });

    expect(await keys.export(extractableKey)).toBe(material);
    await expect(keys.export(lockedKey)).rejects.toThrow(KeyError);
  });
});

describe("@warbler/crypto encryption", () => {
  test("encrypts and decrypts text, bytes, and JSON envelopes", async () => {
    const textEnvelope = await crypt.encryptText("secret", { context: "tenant:1" });
    expect(textEnvelope).toMatchObject({ alg: "AES-256-GCM", kid: "application-v1", v: 1 });
    expect(await crypt.decryptText(textEnvelope, { context: "tenant:1" })).toBe("secret");

    const bytesEnvelope = await crypt.encryptBytes(new Uint8Array([1, 2, 3]));
    expect(Array.from(await crypt.decryptBytes(bytesEnvelope))).toEqual([1, 2, 3]);

    const jsonEnvelope = await crypt.encryptJson({ role: "admin" });
    expect(await crypt.decryptJson<{ readonly role: string }>(jsonEnvelope)).toEqual({ role: "admin" });
  });

  test("returns generic decryption errors for malformed or tampered envelopes", async () => {
    const envelope = await crypt.encryptText("secret", { context: "tenant:1" });

    await expect(crypt.decryptText({ ...envelope, v: 2 })).rejects.toThrow(DecryptionError);
    await expect(crypt.decryptText({ ...envelope, ct: `${envelope.ct}AA` })).rejects.toThrow(
      "Unable to decrypt payload.",
    );
    await expect(crypt.decryptText(envelope, { context: "tenant:2" })).rejects.toThrow("Unable to decrypt payload.");
  });

  test("decrypts rotated keys while configured and fails after removal", async () => {
    const oldEnvelope = await crypt.encryptText("old payload");

    await configureCrypto({
      encryption: {
        activeKey: "application-v2",
        keys: {
          "application-v1": { material: encryptionKeyV1 },
          "application-v2": { material: encryptionKeyV2 },
        },
      },
      hmac: {
        activeKey: "signing-v1",
        keys: {
          "signing-v1": { material: hmacKey },
        },
      },
    });

    expect(await crypt.decryptText(oldEnvelope)).toBe("old payload");
    expect((await crypt.encryptText("new payload")).kid).toBe("application-v2");

    await configureCrypto({
      encryption: {
        activeKey: "application-v2",
        keys: {
          "application-v2": { material: encryptionKeyV2 },
        },
      },
      hmac: {
        activeKey: "signing-v1",
        keys: {
          "signing-v1": { material: hmacKey },
        },
      },
    });

    await expect(crypt.decryptText(oldEnvelope)).rejects.toThrow(KeyError);
  });
});

describe("@warbler/crypto configuration", () => {
  test("resolves key material through @warbler/config env parsing", async () => {
    Bun.env.WARBLER_TEST_CRYPTO_KEY = encryptionKeyV1;

    const config = await configureCrypto({
      encryption: {
        activeKey: "application-v1",
        keys: {
          "application-v1": { env: "WARBLER_TEST_CRYPTO_KEY" },
        },
      },
    });

    expect(config.keys.encryption.has("application-v1")).toBe(true);
  });

  test("validates semantic crypto configuration", async () => {
    await expect(
      configureCrypto({
        encryption: {
          activeKey: "missing",
          keys: {
            present: { material: encryptionKeyV1 },
          },
        },
      }),
    ).rejects.toThrow(CryptoConfigError);

    await expect(
      configureCrypto({
        encryption: {
          activeKey: "bad",
          keys: {
            bad: { material: keys.generate({ for: "hmac", bytes: 16 }) },
          },
        },
      }),
    ).rejects.toThrow(CryptoConfigError);
  });
});
