export type EncryptionContext = {
  workspaceId: string
  provider: string
}

export interface KeyProvider {
  readonly id: string

  wrapDataKey(dek: Buffer, context: EncryptionContext): Promise<Buffer>

  unwrapDataKey(wrapped: Buffer, context: EncryptionContext): Promise<Buffer>
}

export type SecretEnvelope = {
  v: 1

  alg: "AES-256-GCM"

  kek: string

  wrappedDek: string

  iv: string

  tag: string

  ct: string
}
