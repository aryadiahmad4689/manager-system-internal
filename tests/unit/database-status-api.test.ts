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

// Mock the database manager
vi.mock('@/lib/db/database-manager', () => ({
  getDatabaseManager: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getDb } from '@/lib/db';
import { getDatabaseManager } from '@/lib/db/database-manager';
import { GET } from '@/app/api/databases/[id]/status/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);
const mockGetDatabaseManager = vi.mocked(getDatabaseManager);

const TEST_ID = 'conn-123';

function createParams(id: string = TEST_ID) {
  return { params: { id } };
}

function createRequest(): any {
  return new Request(`http://localhost/api/databases/${TEST_ID}/status`, {
    method: 'GET',
  });
}

describe('Database Status API Route - GET /api/databases/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 404 when connection does not exist', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const request = createRequest();
    const response = await GET(request, createParams('nonexistent'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Database connection not found');
  });

  it('should return "connected" status when database is reachable and connected', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockGetStatus = vi.fn().mockResolvedValue('connected');
    mockGetDatabaseManager.mockReturnValue({ getStatus: mockGetStatus } as any);

    const request = createRequest();
    const response = await GET(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(TEST_ID);
    expect(body.status).toBe('connected');
    expect(mockGetStatus).toHaveBeenCalledWith(TEST_ID);
  });

  it('should return "disconnected" status when database is not connected', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockGetStatus = vi.fn().mockResolvedValue('disconnected');
    mockGetDatabaseManager.mockReturnValue({ getStatus: mockGetStatus } as any);

    const request = createRequest();
    const response = await GET(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(TEST_ID);
    expect(body.status).toBe('disconnected');
    expect(mockGetStatus).toHaveBeenCalledWith(TEST_ID);
  });

  it('should return "unreachable" status when VM is offline', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockGetStatus = vi.fn().mockResolvedValue('unreachable');
    mockGetDatabaseManager.mockReturnValue({ getStatus: mockGetStatus } as any);

    const request = createRequest();
    const response = await GET(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(TEST_ID);
    expect(body.status).toBe('unreachable');
    expect(mockGetStatus).toHaveBeenCalledWith(TEST_ID);
  });

  it('should return 500 when getDb throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    mockGetDb.mockImplementation(() => { throw new Error('DB error'); });

    const request = createRequest();
    const response = await GET(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to retrieve database connection status');
  });

  it('should return 500 when getStatus throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockGetStatus = vi.fn().mockRejectedValue(new Error('Status check failed'));
    mockGetDatabaseManager.mockReturnValue({ getStatus: mockGetStatus } as any);

    const request = createRequest();
    const response = await GET(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to retrieve database connection status');
  });

  it('should pass the correct connection id to getStatus', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const customId = 'custom-conn-456';
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: customId }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockGetStatus = vi.fn().mockResolvedValue('connected');
    mockGetDatabaseManager.mockReturnValue({ getStatus: mockGetStatus } as any);

    const request = new Request(`http://localhost/api/databases/${customId}/status`, {
      method: 'GET',
    }) as any;
    const response = await GET(request, createParams(customId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(customId);
    expect(mockGetStatus).toHaveBeenCalledWith(customId);
  });
});
