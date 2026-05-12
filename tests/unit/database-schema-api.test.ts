import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock next-auth before importing routes
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

// Mock auth config
vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

// Mock the db module
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}));

// Mock the query executor
vi.mock('@/lib/db/query-executor', () => ({
  getQueryExecutor: vi.fn(),
}));

// Mock the database manager
vi.mock('@/lib/db/database-manager', () => ({
  getDatabaseManager: vi.fn(() => ({
    getConnection: vi.fn().mockReturnValue({ status: 'connected' }),
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { getServerSession } from 'next-auth';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { GET as getSchemaRoute } from '@/app/api/databases/[id]/schema/route';
import { GET as getTablesRoute } from '@/app/api/databases/[id]/schema/[db]/route';
import { GET as getTableStructureRoute } from '@/app/api/databases/[id]/schema/[db]/[table]/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);
const mockGetQueryExecutor = vi.mocked(getQueryExecutor);

function createRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

function createMockDb(row: any = { id: 'conn-1' }) {
  const returnValue = row;
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(returnValue),
    }),
  };
}

function createMockDbNotFound() {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(null),
    }),
  };
}

describe('Database Schema API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/databases/[id]/schema', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest('http://localhost/api/databases/conn-1/schema');
      const response = await getSchemaRoute(request as any, { params: { id: 'conn-1' } });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when connection does not exist', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDbNotFound() as any);

      const request = createRequest('http://localhost/api/databases/nonexistent/schema');
      const response = await getSchemaRoute(request as any, { params: { id: 'nonexistent' } });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Database connection not found');
    });

    it('should return list of databases on success', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getDatabases: vi.fn().mockResolvedValue(['mydb', 'testdb', 'information_schema']),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema');
      const response = await getSchemaRoute(request as any, { params: { id: 'conn-1' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.databases).toEqual(['mydb', 'testdb', 'information_schema']);
      expect(mockExecutor.getDatabases).toHaveBeenCalledWith('conn-1');
    });

    it('should handle "Access denied" errors gracefully', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getDatabases: vi.fn().mockRejectedValue(new Error('Access denied for user')),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema');
      const response = await getSchemaRoute(request as any, { params: { id: 'conn-1' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.databases).toEqual([]);
      expect(body.error).toContain('Access denied');
    });

    it('should return 500 for non-access-denied errors', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getDatabases: vi.fn().mockRejectedValue(new Error('Connection lost')),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema');
      const response = await getSchemaRoute(request as any, { params: { id: 'conn-1' } });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve databases');
    });
  });

  describe('GET /api/databases/[id]/schema/[db]', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb');
      const response = await getTablesRoute(request as any, { params: { id: 'conn-1', db: 'mydb' } });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when connection does not exist', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDbNotFound() as any);

      const request = createRequest('http://localhost/api/databases/nonexistent/schema/mydb');
      const response = await getTablesRoute(request as any, { params: { id: 'nonexistent', db: 'mydb' } });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Database connection not found');
    });

    it('should return list of tables on success', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getTables: vi.fn().mockResolvedValue(['users', 'orders', 'products']),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb');
      const response = await getTablesRoute(request as any, { params: { id: 'conn-1', db: 'mydb' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.database).toBe('mydb');
      expect(body.tables).toEqual(['users', 'orders', 'products']);
      expect(mockExecutor.getTables).toHaveBeenCalledWith('conn-1', 'mydb');
    });

    it('should handle "Access denied" errors gracefully', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getTables: vi.fn().mockRejectedValue(new Error('Access denied for user to database')),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/secretdb');
      const response = await getTablesRoute(request as any, { params: { id: 'conn-1', db: 'secretdb' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.database).toBe('secretdb');
      expect(body.tables).toEqual([]);
      expect(body.error).toContain('Access denied');
    });

    it('should return 500 for non-access-denied errors', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getTables: vi.fn().mockRejectedValue(new Error('Network timeout')),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb');
      const response = await getTablesRoute(request as any, { params: { id: 'conn-1', db: 'mydb' } });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve tables');
    });
  });

  describe('GET /api/databases/[id]/schema/[db]/[table]', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb/users');
      const response = await getTableStructureRoute(request as any, {
        params: { id: 'conn-1', db: 'mydb', table: 'users' },
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when connection does not exist', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDbNotFound() as any);

      const request = createRequest('http://localhost/api/databases/nonexistent/schema/mydb/users');
      const response = await getTableStructureRoute(request as any, {
        params: { id: 'nonexistent', db: 'mydb', table: 'users' },
      });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Database connection not found');
    });

    it('should return table structure on success', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockColumns = [
        { name: 'id', type: 'int', nullable: false, primaryKey: true, defaultValue: null },
        { name: 'name', type: 'varchar(255)', nullable: false, primaryKey: false, defaultValue: null },
        { name: 'email', type: 'varchar(255)', nullable: true, primaryKey: false, defaultValue: null },
        { name: 'created_at', type: 'datetime', nullable: false, primaryKey: false, defaultValue: 'CURRENT_TIMESTAMP' },
      ];

      const mockExecutor = {
        getTableStructure: vi.fn().mockResolvedValue(mockColumns),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb/users');
      const response = await getTableStructureRoute(request as any, {
        params: { id: 'conn-1', db: 'mydb', table: 'users' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.database).toBe('mydb');
      expect(body.table).toBe('users');
      expect(body.columns).toEqual(mockColumns);
      expect(mockExecutor.getTableStructure).toHaveBeenCalledWith('conn-1', 'mydb', 'users');
    });

    it('should handle "Access denied" errors gracefully', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getTableStructure: vi.fn().mockRejectedValue(new Error('Access denied for user to table')),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb/secret_table');
      const response = await getTableStructureRoute(request as any, {
        params: { id: 'conn-1', db: 'mydb', table: 'secret_table' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.database).toBe('mydb');
      expect(body.table).toBe('secret_table');
      expect(body.columns).toEqual([]);
      expect(body.error).toContain('Access denied');
    });

    it('should return 500 for non-access-denied errors', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockExecutor = {
        getTableStructure: vi.fn().mockRejectedValue(new Error('Connection reset')),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb/users');
      const response = await getTableStructureRoute(request as any, {
        params: { id: 'conn-1', db: 'mydb', table: 'users' },
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve table structure');
    });

    it('should return column info with all fields populated', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockReturnValue(createMockDb() as any);

      const mockColumns = [
        { name: 'status', type: 'enum', nullable: false, primaryKey: false, defaultValue: "'active'" },
      ];

      const mockExecutor = {
        getTableStructure: vi.fn().mockResolvedValue(mockColumns),
      };
      mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

      const request = createRequest('http://localhost/api/databases/conn-1/schema/mydb/orders');
      const response = await getTableStructureRoute(request as any, {
        params: { id: 'conn-1', db: 'mydb', table: 'orders' },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.columns[0].name).toBe('status');
      expect(body.columns[0].type).toBe('enum');
      expect(body.columns[0].nullable).toBe(false);
      expect(body.columns[0].primaryKey).toBe(false);
      expect(body.columns[0].defaultValue).toBe("'active'");
    });
  });
});
