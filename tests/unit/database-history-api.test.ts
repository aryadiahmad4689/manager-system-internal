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

import { getServerSession } from 'next-auth';
import { getDb } from '@/lib/db';
import { GET } from '@/app/api/databases/[id]/history/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);

function createRequest(): Request {
  return new Request('http://localhost/api/databases/conn-1/history', {
    method: 'GET',
  });
}

function createMockDb(options: {
  connectionRow?: any;
  countResult?: { count: number };
  historyRows?: any[];
} = {}) {
  const {
    connectionRow = { id: 'conn-1' },
    countResult = { count: 5 },
    historyRows = [],
  } = options;

  const mockRun = vi.fn();
  const mockGet = vi.fn();
  const mockAll = vi.fn();

  // Track prepare calls to return different stubs based on SQL
  const prepare = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('SELECT id FROM database_connections')) {
      return { get: vi.fn().mockReturnValue(connectionRow) };
    }
    if (sql.includes('SELECT COUNT(*)')) {
      return { get: vi.fn().mockReturnValue(countResult) };
    }
    if (sql.includes('DELETE FROM query_history')) {
      return { run: mockRun };
    }
    if (sql.includes('SELECT id, query_text')) {
      return { all: vi.fn().mockReturnValue(historyRows) };
    }
    return { get: mockGet, run: mockRun, all: mockAll };
  });

  return { prepare, _mockRun: mockRun };
}

describe('GET /api/databases/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 404 when connection does not exist', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({ connectionRow: null });
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    const response = await GET(request as any, { params: { id: 'nonexistent' } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Database connection not found');
  });

  it('should return empty array when no history exists', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({
      connectionRow: { id: 'conn-1' },
      countResult: { count: 0 },
      historyRows: [],
    });
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    const response = await GET(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('should return history entries in camelCase format', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({
      connectionRow: { id: 'conn-1' },
      countResult: { count: 2 },
      historyRows: [
        {
          id: 'h1',
          query_text: 'SELECT * FROM users',
          database_name: 'mydb',
          status: 'success',
          error_message: null,
          execution_time_ms: 15,
          row_count: 10,
          executed_at: '2024-01-15T10:30:00.000Z',
        },
        {
          id: 'h2',
          query_text: 'SELECT * FROM invalid',
          database_name: 'mydb',
          status: 'error',
          error_message: 'Table not found',
          execution_time_ms: 5,
          row_count: null,
          executed_at: '2024-01-15T10:25:00.000Z',
        },
      ],
    });
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    const response = await GET(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      id: 'h1',
      queryText: 'SELECT * FROM users',
      databaseName: 'mydb',
      status: 'success',
      errorMessage: null,
      executionTimeMs: 15,
      rowCount: 10,
      executedAt: '2024-01-15T10:30:00.000Z',
    });
    expect(body[1]).toEqual({
      id: 'h2',
      queryText: 'SELECT * FROM invalid',
      databaseName: 'mydb',
      status: 'error',
      errorMessage: 'Table not found',
      executionTimeMs: 5,
      rowCount: null,
      executedAt: '2024-01-15T10:25:00.000Z',
    });
  });

  it('should not trigger deletion when count is 100 or less', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({
      connectionRow: { id: 'conn-1' },
      countResult: { count: 100 },
      historyRows: [],
    });
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    await GET(request as any, { params: { id: 'conn-1' } });

    // Verify DELETE was NOT called (prepare should not be called with DELETE SQL)
    const prepareCalls = mockDb.prepare.mock.calls;
    const deleteCall = prepareCalls.find((call: any) =>
      call[0].includes('DELETE FROM query_history')
    );
    expect(deleteCall).toBeUndefined();
  });

  it('should auto-delete oldest entries when count exceeds 100', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({
      connectionRow: { id: 'conn-1' },
      countResult: { count: 105 },
      historyRows: [],
    });
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    await GET(request as any, { params: { id: 'conn-1' } });

    // Verify DELETE was called
    const prepareCalls = mockDb.prepare.mock.calls;
    const deleteCall = prepareCalls.find((call: any) =>
      call[0].includes('DELETE FROM query_history')
    );
    expect(deleteCall).toBeDefined();
    expect(mockDb._mockRun).toHaveBeenCalledWith('conn-1', 'conn-1');
  });

  it('should return 500 when database query fails', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM database_connections')) {
        return { get: vi.fn().mockReturnValue({ id: 'conn-1' }) };
      }
      if (sql.includes('SELECT COUNT(*)')) {
        throw new Error('Database error');
      }
      return { get: vi.fn(), run: vi.fn(), all: vi.fn() };
    });

    mockGetDb.mockReturnValue({ prepare } as any);

    const request = createRequest();
    const response = await GET(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Database error');
  });

  it('should handle null database_name in history entries', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockDb = createMockDb({
      connectionRow: { id: 'conn-1' },
      countResult: { count: 1 },
      historyRows: [
        {
          id: 'h1',
          query_text: 'SELECT 1',
          database_name: null,
          status: 'success',
          error_message: null,
          execution_time_ms: 2,
          row_count: 1,
          executed_at: '2024-01-15T10:30:00.000Z',
        },
      ],
    });
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    const response = await GET(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0].databaseName).toBeNull();
  });
});
