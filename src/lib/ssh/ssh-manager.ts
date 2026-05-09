import crypto from 'crypto';
import { Client, ClientChannel } from 'ssh2';
import { getCredential } from '../crypto/credential-store';
import { getDb } from '../db/index';

/**
 * Represents a pooled SSH connection to a VM.
 */
export interface SSHConnection {
  id: string;
  vmId: string;
  client: Client;
  lastUsed: Date;
  status: 'connected' | 'disconnected' | 'error';
}

/**
 * Shell stream interface for interactive terminal sessions.
 */
export interface SSHShellStream {
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  onClose(callback: () => void): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/**
 * SSH Manager interface for managing SSH connections with pooling.
 */
export interface SSHManager {
  getConnection(vmId: string): Promise<SSHConnection>;
  executeCommand(vmId: string, command: string): Promise<string>;
  openShell(vmId: string, cols?: number, rows?: number): Promise<SSHShellStream>;
  closeConnection(vmId: string): Promise<void>;
  closeAll(): Promise<void>;
}

/**
 * Configuration for the SSH connection pool.
 */
export interface SSHPoolConfig {
  maxConnectionsPerVM: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;
  connectTimeoutMs: number;
}

const DEFAULT_POOL_CONFIG: SSHPoolConfig = {
  maxConnectionsPerVM: 5,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  healthCheckIntervalMs: 30 * 1000, // 30 seconds
  connectTimeoutMs: 30 * 1000, // 30 seconds
};

/**
 * VM configuration row from the database.
 */
interface VMRow {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
}

/**
 * Retrieves VM connection config from the database.
 */
function getVMConfig(vmId: string): VMRow {
  const db = getDb();
  const row = db
    .prepare('SELECT id, label, host, port, username FROM vms WHERE id = ?')
    .get(vmId) as VMRow | undefined;

  if (!row) {
    throw new Error(`VM not found: ${vmId}`);
  }

  return row;
}

/**
 * Creates an SSHShellStream wrapper around an ssh2 ClientChannel.
 */
function createShellStream(channel: ClientChannel): SSHShellStream {
  return {
    write(data: string): void {
      channel.write(data);
    },
    onData(callback: (data: string) => void): void {
      channel.on('data', (data: Buffer) => {
        callback(data.toString('utf8'));
      });
    },
    onClose(callback: () => void): void {
      channel.on('close', callback);
    },
    resize(cols: number, rows: number): void {
      channel.setWindow(rows, cols, rows * 16, cols * 8);
    },
    close(): void {
      channel.close();
    },
  };
}

/**
 * SSH Manager implementation with connection pooling.
 *
 * Features:
 * - Max 5 connections per VM
 * - 5-minute idle timeout for unused connections
 * - 30-second health check ping to detect stale connections
 * - Automatic reconnection on connection drop
 */
export class SSHManagerImpl implements SSHManager {
  private pools: Map<string, SSHConnection[]> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;
  private config: SSHPoolConfig;

  constructor(config: Partial<SSHPoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.startHealthCheck();
    this.startIdleCheck();
  }

  /**
   * Gets an available connection from the pool or creates a new one.
   * Reuses connected idle connections when available.
   */
  async getConnection(vmId: string): Promise<SSHConnection> {
    const pool = this.pools.get(vmId) || [];

    // Find an existing connected connection
    const available = pool.find((conn) => conn.status === 'connected');
    if (available) {
      available.lastUsed = new Date();
      return available;
    }

    // Check if we've hit the max connections limit
    const activeCount = pool.filter(
      (conn) => conn.status === 'connected'
    ).length;
    if (activeCount >= this.config.maxConnectionsPerVM) {
      throw new Error(
        `Maximum connections (${this.config.maxConnectionsPerVM}) reached for VM: ${vmId}`
      );
    }

    // Create a new connection
    const connection = await this.createConnection(vmId);

    // Add to pool
    if (!this.pools.has(vmId)) {
      this.pools.set(vmId, []);
    }
    this.pools.get(vmId)!.push(connection);

    return connection;
  }

  /**
   * Executes a command on the VM and returns the output.
   */
  async executeCommand(vmId: string, command: string): Promise<string> {
    const connection = await this.getConnection(vmId);
    connection.lastUsed = new Date();

    return new Promise<string>((resolve, reject) => {
      connection.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('data', (data: Buffer) => {
          output += data.toString('utf8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString('utf8');
        });

        stream.on('close', (code: number) => {
          if (code !== 0 && errorOutput) {
            reject(new Error(`Command failed (exit code ${code}): ${errorOutput}`));
          } else {
            resolve(output);
          }
        });

        stream.on('error', (streamErr: Error) => {
          reject(streamErr);
        });
      });
    });
  }

  /**
   * Opens an interactive shell session on the VM.
   */
  async openShell(vmId: string, cols: number = 80, rows: number = 24): Promise<SSHShellStream> {
    const connection = await this.getConnection(vmId);
    connection.lastUsed = new Date();

    return new Promise<SSHShellStream>((resolve, reject) => {
      connection.client.shell(
        { term: 'xterm-256color', cols, rows },
        (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(createShellStream(stream));
        }
      );
    });
  }

  /**
   * Closes all connections for a specific VM.
   */
  async closeConnection(vmId: string): Promise<void> {
    const pool = this.pools.get(vmId);
    if (!pool) return;

    for (const conn of pool) {
      if (conn.status === 'connected') {
        conn.client.end();
        conn.status = 'disconnected';
      }
    }

    this.pools.delete(vmId);
  }

  /**
   * Closes all connections across all VMs and stops background intervals.
   */
  async closeAll(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    for (const [vmId] of this.pools) {
      await this.closeConnection(vmId);
    }

    this.pools.clear();
  }

  /**
   * Returns the current pool state (for testing/monitoring).
   */
  getPoolState(): Map<string, SSHConnection[]> {
    return this.pools;
  }

  /**
   * Creates a new SSH connection to the specified VM.
   */
  private async createConnection(vmId: string): Promise<SSHConnection> {
    const vmConfig = getVMConfig(vmId);
    const password = await getCredential(vmId);

    const client = new Client();
    const connectionId = crypto.randomBytes(16).toString('hex');

    const connection: SSHConnection = {
      id: connectionId,
      vmId,
      client,
      lastUsed: new Date(),
      status: 'disconnected',
    };

    return new Promise<SSHConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error(`Connection timeout for VM: ${vmId}`));
      }, this.config.connectTimeoutMs);

      client.on('ready', () => {
        clearTimeout(timeout);
        connection.status = 'connected';
        resolve(connection);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        connection.status = 'error';
        reject(err);
      });

      client.on('close', () => {
        connection.status = 'disconnected';
        this.removeFromPool(vmId, connectionId);
      });

      client.connect({
        host: vmConfig.host,
        port: vmConfig.port,
        username: vmConfig.username,
        password,
        readyTimeout: this.config.connectTimeoutMs,
      });
    });
  }

  /**
   * Removes a connection from the pool by ID.
   */
  private removeFromPool(vmId: string, connectionId: string): void {
    const pool = this.pools.get(vmId);
    if (!pool) return;

    const index = pool.findIndex((conn) => conn.id === connectionId);
    if (index !== -1) {
      pool.splice(index, 1);
    }

    if (pool.length === 0) {
      this.pools.delete(vmId);
    }
  }

  /**
   * Starts the health check interval that pings connections every 30 seconds.
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    // Prevent the interval from keeping the process alive
    if (this.healthCheckInterval.unref) {
      this.healthCheckInterval.unref();
    }
  }

  /**
   * Starts the idle check interval that closes stale connections.
   */
  private startIdleCheck(): void {
    this.idleCheckInterval = setInterval(() => {
      this.performIdleCheck();
    }, this.config.idleTimeoutMs / 2); // Check at half the idle timeout

    // Prevent the interval from keeping the process alive
    if (this.idleCheckInterval.unref) {
      this.idleCheckInterval.unref();
    }
  }

  /**
   * Pings all connected connections to detect stale ones.
   */
  private performHealthCheck(): void {
    for (const [vmId, pool] of this.pools) {
      for (const conn of pool) {
        if (conn.status === 'connected') {
          // Use exec with a simple command as a ping
          conn.client.exec('echo ping', (err, stream) => {
            if (err) {
              conn.status = 'error';
              conn.client.end();
              this.removeFromPool(vmId, conn.id);
            } else {
              stream.on('close', () => {
                // Connection is healthy
              });
              stream.resume(); // Consume data
            }
          });
        }
      }
    }
  }

  /**
   * Closes connections that have been idle longer than the configured timeout.
   */
  private performIdleCheck(): void {
    const now = Date.now();

    for (const [vmId, pool] of this.pools) {
      const toRemove: string[] = [];

      for (const conn of pool) {
        const idleTime = now - conn.lastUsed.getTime();
        if (idleTime >= this.config.idleTimeoutMs && conn.status === 'connected') {
          conn.client.end();
          conn.status = 'disconnected';
          toRemove.push(conn.id);
        }
      }

      for (const id of toRemove) {
        this.removeFromPool(vmId, id);
      }
    }
  }
}

/**
 * Singleton SSH Manager instance.
 */
let sshManagerInstance: SSHManagerImpl | null = null;

/**
 * Returns the singleton SSH Manager instance.
 */
export function getSSHManager(config?: Partial<SSHPoolConfig>): SSHManagerImpl {
  if (!sshManagerInstance) {
    sshManagerInstance = new SSHManagerImpl(config);
  }
  return sshManagerInstance;
}

/**
 * Resets the singleton SSH Manager (useful for testing).
 */
export async function resetSSHManager(): Promise<void> {
  if (sshManagerInstance) {
    await sshManagerInstance.closeAll();
    sshManagerInstance = null;
  }
}

/**
 * Creates a new SSH Manager instance (useful for testing with custom config).
 */
export function createSSHManager(config?: Partial<SSHPoolConfig>): SSHManagerImpl {
  return new SSHManagerImpl(config);
}
