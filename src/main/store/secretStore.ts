export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(blob: Buffer): string
  getSelectedStorageBackend?(): string
}

const WEAK_BACKENDS = new Set(['basic_text', 'unknown'])

export class SecretStore {
  constructor(
    private readonly ss: SafeStorageLike,
    private readonly platform: string = process.platform
  ) {}

  status(): { available: boolean; reason: string | null } {
    if (!this.ss.isEncryptionAvailable()) {
      return { available: false, reason: 'The OS keychain is not available, so the password cannot be stored safely.' }
    }
    if (this.platform === 'linux') {
      const backend = this.ss.getSelectedStorageBackend?.() ?? 'unknown'
      if (WEAK_BACKENDS.has(backend)) {
        return {
          available: false,
          reason: 'No keyring (Secret Service or KWallet) was found. Install one to remember the password; other fields are still remembered.'
        }
      }
    }
    return { available: true, reason: null }
  }

  encrypt(plain: string): Buffer {
    if (!this.status().available) throw new Error('secure storage unavailable')
    return this.ss.encryptString(plain)
  }

  decrypt(blob: Buffer): string | null {
    try {
      return this.ss.decryptString(blob)
    } catch {
      return null
    }
  }
}
