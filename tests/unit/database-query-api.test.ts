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
import { POST } from '@/app/api/databases/[id]/query/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);
const mockGetQueryExecutor = vi.mocked(getQueryExecutor);

function createRequest(body: any): Request {
  return new Request('http://localhost/api/databases/conn-1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createInvalidRequest(): Request {
  return new Request('http://localhost/api/databases/conn-1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
}

function createMockDb(row: any = { id: 'conn-1' }) {
  const mockRun = vi.fn();
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(row),
      run: mockRun,
    }),
    _mockRun: mockRun,
  };
}

describe('POST /api/databases/[id]/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest({ sql: 'SELECT 1' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 400 when request body is invalid JSON', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createInvalidRequest();
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
  });

  it('should return 400 when sql field is missing', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createRequest({ database: 'mydb' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('SQL query is required');
  });

  it('should return 400 when sql field is empty string', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createRequest({ sql: '   ' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('SQL query is required');
  });

  it('should return 404 when connection does not exist', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb(null);
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest({ sql: 'SELECT 1' });
    const response = await POST(request as any, { params: { id: 'nonexistent' } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Database connection not found');
  });

  it('should execute query and return results on success', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockResult = {
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      rowCount: 2,
      truncated: false,
      executionTimeMs: 15,
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(mockResult),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: 'SELECT * FROM users', database: 'mydb' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.columns).toEqual(['id', 'name']);
    expect(body.rows).toEqual([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
    expect(body.rowCount).toBe(2);
    expect(body.truncated).toBe(false);
    expect(mockExecutor.execute).toHaveBeenCalledWith('conn-1', 'SELECT * FROM users', 'mydb');
  });

  it('should save successful query to history', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockResult = {
      columns: ['id'],
      rows: [{ id: 1 }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 10,
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(mockResult),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: 'SELECT id FROM users', database: 'testdb' });
    await POST(request as any, { params: { id: 'conn-1' } });

    // Verify history was saved - the second prepare call is for the INSERT
    const prepareCalls = mockDb.prepare.mock.calls;
    const insertCall = prepareCalls.find((call: any) =>
      call[0].includes('INSERT INTO query_history')
    );
    expect(insertCall).toBeDefined();

    // Verify the run was called with correct params
    expect(mockDb._mockRun).toHaveBeenCalledWith(
      'conn-1',
      'testdb',
      'SELECT id FROM users',
      expect.any(Number),
      1
    );
  });

  it('should save failed query to history with error message', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('Syntax error near SELECT')),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: 'SELEC * FROM users', database: 'mydb' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Syntax error near SELECT');

    // Verify error history was saved
    const prepareCalls = mockDb.prepare.mock.calls;
    const insertCall = prepareCalls.find((call: any) =>
      call[0].includes('INSERT INTO query_history') && call[0].includes('error')
    );
    expect(insertCall).toBeDefined();

    expect(mockDb._mockRun).toHaveBeenCalledWith(
      'conn-1',
      'mydb',
      'SELEC * FROM users',
      'Syntax error near SELECT',
      expect.any(Number)
    );
  });

  it('should return truncated results when rows exceed limit', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockResult = {
      columns: ['id'],
      rows: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 })),
      rowCount: 1000,
      totalRows: 5000,
      truncated: true,
      executionTimeMs: 200,
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(mockResult),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: 'SELECT * FROM big_table' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.truncated).toBe(true);
    expect(body.totalRows).toBe(5000);
    expect(body.rowCount).toBe(1000);
  });

  it('should return affected rows for INSERT/UPDATE/DELETE', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affectedRows: 5,
      executionTimeMs: 30,
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(mockResult),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: "UPDATE users SET active = 1 WHERE role = 'admin'", database: 'mydb' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.affectedRows).toBe(5);
    expect(body.columns).toEqual([]);
    expect(body.rows).toEqual([]);
  });

  it('should handle query without database parameter', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockResult = {
      columns: ['1'],
      rows: [{ '1': 1 }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 5,
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue(mockResult),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: 'SELECT 1' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockExecutor.execute).toHaveBeenCalledWith('conn-1', 'SELECT 1', undefined);
  });

  it('should return raw database error messages without modification', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ id: 'conn-1' });
    mockGetDb.mockReturnValue(mockDb as any);

    const mockExecutor = {
      execute: vi.fn().mockRejectedValue(
        new Error("You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version")
      ),
    };
    mockGetQueryExecutor.mockReturnValue(mockExecutor as any);

    const request = createRequest({ sql: 'SELEC * FROM users' });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe(
      "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version"
    );
  });
});
