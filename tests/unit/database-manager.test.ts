import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted to declare mock functions that can be referenced in vi.mock factories
const {
  mockDecrypt,
  mockGet,
  mockPrepare,
  mockMysqlEnd,
  mockMysqlPing,
  mockMysqlCreateConnection,
  mockPgEnd,
  mockPgConnect,
  mockPgQuery,
} = vi.hoisted(() => ({
  mockDecrypt: vi.fn(),
  mockGet: vi.fn(),
  mockPrepare: vi.fn(),
  mockMysqlEnd: vi.fn(),
  mockMysqlPing: vi.fn(),
  mockMysqlCreateConnection: vi.fn(),
  mockPgEnd: vi.fn(),
  mockPgConnect: vi.fn(),
  mockPgQuery: vi.fn(),
}));

// Mock credential store
vi.mock('@/lib/crypto/credential-store', () => ({
  decrypt: mockDecrypt,
}));

// Mock database (better-sqlite3)
vi.mock('@/lib/db/index', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
}));

// Mock mysql2/promise
vi.mock('mysql2/promise', () => ({
  createConnection: (...args: any[]) => mockMysqlCreateConnection(...args),
}));

// Mock pg - use a class so it works as a constructor with `new`
vi.mock('pg', () => {
  return {
    Client: class MockPgClient {
      connect = mockPgConnect;
      end = mockPgEnd;
      query = mockPgQuery;
    },
  };
});

import {
  DatabaseManagerImpl,
  createDatabaseManager,
  DatabaseCredentialError,
  DatabaseServerError,
} from '@/lib/db/database-manager';

describe('DatabaseManager', () => {
  let manager: DatabaseManagerImpl;

  const mockConnectionRow = {
    id: 'conn-1',
    db_type: 'mysql',
    host: '172.18.139.190',
    port: 3306,
    db_username: 'root',
    encrypted_password: 'encrypted-pw',
    encryption_iv: 'iv-value',
    encryption_auth_tag: 'auth-tag',
    label: 'Test DB',
    created_at: '2024-01-01 00:00:00',
    updated_at: '2024-01-01 00:00:00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createDatabaseManager();

    // Default mock implementations
    mockPrepare.mockReturnValue({ get: mockGet });
    mockGet.mockReturnValue(mockConnectionRow);
    mockDecrypt.mockReturnValue('decrypted-password');
    mockMysqlEnd.mockResolvedValue(undefined);
    mockMysqlPing.mockResolvedValue(undefined);
    mockMysqlCreateConnection.mockResolvedValue({
      end: mockMysqlEnd,
      ping: mockMysqlPing,
    });
    mockPgEnd.mockResolvedValue(undefined);
    mockPgConnect.mockResolvedValue(undefined);
    mockPgQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe('connect', () => {
    it('should connect MySQL client directly to host', async () => {
      const connection = await manager.connect('conn-1');

      expect(connection).toBeDefined();
      expect(connection.id).toBe('conn-1');
      expect(connection.status).toBe('connected');
      expect(connection.config.dbType).toBe('mysql');

      expect(mockMysqlCreateConnection).toHaveBeenCalledWith({
        host: '172.18.139.190',
        port: 3306,
        user: 'root',
        password: 'decrypted-password',
        database: undefined,
        connectTimeout: 10000,
      });
    });

    it('should connect PostgreSQL client directly to host', async () => {
      const pgRow = { ...mockConnectionRow, db_type: 'postgresql', port: 5432 };
      mockGet.mockReturnValue(pgRow);

      const connection = await manager.connect('conn-1');

      expect(connection).toBeDefined();
      expect(connection.status).toBe('connected');
      expect(connection.config.dbType).toBe('postgresql');
      expect(mockPgConnect).toHaveBeenCalled();
    });

    it('should connect MariaDB client using mysql2', async () => {
      const mariaRow = { ...mockConnectionRow, db_type: 'mariadb' };
      mockGet.mockReturnValue(mariaRow);

      const connection = await manager.connect('conn-1');

      expect(connection).toBeDefined();
      expect(connection.status).toBe('connected');
      expect(connection.config.dbType).toBe('mariadb');
      expect(mockMysqlCreateConnection).toHaveBeenCalled();
    });

    it('should return existing connection if already connected', async () => {
      const conn1 = await manager.connect('conn-1');
      const conn2 = await manager.connect('conn-1');

      expect(conn1).toBe(conn2);
      // Client should only be created once
      expect(mockMysqlCreateConnection).toHaveBeenCalledTimes(1);
    });

    it('should throw when connection config not found in database', async () => {
      mockGet.mockReturnValue(undefined);

      await expect(manager.connect('non-existent')).rejects.toThrow(
        'Database connection not found: non-existent'
      );
    });

    it('should throw DatabaseCredentialError when decryption fails', async () => {
      mockDecrypt.mockImplementation(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      });

      await expect(manager.connect('conn-1')).rejects.toThrow(DatabaseCredentialError);
    });

    it('should throw DatabaseCredentialError for MySQL access denied', async () => {
      mockMysqlCreateConnection.mockRejectedValueOnce(
        Object.assign(new Error('Access denied for user'), { code: 'ER_ACCESS_DENIED_ERROR' })
      );

      await expect(manager.connect('conn-1')).rejects.toThrow(DatabaseCredentialError);
    });

    it('should throw DatabaseServerError for connection refused', async () => {
      mockMysqlCreateConnection.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      );

      await expect(manager.connect('conn-1')).rejects.toThrow(DatabaseServerError);
    });

    it('should throw DatabaseCredentialError for PostgreSQL auth failure', async () => {
      const pgRow = { ...mockConnectionRow, db_type: 'postgresql', port: 5432 };
      mockGet.mockReturnValue(pgRow);

      mockPgConnect.mockRejectedValueOnce(
        Object.assign(new Error('password authentication failed for user "root"'), { code: '28P01' })
      );

      await expect(manager.connect('conn-1')).rejects.toThrow(DatabaseCredentialError);
    });

    it('should throw DatabaseServerError for PostgreSQL connection refused', async () => {
      const pgRow = { ...mockConnectionRow, db_type: 'postgresql', port: 5432 };
      mockGet.mockReturnValue(pgRow);

      mockPgConnect.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      );

      await expect(manager.connect('conn-1')).rejects.toThrow(DatabaseServerError);
    });

    it('should throw DatabaseServerError for connection timeout', async () => {
      mockMysqlCreateConnection.mockRejectedValueOnce(
        Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' })
      );

      await expect(manager.connect('conn-1')).rejects.toThrow(DatabaseServerError);
    });
  });

  describe('disconnect', () => {
    it('should close MySQL database client', async () => {
      await manager.connect('conn-1');
      await manager.disconnect('conn-1');

      expect(mockMysqlEnd).toHaveBeenCalled();
      expect(manager.getConnection('conn-1')).toBeUndefined();
    });

    it('should close PostgreSQL client', async () => {
      const pgRow = { ...mockConnectionRow, db_type: 'postgresql', port: 5432 };
      mockGet.mockReturnValue(pgRow);

      await manager.connect('conn-1');
      await manager.disconnect('conn-1');

      expect(mockPgEnd).toHaveBeenCalled();
    });

    it('should not throw when disconnecting a non-existent connection', async () => {
      await expect(manager.disconnect('non-existent')).resolves.toBeUndefined();
    });

    it('should remove connection from internal map after disconnect', async () => {
      await manager.connect('conn-1');
      expect(manager.getConnection('conn-1')).toBeDefined();

      await manager.disconnect('conn-1');
      expect(manager.getConnection('conn-1')).toBeUndefined();
    });
  });

  describe('getConnection', () => {
    it('should return active connection', async () => {
      await manager.connect('conn-1');
      const connection = manager.getConnection('conn-1');

      expect(connection).toBeDefined();
      expect(connection!.id).toBe('conn-1');
      expect(connection!.status).toBe('connected');
    });

    it('should return undefined for non-existent connection', () => {
      const connection = manager.getConnection('non-existent');
      expect(connection).toBeUndefined();
    });

    it('should update lastUsed timestamp when retrieved', async () => {
      await manager.connect('conn-1');
      const before = manager.getConnection('conn-1')!.lastUsed.getTime();

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const connection = manager.getConnection('conn-1');
      expect(connection!.lastUsed.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getStatus', () => {
    it('should return "disconnected" when no active connection exists', async () => {
      const status = await manager.getStatus('conn-1');
      expect(status).toBe('disconnected');
    });

    it('should return "connected" when connection is active and ping succeeds', async () => {
      await manager.connect('conn-1');

      const status = await manager.getStatus('conn-1');
      expect(status).toBe('connected');
    });

    it('should return "disconnected" when ping fails on active connection', async () => {
      await manager.connect('conn-1');

      // Make ping fail
      mockMysqlPing.mockRejectedValueOnce(new Error('Connection lost'));

      const status = await manager.getStatus('conn-1');
      expect(status).toBe('disconnected');
    });

    it('should return "connected" for PostgreSQL when query succeeds', async () => {
      const pgRow = { ...mockConnectionRow, db_type: 'postgresql', port: 5432 };
      mockGet.mockReturnValue(pgRow);

      await manager.connect('conn-1');

      const status = await manager.getStatus('conn-1');
      expect(status).toBe('connected');
      expect(mockPgQuery).toHaveBeenCalledWith('SELECT 1');
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all active connections', async () => {
      // Connect first connection
      await manager.connect('conn-1');

      // Set up second connection
      const row2 = { ...mockConnectionRow, id: 'conn-2' };
      mockGet.mockReturnValue(row2);

      await manager.connect('conn-2');

      expect(manager.getConnection('conn-1')).toBeDefined();
      expect(manager.getConnection('conn-2')).toBeDefined();

      await manager.disconnectAll();

      expect(manager.getConnection('conn-1')).toBeUndefined();
      expect(manager.getConnection('conn-2')).toBeUndefined();
    });

    it('should be safe to call when no connections exist', async () => {
      await expect(manager.disconnectAll()).resolves.toBeUndefined();
    });
  });
});
