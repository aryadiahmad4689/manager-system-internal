import { getDb } from './index';
import { decrypt } from '../crypto/credential-store';

export type DatabaseType = 'mysql' | 'postgresql' | 'mariadb';

export interface DatabaseConnectionConfig {
  id: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
  database?: string;
}

export interface DatabaseConnection {
  id: string;
  config: DatabaseConnectionConfig;
  client: any; // mysql2 Connection or pg Client
  status: 'connected' | 'disconnected' | 'error';
  lastUsed: Date;
}

export interface DatabaseManager {
  connect(connectionId: string): Promise<DatabaseConnection>;
  disconnect(connectionId: string): Promise<void>;
  getConnection(connectionId: string): DatabaseConnection | undefined;
  getStatus(connectionId: string): Promise<'connected' | 'disconnected' | 'unreachable'>;
  disconnectAll(): Promise<void>;
}

/** Row shape from the database_connections table */
interface DatabaseConnectionRow {
  id: string;
  db_type: string;
  host: string;
  port: number;
  db_username: string;
  encrypted_password: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  label: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Custom error class for credential-related failures.
 */
export class DatabaseCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseCredentialError';
  }
}

/**
 * Custom error class for database server not running.
 */
export class DatabaseServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseServerError';
  }
}

/**
 * Database Connection Manager implementation.
 *
 * Manages the lifecycle of database connections through SSH tunnels.
 * Each connection creates an SSH tunnel to the VM, then connects
 * a database client (mysql2 or pg) through the tunnel.
 */
export class DatabaseManagerImpl implements DatabaseManager {
  private connections: Map<string, DatabaseConnection> = new Map();

  /**
   * Establishes a direct database connection.
   *
   * Flow:
   * 1. Load connection config from SQLite
   * 2. Decrypt the stored password
   * 3. Connect database client directly to host:port
   */
  async connect(connectionId: string): Promise<DatabaseConnection> {
    // Check if already connected
    const existing = this.connections.get(connectionId);
    if (existing && existing.status === 'connected') {
      existing.lastUsed = new Date();
      return existing;
    }

    // Load connection config from database
    const config = this.loadConnectionConfig(connectionId);

    // Decrypt password
    const password = this.decryptPassword(connectionId);

    // Connect database client directly
    let client: any;
    try {
      client = await this.createDatabaseClient(config, config.port, password);
    } catch (err: any) {
      this.classifyAndThrowError(err, config.dbType);
      throw err; // unreachable, but satisfies TypeScript
    }

    const connection: DatabaseConnection = {
      id: connectionId,
      config,
      client,
      status: 'connected',
      lastUsed: new Date(),
    };

    this.connections.set(connectionId, connection);
    return connection;
  }

  /**
   * Disconnects a database connection.
   */
  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Close database client
    await this.closeDatabaseClient(connection);

    connection.status = 'disconnected';
    this.connections.delete(connectionId);
  }

  /**
   * Retrieves an active connection by ID.
   */
  getConnection(connectionId: string): DatabaseConnection | undefined {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastUsed = new Date();
    }
    return connection;
  }

  /**
   * Checks the status of a database connection.
   *
   * Flow:
   * 1. If connection exists and is active, test connectivity
   * 2. Otherwise return 'disconnected'
   */
  async getStatus(connectionId: string): Promise<'connected' | 'disconnected' | 'unreachable'> {
    // Check if we have an active connection
    const connection = this.connections.get(connectionId);
    if (!connection || connection.status !== 'connected') {
      return 'disconnected';
    }

    // Test database connectivity with a simple query
    try {
      await this.pingDatabase(connection);
      return 'connected';
    } catch {
      // Connection is stale, clean up
      connection.status = 'error';
      return 'disconnected';
    }
  }

  /**
   * Disconnects all active database connections and closes their tunnels.
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  /**
   * Loads connection configuration from the local SQLite database.
   */
  private loadConnectionConfig(connectionId: string): DatabaseConnectionConfig {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM database_connections WHERE id = ?')
      .get(connectionId) as DatabaseConnectionRow | undefined;

    if (!row) {
      throw new Error(`Database connection not found: ${connectionId}`);
    }

    return {
      id: row.id,
      dbType: row.db_type as DatabaseType,
      host: row.host,
      port: row.port,
      username: row.db_username,
    };
  }

  /**
   * Decrypts the stored password for a database connection.
   */
  private decryptPassword(connectionId: string): string {
    const db = getDb();
    const row = db
      .prepare(
        'SELECT encrypted_password, encryption_iv, encryption_auth_tag FROM database_connections WHERE id = ?'
      )
      .get(connectionId) as
      | { encrypted_password: string; encryption_iv: string; encryption_auth_tag: string }
      | undefined;

    if (!row) {
      throw new DatabaseCredentialError(`Database connection not found: ${connectionId}`);
    }

    try {
      return decrypt({
        ciphertext: row.encrypted_password,
        iv: row.encryption_iv,
        authTag: row.encryption_auth_tag,
      });
    } catch (err: any) {
      throw new DatabaseCredentialError(`Failed to decrypt credentials: ${err.message}`);
    }
  }

  /**
   * Creates a database client connected through the SSH tunnel.
   */
  private async createDatabaseClient(
    config: DatabaseConnectionConfig,
    localPort: number,
    password: string
  ): Promise<any> {
    if (config.dbType === 'mysql' || config.dbType === 'mariadb') {
      return this.createMySQLClient(config, localPort, password);
    } else if (config.dbType === 'postgresql') {
      return this.createPostgreSQLClient(config, localPort, password);
    }

    throw new Error(`Unsupported database type: ${config.dbType}`);
  }

  /**
   * Creates a MySQL/MariaDB connection using mysql2/promise.
   */
  private async createMySQLClient(
    config: DatabaseConnectionConfig,
    localPort: number,
    password: string
  ): Promise<any> {
    const mysql = await import('mysql2/promise');

    const connection = await mysql.createConnection({
      host: config.host,
      port: localPort,
      user: config.username,
      password,
      database: config.database,
      connectTimeout: 10000,
    });

    return connection;
  }

  /**
   * Creates a PostgreSQL connection using pg Client.
   */
  private async createPostgreSQLClient(
    config: DatabaseConnectionConfig,
    localPort: number,
    password: string
  ): Promise<any> {
    const { Client } = await import('pg');

    const client = new Client({
      host: config.host,
      port: localPort,
      user: config.username,
      password,
      database: config.database || 'postgres',
      connectionTimeoutMillis: 10000,
    });

    await client.connect();
    return client;
  }

  /**
   * Closes a database client based on its type.
   */
  private async closeDatabaseClient(connection: DatabaseConnection): Promise<void> {
    try {
      if (connection.config.dbType === 'mysql' || connection.config.dbType === 'mariadb') {
        await connection.client?.end();
      } else if (connection.config.dbType === 'postgresql') {
        await connection.client?.end();
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Pings the database to verify the connection is still alive.
   */
  private async pingDatabase(connection: DatabaseConnection): Promise<void> {
    if (connection.config.dbType === 'mysql' || connection.config.dbType === 'mariadb') {
      await connection.client.ping();
    } else if (connection.config.dbType === 'postgresql') {
      await connection.client.query('SELECT 1');
    }
  }

  /**
   * Classifies a database connection error and throws the appropriate error type.
   * Differentiates between credential errors and server-not-running errors.
   */
  private classifyAndThrowError(err: any, dbType: DatabaseType): never {
    const message = err.message || '';
    const code = err.code || '';

    // MySQL/MariaDB error codes
    if (dbType === 'mysql' || dbType === 'mariadb') {
      // ER_ACCESS_DENIED_ERROR (1045)
      if (code === 'ER_ACCESS_DENIED_ERROR' || message.includes('Access denied')) {
        throw new DatabaseCredentialError(
          `Authentication failed: invalid username or password`
        );
      }
      // ECONNREFUSED - server not running
      if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
        throw new DatabaseServerError(
          `Database server is not running or not accepting connections on the specified port`
        );
      }
    }

    // PostgreSQL error codes
    if (dbType === 'postgresql') {
      // 28P01 - invalid_password, 28000 - invalid_authorization_specification
      if (code === '28P01' || code === '28000' || message.includes('password authentication failed')) {
        throw new DatabaseCredentialError(
          `Authentication failed: invalid username or password`
        );
      }
      // ECONNREFUSED - server not running
      if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
        throw new DatabaseServerError(
          `Database server is not running or not accepting connections on the specified port`
        );
      }
    }

    // Connection timeout
    if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('ETIMEDOUT')) {
      throw new DatabaseServerError(
        `Connection timed out: database server may not be running`
      );
    }

    // Unknown error — rethrow as-is
    throw err;
  }
}

/**
 * Singleton Database Manager instance.
 * Attached to globalThis to survive Next.js hot module replacement in dev mode.
 */
const globalForDbManager = globalThis as unknown as {
  databaseManagerInstance: DatabaseManagerImpl | null;
};

if (!globalForDbManager.databaseManagerInstance) {
  globalForDbManager.databaseManagerInstance = null;
}

/**
 * Returns the singleton Database Manager instance.
 */
export function getDatabaseManager(): DatabaseManagerImpl {
  if (!globalForDbManager.databaseManagerInstance) {
    globalForDbManager.databaseManagerInstance = new DatabaseManagerImpl();
  }
  return globalForDbManager.databaseManagerInstance;
}

/**
 * Resets the singleton Database Manager (useful for testing).
 */
export async function resetDatabaseManager(): Promise<void> {
  if (globalForDbManager.databaseManagerInstance) {
    await globalForDbManager.databaseManagerInstance.disconnectAll();
    globalForDbManager.databaseManagerInstance = null;
  }
}

/**
 * Creates a new Database Manager instance (useful for testing with custom config).
 */
export function createDatabaseManager(): DatabaseManagerImpl {
  return new DatabaseManagerImpl();
}
