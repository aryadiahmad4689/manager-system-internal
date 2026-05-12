import crypto from 'crypto';
import net from 'net';
import { getSSHManager } from '../ssh/ssh-manager';

export interface TunnelConfig {
  vmId: string;
  remoteHost: string;  // usually 'localhost' (from VM perspective)
  remotePort: number;  // database port on VM
}

export interface ActiveTunnel {
  id: string;
  vmId: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  createdAt: Date;
  lastUsed: Date;
}

export interface TunnelManager {
  createTunnel(config: TunnelConfig): Promise<ActiveTunnel>;
  closeTunnel(tunnelId: string): Promise<void>;
  getTunnel(tunnelId: string): ActiveTunnel | undefined;
  closeAllTunnels(): Promise<void>;
}

/** Internal state for a managed tunnel */
interface ManagedTunnel {
  tunnel: ActiveTunnel;
  server: net.Server;
  sockets: Set<net.Socket>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * SSH Tunnel Manager implementation.
 *
 * Creates local TCP servers that forward traffic through SSH channels
 * to remote database ports on VMs. Each tunnel gets a dynamically
 * allocated local port and auto-closes after 5 minutes of inactivity.
 */
export class TunnelManagerImpl implements TunnelManager {
  private tunnels: Map<string, ManagedTunnel> = new Map();
  private idleTimeoutMs: number;

  constructor(idleTimeoutMs: number = IDLE_TIMEOUT_MS) {
    this.idleTimeoutMs = idleTimeoutMs;
  }

  /**
   * Creates a new SSH tunnel to the specified remote host/port on a VM.
   * Allocates a dynamic local port and starts forwarding traffic.
   */
  async createTunnel(config: TunnelConfig): Promise<ActiveTunnel> {
    const { vmId, remoteHost, remotePort } = config;

    // Get SSH connection for the VM
    const sshConnection = await getSSHManager().getConnection(vmId);

    const tunnelId = crypto.randomBytes(16).toString('hex');

    // Create a local TCP server on a dynamic port (port 0)
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));

      // Update lastUsed on each new connection
      this.touchTunnel(tunnelId);

      // Forward traffic through SSH channel
      sshConnection.client.forwardOut(
        '127.0.0.1',
        socket.localPort || 0,
        remoteHost,
        remotePort,
        (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }

          socket.pipe(stream);
          stream.pipe(socket);

          socket.on('error', () => stream.destroy());
          stream.on('error', () => socket.destroy());

          socket.on('close', () => stream.destroy());
          stream.on('close', () => socket.destroy());
        }
      );
    });

    // Start listening on dynamic port
    const localPort = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        resolve(address.port);
      });
    });

    const now = new Date();
    const activeTunnel: ActiveTunnel = {
      id: tunnelId,
      vmId,
      localPort,
      remoteHost,
      remotePort,
      createdAt: now,
      lastUsed: now,
    };

    const managed: ManagedTunnel = {
      tunnel: activeTunnel,
      server,
      sockets,
      idleTimer: null,
    };

    this.tunnels.set(tunnelId, managed);
    this.resetIdleTimer(tunnelId);

    return activeTunnel;
  }

  /**
   * Closes a specific tunnel by ID, stopping the local server.
   */
  async closeTunnel(tunnelId: string): Promise<void> {
    const managed = this.tunnels.get(tunnelId);
    if (!managed) return;

    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }

    // Destroy all active sockets so server.close() can complete
    for (const socket of managed.sockets) {
      socket.destroy();
    }
    managed.sockets.clear();

    await new Promise<void>((resolve) => {
      managed.server.close(() => resolve());
    });

    this.tunnels.delete(tunnelId);
  }

  /**
   * Retrieves active tunnel info by ID.
   */
  getTunnel(tunnelId: string): ActiveTunnel | undefined {
    const managed = this.tunnels.get(tunnelId);
    return managed?.tunnel;
  }

  /**
   * Closes all active tunnels.
   */
  async closeAllTunnels(): Promise<void> {
    const ids = Array.from(this.tunnels.keys());
    await Promise.all(ids.map((id) => this.closeTunnel(id)));
  }

  /**
   * Updates the lastUsed timestamp for a tunnel and resets its idle timer.
   */
  touchTunnel(tunnelId: string): void {
    const managed = this.tunnels.get(tunnelId);
    if (!managed) return;

    managed.tunnel.lastUsed = new Date();
    this.resetIdleTimer(tunnelId);
  }

  /**
   * Returns the number of active tunnels (for testing/monitoring).
   */
  getActiveTunnelCount(): number {
    return this.tunnels.size;
  }

  /**
   * Resets the idle timeout timer for a tunnel.
   * When the timer fires, the tunnel is automatically closed.
   */
  private resetIdleTimer(tunnelId: string): void {
    const managed = this.tunnels.get(tunnelId);
    if (!managed) return;

    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
    }

    managed.idleTimer = setTimeout(() => {
      this.closeTunnel(tunnelId);
    }, this.idleTimeoutMs);

    // Prevent the timer from keeping the process alive
    if (managed.idleTimer.unref) {
      managed.idleTimer.unref();
    }
  }
}

/**
 * Singleton Tunnel Manager instance.
 */
let tunnelManagerInstance: TunnelManagerImpl | null = null;

/**
 * Returns the singleton Tunnel Manager instance.
 */
export function getTunnelManager(): TunnelManagerImpl {
  if (!tunnelManagerInstance) {
    tunnelManagerInstance = new TunnelManagerImpl();
  }
  return tunnelManagerInstance;
}

/**
 * Resets the singleton Tunnel Manager (useful for testing).
 */
export async function resetTunnelManager(): Promise<void> {
  if (tunnelManagerInstance) {
    await tunnelManagerInstance.closeAllTunnels();
    tunnelManagerInstance = null;
  }
}

/**
 * Creates a new Tunnel Manager instance (useful for testing with custom config).
 */
export function createTunnelManager(idleTimeoutMs?: number): TunnelManagerImpl {
  return new TunnelManagerImpl(idleTimeoutMs);
}
