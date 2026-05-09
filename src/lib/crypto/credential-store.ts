import crypto from 'crypto';
import { getDb } from '../db/index';

/**
 * Result of an AES-256-GCM encryption operation.
 * All fields are base64-encoded strings.
 */
export interface EncryptionResult {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/**
 * Interface for credential encryption and storage operations.
 */
export interface CredentialStore {
  encrypt(plaintext: string): EncryptionResult;
  decrypt(encrypted: EncryptionResult): string;
  storeCredential(vmId: string, password: string): Promise<void>;
  getCredential(vmId: string): Promise<string>;
  deleteCredential(vmId: string): Promise<void>;
}

const DEFAULT_DEV_KEY =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

/**
 * Returns the 32-byte encryption key from the ENCRYPTION_KEY environment variable.
 * Falls back to a default dev key if not set.
 * Throws if the key is not exactly 64 hex characters (32 bytes).
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY || DEFAULT_DEV_KEY;

  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Generates a random 12-byte IV per operation.
 * Returns ciphertext, IV, and auth tag as base64 strings.
 */
export function encrypt(plaintext: string): EncryptionResult {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted result back to plaintext.
 * Throws if the auth tag verification fails (tampered data or wrong key).
 */
export function decrypt(encrypted: EncryptionResult): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Stores an encrypted credential for a VM in the database.
 * Updates the encrypted_password, encryption_iv, and encryption_auth_tag columns.
 */
export async function storeCredential(
  vmId: string,
  password: string
): Promise<void> {
  const encrypted = encrypt(password);
  const db = getDb();

  db.prepare(
    `UPDATE vms
     SET encrypted_password = ?, encryption_iv = ?, encryption_auth_tag = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(encrypted.ciphertext, encrypted.iv, encrypted.authTag, vmId);
}

/**
 * Retrieves and decrypts the credential for a VM from the database.
 * Throws if the VM is not found or decryption fails.
 */
export async function getCredential(vmId: string): Promise<string> {
  const db = getDb();

  const row = db
    .prepare(
      'SELECT encrypted_password, encryption_iv, encryption_auth_tag FROM vms WHERE id = ?'
    )
    .get(vmId) as
    | {
        encrypted_password: string;
        encryption_iv: string;
        encryption_auth_tag: string;
      }
    | undefined;

  if (!row) {
    throw new Error(`VM not found: ${vmId}`);
  }

  return decrypt({
    ciphertext: row.encrypted_password,
    iv: row.encryption_iv,
    authTag: row.encryption_auth_tag,
  });
}

/**
 * Deletes the stored credential for a VM by clearing the encryption fields.
 * Note: This sets the fields to empty strings since the columns are NOT NULL.
 */
export async function deleteCredential(vmId: string): Promise<void> {
  const db = getDb();

  db.prepare(
    `UPDATE vms
     SET encrypted_password = '', encryption_iv = '', encryption_auth_tag = '', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(vmId);
}

/**
 * Creates a CredentialStore instance with all operations.
 */
export function createCredentialStore(): CredentialStore {
  return {
    encrypt,
    decrypt,
    storeCredential,
    getCredential,
    deleteCredential,
  };
}
