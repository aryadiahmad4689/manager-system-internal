import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted to declare mock functions
const {
  mockGetConnection,
  mockMysqlQuery,
  mockPgQuery,
} = vi.hoisted(() => ({
  mockGetConnection: vi.fn(),
  mockMysqlQuery: vi.fn(),
  mockPgQuery: vi.fn(),
}));

// Mock database-manager
vi.mock('@/lib/db/database-manager', () => ({
  getDatabaseManager: vi.fn(() => ({
    getConnection: mockGetConnection,
  })),
}));

import { QueryExecutorImpl, createQueryExecutor } from '@/lib/db/query-executor';

describe('QueryExecutor', () => {
  let executor: QueryExecutorImpl;

  const makeMysqlConnection = (overrides: any = {}) => ({
    id: 'conn-1',
    config: { dbType: 'mysql', ...overrides.config },
    client: { query: mockMysqlQuery },
    status: 'connected',
    lastUsed: new Date(),
    ...overrides,
  });

  const makePostgresConnection = (overrides: any = {}) => ({
    id: 'conn-1',
    config: { dbType: 'postgresql', ...overrides.config },
    client: { query: mockPgQuery },
    status: 'connected',
    lastUsed: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    executor = createQueryExecutor();
  });

  describe('execute', () => {
    describe('multiple statement prevention', () => {
      it('should reject queries with multiple statements', async () => {
        mockGetConnection.mockReturnValue(makeMysqlConnection());

        await expect(
          executor.execute('conn-1', 'SELECT 1; DROP TABLE users')
        ).rejects.toThrow('Multiple statements are not allowed in a single execution');
      });

      it('should allow queries with trailing semicolon', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);
        mockMysqlQuery.mockResolvedValue([
          [{ id: 1 }],
          [{ name: 'id' }],
        ]);

        const result = await executor.execute('conn-1', 'SELECT 1;');
        expect(result.rows).toHaveLength(1);
      });

      it('should allow queries with semicolon followed by whitespace only', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);
        mockMysqlQuery.mockResolvedValue([
          [{ id: 1 }],
          [{ name: 'id' }],
        ]);

        const result = await executor.execute('conn-1', 'SELECT 1;   \n  ');
        expect(result.rows).toHaveLength(1);
      });
    });

    describe('MySQL/MariaDB SELECT queries', () => {
      it('should return columns and rows for SELECT query', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        const mockRows = [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ];
        const mockFields = [{ name: 'id' }, { name: 'name' }];
        mockMysqlQuery.mockResolvedValue([mockRows, mockFields]);

        const result = await executor.execute('conn-1', 'SELECT * FROM users');

        expect(result.columns).toEqual(['id', 'name']);
        expect(result.rows).toEqual(mockRows);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should truncate results exceeding 1000 rows', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        const mockRows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
        const mockFields = [{ name: 'id' }];
        mockMysqlQuery.mockResolvedValue([mockRows, mockFields]);

        const result = await executor.execute('conn-1', 'SELECT * FROM big_table');

        expect(result.rows).toHaveLength(1000);
        expect(result.rowCount).toBe(1000);
        expect(result.truncated).toBe(true);
        expect(result.totalRows).toBe(1500);
      });

      it('should not set totalRows when results are not truncated', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        const mockRows = [{ id: 1 }];
        const mockFields = [{ name: 'id' }];
        mockMysqlQuery.mockResolvedValue([mockRows, mockFields]);

        const result = await executor.execute('conn-1', 'SELECT * FROM users');

        expect(result.truncated).toBe(false);
        expect(result.totalRows).toBeUndefined();
      });

      it('should switch database with USE before executing query', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        mockMysqlQuery.mockResolvedValue([[{ id: 1 }], [{ name: 'id' }]]);

        await executor.execute('conn-1', 'SELECT 1', 'mydb');

        expect(mockMysqlQuery).toHaveBeenCalledWith('USE `mydb`');
      });
    });

    describe('MySQL/MariaDB INSERT/UPDATE/DELETE queries', () => {
      it('should return affected rows for INSERT', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        mockMysqlQuery.mockResolvedValue([
          { affectedRows: 1, insertId: 5 },
          undefined,
        ]);

        const result = await executor.execute('conn-1', 'INSERT INTO users (name) VALUES ("test")');

        expect(result.affectedRows).toBe(1);
        expect(result.columns).toEqual([]);
        expect(result.rows).toEqual([]);
        expect(result.truncated).toBe(false);
      });

      it('should return affected rows for UPDATE', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        mockMysqlQuery.mockResolvedValue([
          { affectedRows: 3 },
          undefined,
        ]);

        const result = await executor.execute('conn-1', 'UPDATE users SET active = 1');

        expect(result.affectedRows).toBe(3);
      });

      it('should return affected rows for DELETE', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        mockMysqlQuery.mockResolvedValue([
          { affectedRows: 2 },
          undefined,
        ]);

        const result = await executor.execute('conn-1', 'DELETE FROM users WHERE id > 5');

        expect(result.affectedRows).toBe(2);
      });
    });

    describe('PostgreSQL SELECT queries', () => {
      it('should return columns and rows for SELECT query', async () => {
        const conn = makePostgresConnection();
        mockGetConnection.mockReturnValue(conn);

        mockPgQuery.mockResolvedValue({
          rows: [{ id: 1, name: 'Alice' }],
          fields: [{ name: 'id' }, { name: 'name' }],
          rowCount: 1,
        });

        const result = await executor.execute('conn-1', 'SELECT * FROM users');

        expect(result.columns).toEqual(['id', 'name']);
        expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
        expect(result.rowCount).toBe(1);
        expect(result.truncated).toBe(false);
      });

      it('should truncate results exceeding 1000 rows', async () => {
        const conn = makePostgresConnection();
        mockGetConnection.mockReturnValue(conn);

        const mockRows = Array.from({ length: 1200 }, (_, i) => ({ id: i }));
        mockPgQuery.mockResolvedValue({
          rows: mockRows,
          fields: [{ name: 'id' }],
          rowCount: 1200,
        });

        const result = await executor.execute('conn-1', 'SELECT * FROM big_table');

        expect(result.rows).toHaveLength(1000);
        expect(result.truncated).toBe(true);
        expect(result.totalRows).toBe(1200);
      });
    });

    describe('PostgreSQL INSERT/UPDATE/DELETE queries', () => {
      it('should return affected rows for INSERT', async () => {
        const conn = makePostgresConnection();
        mockGetConnection.mockReturnValue(conn);

        mockPgQuery.mockResolvedValue({
          rows: [],
          fields: [],
          rowCount: 1,
        });

        const result = await executor.execute('conn-1', 'INSERT INTO users (name) VALUES ($1)');

        expect(result.affectedRows).toBe(1);
        expect(result.columns).toEqual([]);
        expect(result.rows).toEqual([]);
      });

      it('should return affected rows for DELETE', async () => {
        const conn = makePostgresConnection();
        mockGetConnection.mockReturnValue(conn);

        mockPgQuery.mockResolvedValue({
          rows: [],
          fields: [],
          rowCount: 5,
        });

        const result = await executor.execute('conn-1', 'DELETE FROM users WHERE active = false');

        expect(result.affectedRows).toBe(5);
      });
    });

    describe('error handling', () => {
      it('should throw when no active connection found', async () => {
        mockGetConnection.mockReturnValue(undefined);

        await expect(
          executor.execute('conn-1', 'SELECT 1')
        ).rejects.toThrow('No active connection found for: conn-1');
      });

      it('should throw when connection is not active', async () => {
        mockGetConnection.mockReturnValue({
          id: 'conn-1',
          config: { dbType: 'mysql' },
          client: { query: mockMysqlQuery },
          status: 'disconnected',
        });

        await expect(
          executor.execute('conn-1', 'SELECT 1')
        ).rejects.toThrow('Connection is not active: conn-1');
      });

      it('should pass through raw database errors without modification', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        const dbError = new Error("You have an error in your SQL syntax; check the manual near 'SELEC' at line 1");
        mockMysqlQuery.mockRejectedValue(dbError);

        await expect(
          executor.execute('conn-1', 'SELEC * FROM users')
        ).rejects.toThrow("You have an error in your SQL syntax; check the manual near 'SELEC' at line 1");
      });
    });

    describe('execution time tracking', () => {
      it('should measure execution time', async () => {
        const conn = makeMysqlConnection();
        mockGetConnection.mockReturnValue(conn);

        mockMysqlQuery.mockResolvedValue([[{ id: 1 }], [{ name: 'id' }]]);

        const result = await executor.execute('conn-1', 'SELECT 1');

        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
        expect(typeof result.executionTimeMs).toBe('number');
      });
    });

    describe('MariaDB support', () => {
      it('should use MySQL path for MariaDB connections', async () => {
        const conn = makeMysqlConnection({ config: { dbType: 'mariadb' } });
        mockGetConnection.mockReturnValue(conn);

        mockMysqlQuery.mockResolvedValue([[{ id: 1 }], [{ name: 'id' }]]);

        const result = await executor.execute('conn-1', 'SELECT 1');

        expect(result.rows).toHaveLength(1);
        expect(mockMysqlQuery).toHaveBeenCalledWith('SELECT 1');
      });
    });
  });

  describe('getDatabases', () => {
    it('should return databases for MySQL using SHOW DATABASES', async () => {
      const conn = makeMysqlConnection();
      mockGetConnection.mockReturnValue(conn);

      mockMysqlQuery.mockResolvedValue([
        [{ Database: 'mysql' }, { Database: 'test' }, { Database: 'app_db' }],
        [],
      ]);

      const databases = await executor.getDatabases('conn-1');

      expect(databases).toEqual(['mysql', 'test', 'app_db']);
      expect(mockMysqlQuery).toHaveBeenCalledWith('SHOW DATABASES');
    });

    it('should return databases for PostgreSQL using pg_database', async () => {
      const conn = makePostgresConnection();
      mockGetConnection.mockReturnValue(conn);

      mockPgQuery.mockResolvedValue({
        rows: [{ datname: 'postgres' }, { datname: 'myapp' }],
      });

      const databases = await executor.getDatabases('conn-1');

      expect(databases).toEqual(['postgres', 'myapp']);
      expect(mockPgQuery).toHaveBeenCalledWith(
        'SELECT datname FROM pg_database WHERE datistemplate = false'
      );
    });
  });

  describe('getTables', () => {
    it('should return tables for MySQL using SHOW TABLES', async () => {
      const conn = makeMysqlConnection();
      mockGetConnection.mockReturnValue(conn);

      mockMysqlQuery.mockResolvedValue([
        [{ Tables_in_mydb: 'users' }, { Tables_in_mydb: 'posts' }],
        [],
      ]);

      const tables = await executor.getTables('conn-1', 'mydb');

      expect(tables).toEqual(['users', 'posts']);
      expect(mockMysqlQuery).toHaveBeenCalledWith('SHOW TABLES FROM `mydb`');
    });

    it('should return tables for PostgreSQL using pg_tables', async () => {
      const conn = makePostgresConnection();
      mockGetConnection.mockReturnValue(conn);

      mockPgQuery.mockResolvedValue({
        rows: [{ tablename: 'users' }, { tablename: 'orders' }],
      });

      const tables = await executor.getTables('conn-1', 'mydb');

      expect(tables).toEqual(['users', 'orders']);
      expect(mockPgQuery).toHaveBeenCalledWith(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
      );
    });
  });

  describe('getTableStructure', () => {
    it('should return column info for MySQL using SHOW COLUMNS', async () => {
      const conn = makeMysqlConnection();
      mockGetConnection.mockReturnValue(conn);

      mockMysqlQuery.mockResolvedValue([
        [
          { Field: 'id', Type: 'int(11)', Null: 'NO', Key: 'PRI', Default: null },
          { Field: 'name', Type: 'varchar(255)', Null: 'YES', Key: '', Default: 'unnamed' },
          { Field: 'email', Type: 'varchar(255)', Null: 'NO', Key: 'UNI', Default: null },
        ],
        [],
      ]);

      const columns = await executor.getTableStructure('conn-1', 'mydb', 'users');

      expect(columns).toEqual([
        { name: 'id', type: 'int(11)', nullable: false, primaryKey: true, defaultValue: null },
        { name: 'name', type: 'varchar(255)', nullable: true, primaryKey: false, defaultValue: 'unnamed' },
        { name: 'email', type: 'varchar(255)', nullable: false, primaryKey: false, defaultValue: null },
      ]);
      expect(mockMysqlQuery).toHaveBeenCalledWith('SHOW COLUMNS FROM `users` FROM `mydb`');
    });

    it('should return column info for PostgreSQL with primary key detection', async () => {
      const conn = makePostgresConnection();
      mockGetConnection.mockReturnValue(conn);

      // First call: column info
      mockPgQuery.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')" },
          { column_name: 'name', data_type: 'character varying', is_nullable: 'YES', column_default: null },
        ],
      });

      // Second call: primary key info
      mockPgQuery.mockResolvedValueOnce({
        rows: [{ column_name: 'id' }],
      });

      const columns = await executor.getTableStructure('conn-1', 'mydb', 'users');

      expect(columns).toEqual([
        { name: 'id', type: 'integer', nullable: false, primaryKey: true, defaultValue: "nextval('users_id_seq')" },
        { name: 'name', type: 'character varying', nullable: true, primaryKey: false, defaultValue: null },
      ]);

      // Verify parameterized queries were used
      expect(mockPgQuery).toHaveBeenCalledWith(
        expect.stringContaining('information_schema.columns'),
        ['users']
      );
      expect(mockPgQuery).toHaveBeenCalledWith(
        expect.stringContaining('PRIMARY KEY'),
        ['users']
      );
    });
  });
});
