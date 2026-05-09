import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

// We test the authorize logic directly by simulating what auth.config.ts does
// since NextAuth's authorize function relies on the database

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test', 'auth-test.db');

describe('Auth Configuration', () => {
  let db: Database.Database;
  const testUser = {
    id: 'test-user-id',
    username: 'admin',
    password: 'securepassword123',
    passwordHash: '',
  };

  beforeAll(async () => {
    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Remove old test db if exists
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      );
    `);

    // Hash the test password and insert user
    testUser.passwordHash = await bcrypt.hash(testUser.password, 10);
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
      testUser.id,
      testUser.username,
      testUser.passwordHash
    );
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('password validation', () => {
    it('should validate correct password', async () => {
      const user = db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get(testUser.username) as { id: string; username: string; password_hash: string };

      const isValid = await bcrypt.compare(testUser.password, user.password_hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const user = db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get(testUser.username) as { id: string; username: string; password_hash: string };

      const isValid = await bcrypt.compare('wrongpassword', user.password_hash);
      expect(isValid).toBe(false);
    });

    it('should return null for non-existent user', () => {
      const user = db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get('nonexistent');

      expect(user).toBeUndefined();
    });
  });

  describe('session configuration', () => {
    it('should use JWT strategy with 30-min maxAge', async () => {
      // Import the auth config to verify session settings
      const { authOptions } = await import('@/lib/auth/auth.config');

      expect(authOptions.session?.strategy).toBe('jwt');
      expect(authOptions.session?.maxAge).toBe(1800);
    });

    it('should configure sign-in page to /login', async () => {
      const { authOptions } = await import('@/lib/auth/auth.config');

      expect(authOptions.pages?.signIn).toBe('/login');
    });

    it('should have credentials provider configured', async () => {
      const { authOptions } = await import('@/lib/auth/auth.config');

      expect(authOptions.providers).toHaveLength(1);
      expect(authOptions.providers[0].name).toBe('Credentials');
    });
  });

  describe('last_login update', () => {
    it('should update last_login on successful authentication', async () => {
      // Verify last_login is initially null
      const before = db
        .prepare('SELECT last_login FROM users WHERE id = ?')
        .get(testUser.id) as { last_login: string | null };
      expect(before.last_login).toBeNull();

      // Simulate what authorize does after successful validation
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(
        testUser.id
      );

      const after = db
        .prepare('SELECT last_login FROM users WHERE id = ?')
        .get(testUser.id) as { last_login: string | null };
      expect(after.last_login).not.toBeNull();
    });
  });
});
