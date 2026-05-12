import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import net from 'net';

// Mock SSH Manager
const mockForwardOut = vi.fn();
const mockClient = {
  forwardOut: mockForwardOut,
};

const mockGetConnection = vi.fn().mockResolvedValue({
  id: 'ssh-conn-1',
  vmId: 'vm-1',
  client: mockClient,
  lastUsed: new Date(),
  status: 'connected',
});

vi.mock('@/lib/ssh/ssh-manager', () => ({
  getSSHManager: vi.fn(() => ({
    getConnection: mockGetConnection,
  })),
}));

import {
  TunnelManagerImpl,
  createTunnelManager,
  TunnelConfig,
} from '@/lib/db/tunnel-manager';

describe('TunnelManager', () => {
  let manager: TunnelManagerImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createTunnelManager(5 * 60 * 1000); // 5 min idle timeout
  });

  afterEach(async () => {
    await manager.closeAllTunnels();
  });

  describe('createTunnel', () => {
    it('should create a tunnel with a dynamic local port', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      const tunnel = await manager.createTunnel(config);

      expect(tunnel).toBeDefined();
      expect(tunnel.id).toHaveLength(32);
      expect(tunnel.vmId).toBe('vm-1');
      expect(tunnel.localPort).toBeGreaterThan(0);
      expect(tunnel.remoteHost).toBe('localhost');
      expect(tunnel.remotePort).toBe(3306);
      expect(tunnel.createdAt).toBeInstanceOf(Date);
      expect(tunnel.lastUsed).toBeInstanceOf(Date);
    });

    it('should get SSH connection for the specified VM', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-2',
        remoteHost: 'localhost',
        remotePort: 5432,
      };

      await manager.createTunnel(config);

      expect(mockGetConnection).toHaveBeenCalledWith('vm-2');
    });

    it('should allocate different ports for multiple tunnels', async () => {
      const config1: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };
      const config2: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 5432,
      };

      const tunnel1 = await manager.createTunnel(config1);
      const tunnel2 = await manager.createTunnel(config2);

      expect(tunnel1.localPort).not.toBe(tunnel2.localPort);
      expect(tunnel1.id).not.toBe(tunnel2.id);
    });

    it('should reject when SSH connection fails', async () => {
      mockGetConnection.mockRejectedValueOnce(new Error('VM not found: vm-bad'));

      const config: TunnelConfig = {
        vmId: 'vm-bad',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      await expect(manager.createTunnel(config)).rejects.toThrow('VM not found: vm-bad');
    });

    it('should forward traffic through SSH channel when client connects', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      // Set up forwardOut to succeed with a proper duplex-like mock stream
      const mockStream = new EventEmitter() as any;
      mockStream.pipe = vi.fn().mockReturnThis();
      mockStream.destroy = vi.fn();
      mockStream.end = vi.fn();

      mockForwardOut.mockImplementation(
        (srcAddr: string, srcPort: number, dstAddr: string, dstPort: number, cb: Function) => {
          cb(null, mockStream);
        }
      );

      const tunnel = await manager.createTunnel(config);

      // Connect a client to the local port
      const client = new net.Socket();
      await new Promise<void>((resolve) => {
        client.connect(tunnel.localPort, '127.0.0.1', () => {
          resolve();
        });
      });

      // Wait for the forwardOut to be called
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockForwardOut).toHaveBeenCalledWith(
        '127.0.0.1',
        expect.any(Number),
        'localhost',
        3306,
        expect.any(Function)
      );

      client.destroy();
      // Give time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should destroy socket when forwardOut fails', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      mockForwardOut.mockImplementation(
        (srcAddr: string, srcPort: number, dstAddr: string, dstPort: number, cb: Function) => {
          cb(new Error('Channel open failure'));
        }
      );

      const tunnel = await manager.createTunnel(config);

      // Connect a client to the local port
      const client = new net.Socket();
      await new Promise<void>((resolve) => {
        client.connect(tunnel.localPort, '127.0.0.1', () => {
          resolve();
        });
      });

      // Wait for the forwardOut error to propagate
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Client should be destroyed
      expect(client.destroyed).toBe(true);
    });
  });

  describe('closeTunnel', () => {
    it('should close a specific tunnel', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      const tunnel = await manager.createTunnel(config);
      expect(manager.getTunnel(tunnel.id)).toBeDefined();

      await manager.closeTunnel(tunnel.id);

      expect(manager.getTunnel(tunnel.id)).toBeUndefined();
    });

    it('should not throw when closing a non-existent tunnel', async () => {
      await expect(manager.closeTunnel('non-existent-id')).resolves.toBeUndefined();
    });

    it('should stop the local server from accepting connections', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      const tunnel = await manager.createTunnel(config);
      const port = tunnel.localPort;

      await manager.closeTunnel(tunnel.id);

      // Attempting to connect should fail
      await expect(
        new Promise<void>((resolve, reject) => {
          const client = new net.Socket();
          client.on('error', reject);
          client.connect(port, '127.0.0.1', () => resolve());
        })
      ).rejects.toThrow();
    });
  });

  describe('getTunnel', () => {
    it('should return tunnel info for an active tunnel', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 5432,
      };

      const tunnel = await manager.createTunnel(config);
      const retrieved = manager.getTunnel(tunnel.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(tunnel.id);
      expect(retrieved!.vmId).toBe('vm-1');
      expect(retrieved!.localPort).toBe(tunnel.localPort);
      expect(retrieved!.remoteHost).toBe('localhost');
      expect(retrieved!.remotePort).toBe(5432);
    });

    it('should return undefined for a non-existent tunnel', () => {
      const result = manager.getTunnel('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('closeAllTunnels', () => {
    it('should close all active tunnels', async () => {
      const config1: TunnelConfig = { vmId: 'vm-1', remoteHost: 'localhost', remotePort: 3306 };
      const config2: TunnelConfig = { vmId: 'vm-1', remoteHost: 'localhost', remotePort: 5432 };

      const tunnel1 = await manager.createTunnel(config1);
      const tunnel2 = await manager.createTunnel(config2);

      expect(manager.getActiveTunnelCount()).toBe(2);

      await manager.closeAllTunnels();

      expect(manager.getActiveTunnelCount()).toBe(0);
      expect(manager.getTunnel(tunnel1.id)).toBeUndefined();
      expect(manager.getTunnel(tunnel2.id)).toBeUndefined();
    });

    it('should be safe to call when no tunnels exist', async () => {
      await expect(manager.closeAllTunnels()).resolves.toBeUndefined();
    });
  });

  describe('idle timeout', () => {
    it('should auto-close tunnel after idle timeout', async () => {
      // Use a short timeout for testing
      const shortManager = createTunnelManager(100); // 100ms

      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      const tunnel = await shortManager.createTunnel(config);
      expect(shortManager.getTunnel(tunnel.id)).toBeDefined();

      // Wait for idle timeout to fire
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(shortManager.getTunnel(tunnel.id)).toBeUndefined();
      expect(shortManager.getActiveTunnelCount()).toBe(0);
    });

    it('should reset idle timer when tunnel is touched', async () => {
      const shortManager = createTunnelManager(150); // 150ms

      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      const tunnel = await shortManager.createTunnel(config);

      // Touch the tunnel before timeout
      await new Promise((resolve) => setTimeout(resolve, 100));
      shortManager.touchTunnel(tunnel.id);

      // Wait another 100ms (total 200ms from creation, but only 100ms from last touch)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Tunnel should still be alive because we touched it
      expect(shortManager.getTunnel(tunnel.id)).toBeDefined();

      // Now wait for the full idle timeout from last touch
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(shortManager.getTunnel(tunnel.id)).toBeUndefined();

      await shortManager.closeAllTunnels();
    });

    it('should update lastUsed when touchTunnel is called', async () => {
      const config: TunnelConfig = {
        vmId: 'vm-1',
        remoteHost: 'localhost',
        remotePort: 3306,
      };

      const tunnel = await manager.createTunnel(config);
      const initialLastUsed = tunnel.lastUsed.getTime();

      await new Promise((resolve) => setTimeout(resolve, 20));
      manager.touchTunnel(tunnel.id);

      const updated = manager.getTunnel(tunnel.id);
      expect(updated!.lastUsed.getTime()).toBeGreaterThan(initialLastUsed);
    });

    it('should not throw when touching a non-existent tunnel', () => {
      expect(() => manager.touchTunnel('non-existent')).not.toThrow();
    });
  });
});
