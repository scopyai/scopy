import { env } from "../../env"
import { SecretCipher, maskSecret } from "./cipher"
import { EnvKeyProvider } from "./env-key-provider"
import type { EncryptionContext, KeyProvider } from "./types"

export { maskSecret }

let cachedEnvProvider: EnvKeyProvider | null = null

const getEnvProvider = (): EnvKeyProvider => {
  if (!env.MASTER_ENCRYPTION_KEY) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY is not configured. It is required to store or use bring-your-own-key provider credentials. Generate one with: openssl rand -base64 32"
    )
  }
  if (!cachedEnvProvider) {
    cachedEnvProvider = new EnvKeyProvider(env.MASTER_ENCRYPTION_KEY)
  }
  return cachedEnvProvider
}

const getActiveProvider = (): KeyProvider => {
  switch (env.SECRETS_PROVIDER) {
    case "env":
      return getEnvProvider()
    default:
      throw new Error(`Unsupported SECRETS_PROVIDER: ${env.SECRETS_PROVIDER}`)
  }
}

const resolveProvider = (kekId: string): KeyProvider => {
  if (kekId.startsWith("env:")) return getEnvProvider()
  throw new Error(`No key provider registered for envelope kek "${kekId}"`)
}

let cachedCipher: SecretCipher | null = null

const getCipher = (): SecretCipher => {
  if (!cachedCipher) {
    cachedCipher = new SecretCipher(getActiveProvider(), resolveProvider)
  }
  return cachedCipher
}

export const encryptSecret = (
  plaintext: string,
  context: EncryptionContext
): Promise<string> => getCipher().encrypt(plaintext, context)

export const decryptSecret = (
  serialized: string,
  context: EncryptionContext
): Promise<string> => getCipher().decrypt(serialized, context)
