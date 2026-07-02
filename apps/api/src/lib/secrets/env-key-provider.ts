import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"
import type { EncryptionContext, KeyProvider } from "./types"

const KEK_VERSION = 1
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16
const KEK_BYTES = 32

const deriveKek = (master: Buffer): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      master,
      Buffer.alloc(0),
      Buffer.from(`scopy:secrets:kek:v${KEK_VERSION}`, "utf8"),
      KEK_BYTES
    )
  )

const aad = (context: EncryptionContext): Buffer =>
  Buffer.from(
    `scopy:secret:v1:${context.workspaceId}:${context.provider}`,
    "utf8"
  )

export class EnvKeyProvider implements KeyProvider {
  readonly id = `env:${KEK_VERSION}`
  private readonly kek: Buffer

  constructor(masterKeyBase64: string) {
    const master = Buffer.from(masterKeyBase64, "base64")
    if (master.length !== KEK_BYTES) {
      throw new Error(
        `MASTER_ENCRYPTION_KEY must decode to ${KEK_BYTES} bytes (got ${master.length}). Generate one with: openssl rand -base64 32`
      )
    }
    this.kek = deriveKek(master)
    master.fill(0)
  }

  async wrapDataKey(dek: Buffer, context: EncryptionContext): Promise<Buffer> {
    const iv = randomBytes(GCM_IV_BYTES)
    const cipher = createCipheriv("aes-256-gcm", this.kek, iv)
    cipher.setAAD(aad(context))
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, ciphertext])
  }

  async unwrapDataKey(
    wrapped: Buffer,
    context: EncryptionContext
  ): Promise<Buffer> {
    if (wrapped.length <= GCM_IV_BYTES + GCM_TAG_BYTES) {
      throw new Error("Wrapped data key is malformed")
    }
    const iv = wrapped.subarray(0, GCM_IV_BYTES)
    const tag = wrapped.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES)
    const ciphertext = wrapped.subarray(GCM_IV_BYTES + GCM_TAG_BYTES)
    const decipher = createDecipheriv("aes-256-gcm", this.kek, iv)
    decipher.setAAD(aad(context))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  }
}
