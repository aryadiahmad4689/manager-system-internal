import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  storeCredential,
  getCredential,
  deleteCredential,
  createCredentialStore,
  EncryptionResult,
} from '@/lib/crypto/credential-store';
import { getDb, closeDb } from '@/lib/db/index';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

describe('credential-store', () => {
  describe('encrypt/decrypt', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY =
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    });

    afterEach(() => {
      delete process.env.ENCRYPTION_KEY;
    });

    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'my-secret-password';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should return base64-encoded ciphertext, iv, and authTag', () => {
      const encrypted = encrypt('test');

      // Verify base64 format (no errors when decoding)
      expect(() => Buffer.from(encrypted.ciphertext, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.iv, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.authTag, 'base64')).not.toThrow();

      // IV should be 12 bytes = 16 base64 chars
      expect(Buffer.from(encrypted.iv, 'base64').length).toBe(12);

      // Auth tag should be 16 bytes
      expect(Buffer.from(encrypted.authTag, 'base64').length).toBe(16);
    });

    it('should generate a unique IV per encryption', () => {
      const encrypted1 = encrypt('same-password');
      const encrypted2 = encrypt('same-password');

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('should handle empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = 'пароль-密码-パスワード';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('secret');

      // Tamper with ciphertext
      const tampered: EncryptionResult = {
        ...encrypted,
        ciphertext: Buffer.from('tampered-data').toString('base64'),
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encrypt('secret');

      // Tamper with auth tag
      const tampered: EncryptionResult = {
        ...encrypted,
        authTag: Buffer.from('0000000000000000').toString('base64'),
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw with invalid encryption key format', () => {
      process.env.ENCRYPTION_KEY = 'not-a-valid-hex-key';

      expect(() => encrypt('test')).toThrow(
        'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'
      );
    });
  });

  describe('storeCredential/getCredential/deleteCredential', () => {
    let db: Database.Database;
    let testDbPath: string;

    beforeEach(() => {
      testDbPath = path.resolve(
        process.cwd(),
        'data',
        'test',
        `cred-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );

      process.env.ENCRYPTION_KEY =
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
      process.env.DATABASE_PATH = testDbPath;

      // Close any existing singleton before creating a new one
      closeDb();

      // Use getDb so the singleton is initialized with the test path
      db = getDb(testDbPath);

      // Insert a test VM
      db.prepare(
        `INSERT INTO vms (id, label, host, port, username, encrypted_password, encryption_iv, encryption_auth_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('test-vm-1', 'Test VM', '192.168.1.1', 22, 'root', '', '', '');
    });

    afterEach(() => {
      closeDb();
      delete process.env.ENCRYPTION_KEY;
      delete process.env.DATABASE_PATH;

      if (fs.existsSync(testDbPath)) {
        try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
      }
    });

    it('should store and retrieve a credential', async () => {
      const password = 'super-secret-123';

      await storeCredential('test-vm-1', password);
      const retrieved = await getCredential('test-vm-1');

      expect(retrieved).toBe(password);
    });

    it('should throw when getting credential for non-existent VM', async () => {
      await expect(getCredential('non-existent')).rejects.toThrow(
        'VM not found: non-existent'
      );
    });

    it('should delete a credential by clearing fields', async () => {
      await storeCredential('test-vm-1', 'password');
      await deleteCredential('test-vm-1');

      // After deletion, the fields are empty strings, so decryption should fail
      await expect(getCredential('test-vm-1')).rejects.toThrow();
    });
  });

  describe('createCredentialStore', () => {
    it('should return an object implementing CredentialStore interface', () => {
      const store = createCredentialStore();

      expect(store.encrypt).toBeTypeOf('function');
      expect(store.decrypt).toBeTypeOf('function');
      expect(store.storeCredential).toBeTypeOf('function');
      expect(store.getCredential).toBeTypeOf('function');
      expect(store.deleteCredential).toBeTypeOf('function');
    });
  });
});
