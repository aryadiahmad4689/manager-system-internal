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
  DatabaseCredentialError: class DatabaseCredentialError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DatabaseCredentialError';
    }
  },
  DatabaseServerError: class DatabaseServerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DatabaseServerError';
    }
  },
}));

import { getServerSession } from 'next-auth';
import { getDb } from '@/lib/db';
import {
  getDatabaseManager,
  DatabaseCredentialError,
  DatabaseServerError,
} from '@/lib/db/database-manager';
import { POST as connectPOST } from '@/app/api/databases/[id]/connect/route';
import { POST as disconnectPOST } from '@/app/api/databases/[id]/disconnect/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);
const mockGetDatabaseManager = vi.mocked(getDatabaseManager);

const TEST_ID = 'conn-123';

function createParams(id: string = TEST_ID) {
  return { params: { id } };
}

function createRequest(id: string = TEST_ID, path: string = 'connect'): any {
  return new Request(`http://localhost/api/databases/${id}/${path}`, {
    method: 'POST',
  });
}

describe('Database Connect API Route - POST /api/databases/[id]/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest();
    const response = await connectPOST(request, createParams());
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

    const request = createRequest('nonexistent');
    const response = await connectPOST(request, createParams('nonexistent'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Database connection not found');
  });

  it('should return success when connection is established', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockConnect = vi.fn().mockResolvedValue({
      id: TEST_ID,
      status: 'connected',
    });
    mockGetDatabaseManager.mockReturnValue({ connect: mockConnect } as any);

    const request = createRequest();
    const response = await connectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(TEST_ID);
    expect(body.status).toBe('connected');
    expect(body.message).toBe('Database connection established successfully');
    expect(mockConnect).toHaveBeenCalledWith(TEST_ID);
  });

  it('should return 401 when DatabaseCredentialError is thrown', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const credError = new DatabaseCredentialError(
      'Authentication failed: invalid username or password'
    );
    const mockConnect = vi.fn().mockRejectedValue(credError);
    mockGetDatabaseManager.mockReturnValue({ connect: mockConnect } as any);

    const request = createRequest();
    const response = await connectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication failed: invalid username or password');
  });

  it('should return 503 when DatabaseServerError is thrown', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const serverError = new DatabaseServerError(
      'Database server is not running or not accepting connections on the specified port'
    );
    const mockConnect = vi.fn().mockRejectedValue(serverError);
    mockGetDatabaseManager.mockReturnValue({ connect: mockConnect } as any);

    const request = createRequest();
    const response = await connectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe(
      'Database server is not running or not accepting connections on the specified port'
    );
  });

  it('should return 500 for unknown errors', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockConnect = vi.fn().mockRejectedValue(new Error('Unexpected error'));
    mockGetDatabaseManager.mockReturnValue({ connect: mockConnect } as any);

    const request = createRequest();
    const response = await connectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to connect to database');
  });

  it('should return 500 when getDb throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    mockGetDb.mockImplementation(() => {
      throw new Error('DB error');
    });

    const request = createRequest();
    const response = await connectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to connect to database');
  });
});

describe('Database Disconnect API Route - POST /api/databases/[id]/disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest(TEST_ID, 'disconnect');
    const response = await disconnectPOST(request, createParams());
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

    const request = createRequest('nonexistent', 'disconnect');
    const response = await disconnectPOST(request, createParams('nonexistent'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Database connection not found');
  });

  it('should return success when disconnection completes', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

    const request = createRequest(TEST_ID, 'disconnect');
    const response = await disconnectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(TEST_ID);
    expect(body.status).toBe('disconnected');
    expect(body.message).toBe('Database connection closed successfully');
    expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
  });

  it('should return 500 when disconnect throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: TEST_ID }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockDisconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'));
    mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

    const request = createRequest(TEST_ID, 'disconnect');
    const response = await disconnectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to disconnect from database');
  });

  it('should return 500 when getDb throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    mockGetDb.mockImplementation(() => {
      throw new Error('DB error');
    });

    const request = createRequest(TEST_ID, 'disconnect');
    const response = await disconnectPOST(request, createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to disconnect from database');
  });

  it('should pass the correct connection id to disconnect', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const customId = 'custom-conn-789';
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: customId }),
      }),
    };
    mockGetDb.mockReturnValue(mockDb as any);

    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

    const request = createRequest(customId, 'disconnect');
    const response = await disconnectPOST(request, createParams(customId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(customId);
    expect(mockDisconnect).toHaveBeenCalledWith(customId);
  });
});
