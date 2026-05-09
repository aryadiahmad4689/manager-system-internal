import { createDb, getDb, closeDb } from './index';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import path from 'path';

const SALT_ROUNDS = 10;

const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'admin123',
};

const TEST_VM = {
  label: 'Test VM',
  host: '172.18.139.186',
  port: 22,
  username: 'administrator',
  password: 'Bre@kthrough2312',
};

/**
 * Encrypts a password using AES-256-GCM.
 * Uses ENCRYPTION_KEY from environment or a default dev key.
 */
function encryptPassword(plaintext: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const keyHex =
    process.env.ENCRYPTION_KEY ||
    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  const key = Buffer.from(keyHex, 'hex');
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
 * Seeds the database with a default admin user and test VM.
 * Safe to run multiple times — skips if records already exist.
 */
export async function seed(dbPath?: string): Promise<void> {
  const db = dbPath ? createDb(dbPath) : getDb();

  try {
    // Seed admin user
    const existingUser = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(DEFAULT_ADMIN.username);

    if (!existingUser) {
      const passwordHash = await bcrypt.hash(DEFAULT_ADMIN.password, SALT_ROUNDS);
      db.prepare(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)'
      ).run(DEFAULT_ADMIN.username, passwordHash);
      console.log(`✓ Created admin user: ${DEFAULT_ADMIN.username}`);
    } else {
      console.log(`⊘ Admin user already exists, skipping.`);
    }

    // Seed test VM
    const existingVM = db
      .prepare('SELECT id FROM vms WHERE host = ? AND username = ?')
      .get(TEST_VM.host, TEST_VM.username);

    if (!existingVM) {
      const encrypted = encryptPassword(TEST_VM.password);
      db.prepare(
        `INSERT INTO vms (label, host, port, username, encrypted_password, encryption_iv, encryption_auth_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        TEST_VM.label,
        TEST_VM.host,
        TEST_VM.port,
        TEST_VM.username,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag
      );

      // Also insert initial vm_status record
      const vm = db
        .prepare('SELECT id FROM vms WHERE host = ? AND username = ?')
        .get(TEST_VM.host, TEST_VM.username) as { id: string };

      db.prepare(
        'INSERT INTO vm_status (vm_id, status, last_checked, fail_count) VALUES (?, ?, CURRENT_TIMESTAMP, 0)'
      ).run(vm.id, 'offline');

      console.log(`✓ Created test VM: ${TEST_VM.label} (${TEST_VM.host})`);
    } else {
      console.log(`⊘ Test VM already exists, skipping.`);
    }
  } finally {
    if (dbPath) {
      db.close();
    }
  }
}

// Run seed when executed directly
if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'dashboard.db');
  console.log(`Seeding database at: ${dbPath}`);
  seed()
    .then(() => {
      console.log('✓ Seed complete.');
      closeDb();
      process.exit(0);
    })
    .catch((err) => {
      console.error('✗ Seed failed:', err);
      closeDb();
      process.exit(1);
    });
}
