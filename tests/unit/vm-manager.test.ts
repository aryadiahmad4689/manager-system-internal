import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listVMs, addVM, createVMManager, getVMStatus, checkAllStatuses } from '@/lib/vm/vm-manager';
import { decrypt } from '@/lib/crypto/credential-store';
import { getDb, closeDb } from '@/lib/db/index';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

describe('vm-manager', () => {
  let db: Database.Database;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.resolve(
      process.cwd(),
      'data',
      'test',
      `vm-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );

    process.env.ENCRYPTION_KEY =
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    process.env.DATABASE_PATH = testDbPath;

    // Close any existing singleton before creating a new one
    closeDb();

    // Initialize the database with the test path
    db = getDb(testDbPath);
  });

  afterEach(() => {
    closeDb();
    delete process.env.ENCRYPTION_KEY;
    delete process.env.DATABASE_PATH;

    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    }
  });

  describe('listVMs', () => {
    it('should return an empty array when no VMs exist', async () => {
      const vms = await listVMs();
      expect(vms).toEqual([]);
    });

    it('should return all VMs ordered by created_at descending', async () => {
      // Insert VMs directly into the database
      db.prepare(
        `INSERT INTO vms (id, label, host, port, username, encrypted_password, encryption_iv, encryption_auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('vm-1', 'First VM', '192.168.1.1', 22, 'root', 'enc1', 'iv1', 'tag1', '2024-01-01 00:00:00', '2024-01-01 00:00:00');

      db.prepare(
        `INSERT INTO vms (id, label, host, port, username, encrypted_password, encryption_iv, encryption_auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('vm-2', 'Second VM', '192.168.1.2', 2222, 'admin', 'enc2', 'iv2', 'tag2', '2024-01-02 00:00:00', '2024-01-02 00:00:00');

      const vms = await listVMs();

      expect(vms).toHaveLength(2);
      // Most recent first
      expect(vms[0].label).toBe('Second VM');
      expect(vms[1].label).toBe('First VM');
    });

    it('should map database columns to VMConfig properties correctly', async () => {
      db.prepare(
        `INSERT INTO vms (id, label, host, port, username, encrypted_password, encryption_iv, encryption_auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('vm-abc', 'My Server', '10.0.0.5', 2222, 'deploy', 'cipher', 'myiv', 'mytag', '2024-06-15 10:30:00', '2024-06-15 11:00:00');

      const vms = await listVMs();

      expect(vms).toHaveLength(1);
      expect(vms[0]).toEqual({
        id: 'vm-abc',
        label: 'My Server',
        host: '10.0.0.5',
        port: 2222,
        username: 'deploy',
        encryptedPassword: 'cipher',
        createdAt: new Date('2024-06-15 10:30:00'),
        updatedAt: new Date('2024-06-15 11:00:00'),
      });
    });
  });

  describe('addVM', () => {
    it('should add a VM and return the created VMConfig', async () => {
      const result = await addVM({
        label: 'Production Server',
        host: '172.18.139.186',
        port: 22,
        username: 'root',
        encryptedPassword: 'my-secret-password',
      });

      expect(result.id).toBeDefined();
      expect(result.id).toHaveLength(32); // 16 bytes hex
      expect(result.label).toBe('Production Server');
      expect(result.host).toBe('172.18.139.186');
      expect(result.port).toBe(22);
      expect(result.username).toBe('root');
      expect(result.encryptedPassword).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should encrypt the password before storing', async () => {
      const password = 'super-secret-123';

      await addVM({
        label: 'Test VM',
        host: '192.168.1.100',
        port: 22,
        username: 'admin',
        encryptedPassword: password,
      });

      // Verify the password is stored encrypted in the database
      const row = db.prepare('SELECT encrypted_password, encryption_iv, encryption_auth_tag FROM vms').get() as {
        encrypted_password: string;
        encryption_iv: string;
        encryption_auth_tag: string;
      };

      // The stored value should not be the plaintext password
      expect(row.encrypted_password).not.toBe(password);
      expect(row.encryption_iv).toBeDefined();
      expect(row.encryption_auth_tag).toBeDefined();

      // But decrypting should give back the original password
      const decrypted = decrypt({
        ciphertext: row.encrypted_password,
        iv: row.encryption_iv,
        authTag: row.encryption_auth_tag,
      });
      expect(decrypted).toBe(password);
    });

    it('should create an initial vm_status record with offline status', async () => {
      const result = await addVM({
        label: 'Status Test VM',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const status = db.prepare('SELECT * FROM vm_status WHERE vm_id = ?').get(result.id) as {
        vm_id: string;
        status: string;
        last_checked: string | null;
        fail_count: number;
      };

      expect(status).toBeDefined();
      expect(status.vm_id).toBe(result.id);
      expect(status.status).toBe('offline');
      expect(status.last_checked).toBeNull();
      expect(status.fail_count).toBe(0);
    });

    it('should generate unique IDs for each VM', async () => {
      const vm1 = await addVM({
        label: 'VM 1',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass1',
      });

      const vm2 = await addVM({
        label: 'VM 2',
        host: '10.0.0.2',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass2',
      });

      expect(vm1.id).not.toBe(vm2.id);
    });

    it('should store the VM so it appears in listVMs', async () => {
      await addVM({
        label: 'Listed VM',
        host: '172.16.0.1',
        port: 2222,
        username: 'deploy',
        encryptedPassword: 'deploy-pass',
      });

      const vms = await listVMs();

      expect(vms).toHaveLength(1);
      expect(vms[0].label).toBe('Listed VM');
      expect(vms[0].host).toBe('172.16.0.1');
      expect(vms[0].port).toBe(2222);
      expect(vms[0].username).toBe('deploy');
    });

    it('should handle special characters in label and password', async () => {
      const password = 'p@$$w0rd!#%^&*()_+-=[]{}|;:,.<>?';

      const result = await addVM({
        label: 'VM with "special" chars & <tags>',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        encryptedPassword: password,
      });

      expect(result.label).toBe('VM with "special" chars & <tags>');

      // Verify password round-trip
      const row = db.prepare('SELECT encrypted_password, encryption_iv, encryption_auth_tag FROM vms WHERE id = ?').get(result.id) as {
        encrypted_password: string;
        encryption_iv: string;
        encryption_auth_tag: string;
      };

      const decrypted = decrypt({
        ciphertext: row.encrypted_password,
        iv: row.encryption_iv,
        authTag: row.encryption_auth_tag,
      });
      expect(decrypted).toBe(password);
    });
  });

  describe('createVMManager', () => {
    it('should return an object implementing VMManager interface', () => {
      const manager = createVMManager();

      expect(manager.listVMs).toBeTypeOf('function');
      expect(manager.addVM).toBeTypeOf('function');
      expect(manager.getVMStatus).toBeTypeOf('function');
      expect(manager.checkAllStatuses).toBeTypeOf('function');
    });

    it('should delegate getVMStatus to the implementation', async () => {
      const vm = await addVM({
        label: 'Manager Test VM',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const manager = createVMManager();
      const status = await manager.getVMStatus(vm.id);

      expect(status.vmId).toBe(vm.id);
      expect(status.status).toBe('offline');
      expect(status.failCount).toBe(0);
    });
  });

  describe('getVMStatus', () => {
    it('should return the current status of a VM', async () => {
      const vm = await addVM({
        label: 'Status VM',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const status = await getVMStatus(vm.id);

      expect(status.vmId).toBe(vm.id);
      expect(status.status).toBe('offline');
      expect(status.failCount).toBe(0);
    });

    it('should throw an error for non-existent VM', async () => {
      await expect(getVMStatus('non-existent-id')).rejects.toThrow('VM status not found');
    });

    it('should reflect updated status after checkAllStatuses', async () => {
      const vm = await addVM({
        label: 'Check VM',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      // Mock connectivity as online
      const mockChecker = vi.fn().mockResolvedValue(true);
      await checkAllStatuses(mockChecker);

      const status = await getVMStatus(vm.id);
      expect(status.status).toBe('online');
      expect(status.failCount).toBe(0);
    });
  });

  describe('checkAllStatuses', () => {
    it('should return empty array when no VMs exist', async () => {
      const mockChecker = vi.fn().mockResolvedValue(true);
      const results = await checkAllStatuses(mockChecker);
      expect(results).toEqual([]);
    });

    it('should set status to online when connection succeeds', async () => {
      const vm = await addVM({
        label: 'Online VM',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn().mockResolvedValue(true);
      const results = await checkAllStatuses(mockChecker);

      expect(results).toHaveLength(1);
      expect(results[0].vmId).toBe(vm.id);
      expect(results[0].status).toBe('online');
      expect(results[0].failCount).toBe(0);
      expect(mockChecker).toHaveBeenCalledWith('10.0.0.1', 22);
    });

    it('should set status to offline on first failure', async () => {
      const vm = await addVM({
        label: 'Failing VM',
        host: '10.0.0.2',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn().mockResolvedValue(false);
      const results = await checkAllStatuses(mockChecker);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('offline');
      expect(results[0].failCount).toBe(1);
    });

    it('should set status to offline on second consecutive failure', async () => {
      await addVM({
        label: 'Failing VM',
        host: '10.0.0.2',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn().mockResolvedValue(false);

      // First failure
      await checkAllStatuses(mockChecker);
      // Second failure
      const results = await checkAllStatuses(mockChecker);

      expect(results[0].status).toBe('offline');
      expect(results[0].failCount).toBe(2);
    });

    it('should set status to unreachable after 3 consecutive failures', async () => {
      await addVM({
        label: 'Unreachable VM',
        host: '10.0.0.3',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn().mockResolvedValue(false);

      // Three consecutive failures
      await checkAllStatuses(mockChecker);
      await checkAllStatuses(mockChecker);
      const results = await checkAllStatuses(mockChecker);

      expect(results[0].status).toBe('unreachable');
      expect(results[0].failCount).toBe(3);
    });

    it('should reset fail count when connection succeeds after failures', async () => {
      await addVM({
        label: 'Recovery VM',
        host: '10.0.0.4',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn();

      // Two failures
      mockChecker.mockResolvedValue(false);
      await checkAllStatuses(mockChecker);
      await checkAllStatuses(mockChecker);

      // Then success
      mockChecker.mockResolvedValue(true);
      const results = await checkAllStatuses(mockChecker);

      expect(results[0].status).toBe('online');
      expect(results[0].failCount).toBe(0);
    });

    it('should reset from unreachable to online when connection succeeds', async () => {
      await addVM({
        label: 'Recovered VM',
        host: '10.0.0.5',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn();

      // Three failures → unreachable
      mockChecker.mockResolvedValue(false);
      await checkAllStatuses(mockChecker);
      await checkAllStatuses(mockChecker);
      await checkAllStatuses(mockChecker);

      // Then success → online
      mockChecker.mockResolvedValue(true);
      const results = await checkAllStatuses(mockChecker);

      expect(results[0].status).toBe('online');
      expect(results[0].failCount).toBe(0);
    });

    it('should check all VMs and return results for each', async () => {
      await addVM({
        label: 'VM A',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });
      await addVM({
        label: 'VM B',
        host: '10.0.0.2',
        port: 2222,
        username: 'admin',
        encryptedPassword: 'pass',
      });

      // First VM online, second VM offline
      const mockChecker = vi.fn()
        .mockImplementation((host: string) => Promise.resolve(host === '10.0.0.1'));

      const results = await checkAllStatuses(mockChecker);

      expect(results).toHaveLength(2);
      expect(mockChecker).toHaveBeenCalledWith('10.0.0.1', 22);
      expect(mockChecker).toHaveBeenCalledWith('10.0.0.2', 2222);

      const vmA = results.find(r => r.status === 'online');
      const vmB = results.find(r => r.status === 'offline');
      expect(vmA).toBeDefined();
      expect(vmB).toBeDefined();
      expect(vmB!.failCount).toBe(1);
    });

    it('should persist status to the database', async () => {
      const vm = await addVM({
        label: 'Persist VM',
        host: '10.0.0.6',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn().mockResolvedValue(true);
      await checkAllStatuses(mockChecker);

      // Verify directly in the database
      const row = db.prepare('SELECT * FROM vm_status WHERE vm_id = ?').get(vm.id) as {
        vm_id: string;
        status: string;
        last_checked: string;
        fail_count: number;
      };

      expect(row.status).toBe('online');
      expect(row.fail_count).toBe(0);
      expect(row.last_checked).not.toBeNull();
    });

    it('should update last_checked timestamp on each check', async () => {
      await addVM({
        label: 'Timestamp VM',
        host: '10.0.0.7',
        port: 22,
        username: 'user',
        encryptedPassword: 'pass',
      });

      const mockChecker = vi.fn().mockResolvedValue(true);
      const results = await checkAllStatuses(mockChecker);

      expect(results[0].lastChecked).toBeInstanceOf(Date);
      expect(results[0].lastChecked.getTime()).toBeGreaterThan(0);
    });
  });
});
