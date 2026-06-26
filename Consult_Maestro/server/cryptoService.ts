import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY ausente ou inválida (esperado 64 chars hex). " +
        'Gere com: node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))"',
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts an arbitrary JSON-serialisable object using AES-256-GCM.
 * Returns "<iv>:<tag>:<ciphertext>" all hex-encoded.
 */
export function encryptConfig(data: Record<string, any>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const plain = JSON.stringify(data ?? {});
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptConfig<T = Record<string, any>>(payload: string | null | undefined): T {
  if (!payload) return {} as T;
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Payload de criptografia inválido");
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
