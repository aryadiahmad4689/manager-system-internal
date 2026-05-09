import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createDb } from '@/lib/db';

const TEST_DB_DIR = path.resolve(process.cwd(), 'data', 'test');

function getTestDbPath(): string {
  return path.join(TEST_DB_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('Database initialization', () => {
  const dbsToClose: Database.Database[] = [];

  afterEach(() => {
    for (const db of dbsToClose) {
      try { db.close(); } catch { /* ignore */ }
    }
    dbsToClose.length = 0;

    // Clean up test database files
    if (fs.existsSync(TEST_DB_DIR)) {
      const files = fs.readdirSync(TEST_DB_DIR);
      for (const file of files) {
        if (file.startsWith('test-')) {
          try { fs.unlinkSync(path.join(TEST_DB_DIR, file)); } catch { /* ignore */ }
        }
      }
    }
  });

  it('should create database with all required tables', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('vms');
    expect(tableNames).toContain('vm_status');
    expect(tableNames).toContain('sessions');
  });

  it('should enable WAL journal mode', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const result = db.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  it('should create users table with correct columns', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const columns = db.prepare("PRAGMA table_info(users)").all() as {
      name: string; type: string; notnull: number; pk: number;
    }[];

    const colNames = columns.map(c => c.name);
    expect(colNames).toEqual(['id', 'username', 'password_hash', 'created_at', 'last_login']);

    const idCol = columns.find(c => c.name === 'id')!;
    expect(idCol.pk).toBe(1);

    const usernameCol = columns.find(c => c.name === 'username')!;
    expect(usernameCol.notnull).toBe(1);
  });

  it('should create vms table with correct columns', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const columns = db.prepare("PRAGMA table_info(vms)").all() as {
      name: string; type: string; notnull: number; pk: number;
    }[];

    const colNames = columns.map(c => c.name);
    expect(colNames).toEqual([
      'id', 'label', 'host', 'port', 'username',
      'encrypted_password', 'encryption_iv', 'encryption_auth_tag',
      'created_at', 'updated_at'
    ]);
  });

  it('should create vm_status table with correct columns', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const columns = db.prepare("PRAGMA table_info(vm_status)").all() as {
      name: string; type: string; notnull: number; pk: number;
    }[];

    const colNames = columns.map(c => c.name);
    expect(colNames).toEqual(['vm_id', 'status', 'last_checked', 'fail_count']);
  });

  it('should create sessions table with correct columns', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    const columns = db.prepare("PRAGMA table_info(sessions)").all() as {
      name: string; type: string; notnull: number; pk: number;
    }[];

    const colNames = columns.map(c => c.name);
    expect(colNames).toEqual(['id', 'user_id', 'created_at', 'expires_at', 'is_active']);
  });

  it('should enforce unique username constraint', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    db.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES ('id1', 'admin', 'hash1')"
    ).run();

    expect(() => {
      db.prepare(
        "INSERT INTO users (id, username, password_hash) VALUES ('id2', 'admin', 'hash2')"
      ).run();
    }).toThrow();
  });

  it('should enforce vm_status check constraint on status values', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    // Insert a VM first
    db.prepare(
      "INSERT INTO vms (id, label, host, username, encrypted_password, encryption_iv, encryption_auth_tag) VALUES ('vm1', 'Test VM', '192.168.1.1', 'user', 'enc', 'iv', 'tag')"
    ).run();

    // Valid status should work
    db.prepare(
      "INSERT INTO vm_status (vm_id, status) VALUES ('vm1', 'online')"
    ).run();

    // Invalid status should fail
    expect(() => {
      db.prepare(
        "UPDATE vm_status SET status = 'invalid' WHERE vm_id = 'vm1'"
      ).run();
    }).toThrow();
  });

  it('should cascade delete vm_status when vm is deleted', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    db.prepare(
      "INSERT INTO vms (id, label, host, username, encrypted_password, encryption_iv, encryption_auth_tag) VALUES ('vm1', 'Test VM', '192.168.1.1', 'user', 'enc', 'iv', 'tag')"
    ).run();

    db.prepare(
      "INSERT INTO vm_status (vm_id, status) VALUES ('vm1', 'online')"
    ).run();

    db.prepare("DELETE FROM vms WHERE id = 'vm1'").run();

    const status = db.prepare("SELECT * FROM vm_status WHERE vm_id = 'vm1'").get();
    expect(status).toBeUndefined();
  });

  it('should be safe to run migrations multiple times (idempotent)', () => {
    const dbPath = getTestDbPath();
    const db = createDb(dbPath);
    dbsToClose.push(db);

    // Insert some data
    db.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES ('id1', 'admin', 'hash1')"
    ).run();

    // Run schema again (simulating re-migration) - should not throw
    const schemaPath = path.resolve(__dirname, '../../src/lib/db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    expect(() => db.exec(schema)).not.toThrow();

    // Data should still be there
    const user = db.prepare("SELECT * FROM users WHERE id = 'id1'").get() as { username: string };
    expect(user.username).toBe('admin');
  });
});
