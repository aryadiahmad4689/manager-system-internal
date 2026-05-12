import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { seed } from '@/lib/db/seed';

const TEST_DB_DIR = path.resolve(process.cwd(), 'data', 'test');

function getTestDbPath(): string {
  return path.join(TEST_DB_DIR, `seed-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function decryptPassword(ciphertext: string, iv: string, authTag: string): string {
  const keyHex =
    process.env.ENCRYPTION_KEY ||
    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

describe('Database seed', () => {
  const dbPaths: string[] = [];

  afterEach(() => {
    for (const dbPath of dbPaths) {
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        // Also clean WAL/SHM files
        if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
        if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
      } catch { /* ignore */ }
    }
    dbPaths.length = 0;
  });

  it('should create admin user with hashed password', async () => {
    const dbPath = getTestDbPath();
    dbPaths.push(dbPath);

    await seed(dbPath);

    const db = new Database(dbPath);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('admin') as {
      id: string;
      username: string;
      password_hash: string;
    };
    db.close();

    expect(user).toBeDefined();
    expect(user.username).toBe('admin');
    expect(user.password_hash).toBeDefined();
    // Verify the hash matches the default password
    const isValid = await bcrypt.compare('admin123', user.password_hash);
    expect(isValid).toBe(true);
  });

  it('should create test VM with encrypted password', async () => {
    const dbPath = getTestDbPath();
    dbPaths.push(dbPath);

    await seed(dbPath);

    const db = new Database(dbPath);
    const vm = db.prepare('SELECT * FROM vms WHERE host = ?').get('127.0.0.1') as {
      id: string;
      label: string;
      host: string;
      port: number;
      username: string;
      encrypted_password: string;
      encryption_iv: string;
      encryption_auth_tag: string;
    };
    db.close();

    expect(vm).toBeDefined();
    expect(vm.label).toBe('Test VM');
    expect(vm.host).toBe('127.0.0.1');
    expect(vm.port).toBe(22);
    expect(vm.username).toBe('user');
    // Verify the encrypted password can be decrypted
    const decrypted = decryptPassword(
      vm.encrypted_password,
      vm.encryption_iv,
      vm.encryption_auth_tag
    );
    expect(decrypted).toBe('changeme');
  });

  it('should create vm_status record for test VM', async () => {
    const dbPath = getTestDbPath();
    dbPaths.push(dbPath);

    await seed(dbPath);

    const db = new Database(dbPath);
    const vm = db.prepare('SELECT id FROM vms WHERE host = ?').get('127.0.0.1') as { id: string };
    const status = db.prepare('SELECT * FROM vm_status WHERE vm_id = ?').get(vm.id) as {
      vm_id: string;
      status: string;
      fail_count: number;
    };
    db.close();

    expect(status).toBeDefined();
    expect(status.status).toBe('offline');
    expect(status.fail_count).toBe(0);
  });

  it('should be idempotent (safe to run multiple times)', async () => {
    const dbPath = getTestDbPath();
    dbPaths.push(dbPath);

    await seed(dbPath);
    await seed(dbPath);

    const db = new Database(dbPath);
    const users = db.prepare('SELECT * FROM users WHERE username = ?').all('admin');
    const vms = db.prepare('SELECT * FROM vms WHERE host = ?').all('127.0.0.1');
    db.close();

    expect(users).toHaveLength(1);
    expect(vms).toHaveLength(1);
  });
});
