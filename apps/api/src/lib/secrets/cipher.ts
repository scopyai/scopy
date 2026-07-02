import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import type { EncryptionContext, KeyProvider, SecretEnvelope } from "./types"

const GCM_IV_BYTES = 12
const DEK_BYTES = 32

const aad = (context: EncryptionContext): Buffer =>
  Buffer.from(
    `scopy:secret:v1:${context.workspaceId}:${context.provider}`,
    "utf8"
  )

export class SecretCipher {
  constructor(
    private readonly encryptProvider: KeyProvider,
    private readonly resolveProvider: (kekId: string) => KeyProvider
  ) {}

  async encrypt(
    plaintext: string,
    context: EncryptionContext
  ): Promise<string> {
    const dek = randomBytes(DEK_BYTES)
    try {
      const iv = randomBytes(GCM_IV_BYTES)
      const cipher = createCipheriv("aes-256-gcm", dek, iv)
      cipher.setAAD(aad(context))
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ])
      const tag = cipher.getAuthTag()
      const wrappedDek = await this.encryptProvider.wrapDataKey(dek, context)

      const envelope: SecretEnvelope = {
        v: 1,
        alg: "AES-256-GCM",
        kek: this.encryptProvider.id,
        wrappedDek: wrappedDek.toString("base64"),
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ct: ciphertext.toString("base64"),
      }
      return JSON.stringify(envelope)
    } finally {
      dek.fill(0)
    }
  }

  async decrypt(
    serialized: string,
    context: EncryptionContext
  ): Promise<string> {
    const envelope = JSON.parse(serialized) as SecretEnvelope
    if (envelope.v !== 1 || envelope.alg !== "AES-256-GCM") {
      throw new Error("Unsupported secret envelope")
    }
    const provider = this.resolveProvider(envelope.kek)
    const dek = await provider.unwrapDataKey(
      Buffer.from(envelope.wrappedDek, "base64"),
      context
    )
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        dek,
        Buffer.from(envelope.iv, "base64")
      )
      decipher.setAAD(aad(context))
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ct, "base64")),
        decipher.final(),
      ])
      return plaintext.toString("utf8")
    } finally {
      dek.fill(0)
    }
  }
}

export const maskSecret = (secret: string): string => {
  const trimmed = secret.trim()
  if (trimmed.length <= 8) return "…"
  const head = trimmed.slice(0, Math.min(8, trimmed.length - 4))
  const tail = trimmed.slice(-4)
  return `${head}…${tail}`
}
