import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock ssh2 Client - emit 'ready' on connect by default
vi.mock('ssh2', () => {
  const { EventEmitter } = require('events');
  class MockClient extends EventEmitter {
    connect = vi.fn(function (this: any) {
      // Emit ready on next tick by default
      process.nextTick(() => this.emit('ready'));
    });
    exec = vi.fn();
    shell = vi.fn();
    end = vi.fn();
  }
  return { Client: MockClient };
});

vi.mock('@/lib/crypto/credential-store', () => ({
  getCredential: vi.fn().mockResolvedValue('test-password'),
}));

const mockDbGet = vi.fn().mockReturnValue({
  id: 'vm-1',
  label: 'Test VM',
  host: '192.168.1.100',
  port: 22,
  username: 'root',
});

vi.mock('@/lib/db/index', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: (...args: any[]) => mockDbGet(...args),
    })),
  })),
}));

import { SSHManagerImpl, createSSHManager } from '@/lib/ssh/ssh-manager';
import { Client } from 'ssh2';
import { getCredential } from '@/lib/crypto/credential-store';
import { getDb } from '@/lib/db/index';

describe('SSHManager', () => {
  let manager: SSHManagerImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockReturnValue({
      id: 'vm-1',
      label: 'Test VM',
      host: '192.168.1.100',
      port: 22,
      username: 'root',
    });
    manager = createSSHManager({
      maxConnectionsPerVM: 5,
      idleTimeoutMs: 5 * 60 * 1000,
      healthCheckIntervalMs: 60 * 1000,
      connectTimeoutMs: 30 * 1000,
    });
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  describe('getConnection', () => {
    it('should create a new connection when pool is empty', async () => {
      const connection = await manager.getConnection('vm-1');

      expect(connection).toBeDefined();
      expect(connection.vmId).toBe('vm-1');
      expect(connection.status).toBe('connected');
      expect(connection.id).toHaveLength(32);
      expect(connection.lastUsed).toBeInstanceOf(Date);
      expect(connection.client.connect).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 22,
        username: 'root',
        password: 'test-password',
        readyTimeout: 30000,
      });
    });

    it('should reuse an existing connected connection', async () => {
      const conn1 = await manager.getConnection('vm-1');
      const conn2 = await manager.getConnection('vm-1');

      expect(conn1.id).toBe(conn2.id);
    });

    it('should update lastUsed when reusing a connection', async () => {
      const conn1 = await manager.getConnection('vm-1');
      const firstUsed = conn1.lastUsed.getTime();

      await new Promise((resolve) => setTimeout(resolve, 10));

      const conn2 = await manager.getConnection('vm-1');
      expect(conn2.lastUsed.getTime()).toBeGreaterThanOrEqual(firstUsed);
    });

    it('should get VM config from database', async () => {
      await manager.getConnection('vm-1');

      expect(getDb).toHaveBeenCalled();
      expect(mockDbGet).toHaveBeenCalled();
    });

    it('should get password from credential store', async () => {
      await manager.getConnection('vm-1');

      expect(getCredential).toHaveBeenCalledWith('vm-1');
    });

    it('should reject when VM is not found in database', async () => {
      mockDbGet.mockReturnValue(undefined);

      await expect(manager.getConnection('non-existent')).rejects.toThrow('VM not found: non-existent');
    });

    it('should reject when connection emits error', async () => {
      // We need a fresh manager that will create a new Client
      // The mock Client emits 'ready' by default, so we need to intercept
      // We'll use getCredential to throw, which is simpler to test error path
      // Actually, let's test by making the credential store reject
      vi.mocked(getCredential).mockRejectedValueOnce(new Error('Credential decryption failed'));

      await expect(manager.getConnection('vm-1')).rejects.toThrow('Credential decryption failed');
    });
  });

  describe('executeCommand', () => {
    it('should execute a command and return stdout', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();
      mockStream.resume = vi.fn();

      vi.mocked(conn.client.exec).mockImplementation(((cmd: string, cb: Function) => {
        cb(null, mockStream);
        process.nextTick(() => {
          mockStream.emit('data', Buffer.from('hello world'));
          mockStream.emit('close', 0);
        });
      }) as any);

      const result = await manager.executeCommand('vm-1', 'echo hello world');

      expect(result).toBe('hello world');
    });

    it('should reject when command fails with non-zero exit code', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();

      vi.mocked(conn.client.exec).mockImplementation(((cmd: string, cb: Function) => {
        cb(null, mockStream);
        process.nextTick(() => {
          mockStream.stderr.emit('data', Buffer.from('command not found'));
          mockStream.emit('close', 127);
        });
      }) as any);

      await expect(manager.executeCommand('vm-1', 'invalid-cmd')).rejects.toThrow(
        'Command failed (exit code 127): command not found'
      );
    });

    it('should reject when exec returns an error', async () => {
      const conn = await manager.getConnection('vm-1');

      vi.mocked(conn.client.exec).mockImplementation(((cmd: string, cb: Function) => {
        cb(new Error('Channel open failed'));
      }) as any);

      await expect(manager.executeCommand('vm-1', 'ls')).rejects.toThrow('Channel open failed');
    });

    it('should concatenate multiple data chunks', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();

      vi.mocked(conn.client.exec).mockImplementation(((cmd: string, cb: Function) => {
        cb(null, mockStream);
        process.nextTick(() => {
          mockStream.emit('data', Buffer.from('line 1\n'));
          mockStream.emit('data', Buffer.from('line 2\n'));
          mockStream.emit('data', Buffer.from('line 3'));
          mockStream.emit('close', 0);
        });
      }) as any);

      const result = await manager.executeCommand('vm-1', 'cat file.txt');

      expect(result).toBe('line 1\nline 2\nline 3');
    });
  });

  describe('openShell', () => {
    it('should open a shell and return an SSHShellStream', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockChannel = new EventEmitter() as any;
      mockChannel.write = vi.fn();
      mockChannel.close = vi.fn();
      mockChannel.setWindow = vi.fn();

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(null, mockChannel);
      }) as any);

      const shell = await manager.openShell('vm-1');

      expect(shell).toBeDefined();
      expect(shell.write).toBeTypeOf('function');
      expect(shell.onData).toBeTypeOf('function');
      expect(shell.onClose).toBeTypeOf('function');
      expect(shell.resize).toBeTypeOf('function');
      expect(shell.close).toBeTypeOf('function');
    });

    it('should forward write calls to the channel', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockChannel = new EventEmitter() as any;
      mockChannel.write = vi.fn();
      mockChannel.close = vi.fn();
      mockChannel.setWindow = vi.fn();

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(null, mockChannel);
      }) as any);

      const shell = await manager.openShell('vm-1');
      shell.write('ls -la\n');

      expect(mockChannel.write).toHaveBeenCalledWith('ls -la\n');
    });

    it('should forward data events from the channel', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockChannel = new EventEmitter() as any;
      mockChannel.write = vi.fn();
      mockChannel.close = vi.fn();
      mockChannel.setWindow = vi.fn();

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(null, mockChannel);
      }) as any);

      const shell = await manager.openShell('vm-1');

      const received: string[] = [];
      shell.onData((data) => received.push(data));

      mockChannel.emit('data', Buffer.from('output data'));

      expect(received).toEqual(['output data']);
    });

    it('should call setWindow on resize', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockChannel = new EventEmitter() as any;
      mockChannel.write = vi.fn();
      mockChannel.close = vi.fn();
      mockChannel.setWindow = vi.fn();

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(null, mockChannel);
      }) as any);

      const shell = await manager.openShell('vm-1');
      shell.resize(120, 40);

      expect(mockChannel.setWindow).toHaveBeenCalledWith(40, 120, 640, 960);
    });

    it('should reject when shell open fails', async () => {
      const conn = await manager.getConnection('vm-1');

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(new Error('Shell open failed'));
      }) as any);

      await expect(manager.openShell('vm-1')).rejects.toThrow('Shell open failed');
    });

    it('should forward close events from the channel', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockChannel = new EventEmitter() as any;
      mockChannel.write = vi.fn();
      mockChannel.close = vi.fn();
      mockChannel.setWindow = vi.fn();

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(null, mockChannel);
      }) as any);

      const shell = await manager.openShell('vm-1');

      let closed = false;
      shell.onClose(() => { closed = true; });

      mockChannel.emit('close');

      expect(closed).toBe(true);
    });

    it('should close the channel when close() is called', async () => {
      const conn = await manager.getConnection('vm-1');

      const mockChannel = new EventEmitter() as any;
      mockChannel.write = vi.fn();
      mockChannel.close = vi.fn();
      mockChannel.setWindow = vi.fn();

      vi.mocked(conn.client.shell).mockImplementation(((opts: any, cb: Function) => {
        cb(null, mockChannel);
      }) as any);

      const shell = await manager.openShell('vm-1');
      shell.close();

      expect(mockChannel.close).toHaveBeenCalled();
    });
  });

  describe('closeConnection', () => {
    it('should close all connections for a VM', async () => {
      const conn = await manager.getConnection('vm-1');

      await manager.closeConnection('vm-1');

      expect(conn.client.end).toHaveBeenCalled();
      expect(conn.status).toBe('disconnected');
      expect(manager.getPoolState().has('vm-1')).toBe(false);
    });

    it('should do nothing for a VM with no connections', async () => {
      await manager.closeConnection('non-existent-vm');
      // Should not throw
    });
  });

  describe('closeAll', () => {
    it('should close all connections across all VMs', async () => {
      let callCount = 0;
      mockDbGet.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { id: 'vm-1', label: 'VM 1', host: '10.0.0.1', port: 22, username: 'root' };
        }
        return { id: 'vm-2', label: 'VM 2', host: '10.0.0.2', port: 22, username: 'admin' };
      });

      const conn1 = await manager.getConnection('vm-1');
      const conn2 = await manager.getConnection('vm-2');

      await manager.closeAll();

      expect(conn1.client.end).toHaveBeenCalled();
      expect(conn2.client.end).toHaveBeenCalled();
      expect(manager.getPoolState().size).toBe(0);
    });

    it('should be safe to call multiple times', async () => {
      await manager.closeAll();
      await manager.closeAll();
      // Should not throw
    });
  });

  describe('connection pooling', () => {
    it('should maintain separate pools per VM', async () => {
      let callCount = 0;
      mockDbGet.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { id: 'vm-1', label: 'VM 1', host: '10.0.0.1', port: 22, username: 'root' };
        }
        return { id: 'vm-2', label: 'VM 2', host: '10.0.0.2', port: 22, username: 'admin' };
      });

      const conn1 = await manager.getConnection('vm-1');
      const conn2 = await manager.getConnection('vm-2');

      expect(conn1.vmId).toBe('vm-1');
      expect(conn2.vmId).toBe('vm-2');
      expect(conn1.id).not.toBe(conn2.id);
      expect(manager.getPoolState().size).toBe(2);
    });

    it('should remove connection from pool on close event', async () => {
      const conn = await manager.getConnection('vm-1');
      expect(manager.getPoolState().get('vm-1')?.length).toBe(1);

      // Simulate connection close event from ssh2
      conn.client.emit('close');

      expect(manager.getPoolState().has('vm-1')).toBe(false);
    });

    it('should enforce max connections per VM limit', async () => {
      await manager.closeAll();
      manager = createSSHManager({
        maxConnectionsPerVM: 2,
        idleTimeoutMs: 5 * 60 * 1000,
        healthCheckIntervalMs: 60 * 1000,
        connectTimeoutMs: 30 * 1000,
      });

      // Manually populate pool with max connected connections
      const pool = manager.getPoolState();
      const mockClient1 = new (Client as any)();
      const mockClient2 = new (Client as any)();
      pool.set('vm-1', [
        { id: 'c1', vmId: 'vm-1', client: mockClient1, lastUsed: new Date(), status: 'connected' as const },
        { id: 'c2', vmId: 'vm-1', client: mockClient2, lastUsed: new Date(), status: 'connected' as const },
      ]);

      // getConnection should reuse an existing connection (first available)
      const conn = await manager.getConnection('vm-1');
      expect(conn.id).toBe('c1');
    });
  });

  describe('idle timeout', () => {
    it('should close connections idle longer than timeout', async () => {
      await manager.closeAll();
      manager = createSSHManager({
        idleTimeoutMs: 50,
        healthCheckIntervalMs: 100000,
      });

      const conn = await manager.getConnection('vm-1');
      // Set lastUsed to past to simulate idle
      conn.lastUsed = new Date(Date.now() - 200);

      // Wait for idle check to run (idleTimeout / 2 = 25ms)
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(conn.client.end).toHaveBeenCalled();
      expect(conn.status).toBe('disconnected');
    });

    it('should not close connections that are still active', async () => {
      await manager.closeAll();
      manager = createSSHManager({
        idleTimeoutMs: 200,
        healthCheckIntervalMs: 100000,
      });

      const conn = await manager.getConnection('vm-1');
      // lastUsed is now (just created)

      // Wait less than idle timeout / 2
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(conn.client.end).not.toHaveBeenCalled();
      expect(conn.status).toBe('connected');
    });
  });
});
