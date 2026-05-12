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

// Mock the credential store
vi.mock('@/lib/crypto/credential-store', () => ({
  encrypt: vi.fn(),
}));

// Mock the database manager
vi.mock('@/lib/db/database-manager', () => ({
  getDatabaseManager: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getDb } from '@/lib/db';
import { encrypt } from '@/lib/crypto/credential-store';
import { getDatabaseManager } from '@/lib/db/database-manager';
import { GET, PUT, DELETE } from '@/app/api/databases/[id]/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);
const mockEncrypt = vi.mocked(encrypt);
const mockGetDatabaseManager = vi.mocked(getDatabaseManager);

const TEST_ID = 'conn-123';

function createParams(id: string = TEST_ID) {
  return { params: { id } };
}

function createRequest(method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost/api/databases/${TEST_ID}`, init) as any;
}

// Type alias for convenience
type NextRequest = any;

const mockConnectionRow = {
  id: TEST_ID,
  vm_id: 'vm-1',
  vm_label: 'Production VM',
  db_type: 'mysql',
  host: 'localhost',
  port: 3306,
  db_username: 'root',
  label: 'Prod DB',
  created_at: '2024-01-01 00:00:00',
  updated_at: '2024-01-01 00:00:00',
};

describe('Database [id] API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/databases/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest('GET');
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

      const request = createRequest('GET');
      const response = await GET(request, createParams('nonexistent'));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Database connection not found');
    });

    it('should return connection details without password', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(mockConnectionRow),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('GET');
      const response = await GET(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe(TEST_ID);
      expect(body.dbType).toBe('mysql');
      expect(body.host).toBe('localhost');
      expect(body.port).toBe(3306);
      expect(body.username).toBe('root');
      expect(body.label).toBe('Prod DB');
      expect(body.status).toBe('disconnected');
      expect(body.createdAt).toBe('2024-01-01 00:00:00');
      expect(body.updatedAt).toBe('2024-01-01 00:00:00');
      // Password should never be returned
      expect(body.password).toBeUndefined();
      expect(body.encrypted_password).toBeUndefined();
      expect(body.encryptedPassword).toBeUndefined();
    });

    it('should return 500 when database query fails', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockImplementation(() => { throw new Error('DB error'); });

      const request = createRequest('GET');
      const response = await GET(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve database connection');
    });
  });

  describe('PUT /api/databases/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest('PUT', { label: 'New Label' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid JSON body', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = new Request(`http://localhost/api/databases/${TEST_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const response = await PUT(request as any, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON body');
    });

    it('should return 404 when connection does not exist', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { label: 'New Label' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Database connection not found');
    });

    it('should return 400 when dbType is invalid', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { dbType: 'oracle' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('dbType');
    });

    it('should return 400 when port is out of range', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { port: 70000 });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when port is 0', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { port: 0 });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when port is not an integer', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { port: 3306.5 });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when host is empty string', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { host: '   ' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('host');
    });

    it('should return 400 when username is empty string', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { username: '' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('username');
    });

    it('should return 400 when password is empty string', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { password: '  ' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('password');
    });

    it('should return 400 when no valid fields to update', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: TEST_ID }),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('PUT', { unknownField: 'value' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('No valid fields to update');
    });

    it('should update label without disconnecting (non-config change)', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID }) // existing check
        .mockReturnValueOnce({ ...mockConnectionRow, label: 'New Label' }); // fetch updated

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn();
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { label: 'New Label' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.label).toBe('New Label');
      // Should NOT disconnect since label is not a connection config field
      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it('should disconnect active connection when host changes', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID }) // existing check
        .mockReturnValueOnce({ ...mockConnectionRow, host: '10.0.0.5' }); // fetch updated

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { host: '10.0.0.5' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.host).toBe('10.0.0.5');
      expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it('should disconnect active connection when port changes', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID })
        .mockReturnValueOnce({ ...mockConnectionRow, port: 3307 });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { port: 3307 });
      const response = await PUT(request, createParams());

      expect(response.status).toBe(200);
      expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it('should disconnect active connection when username changes', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID })
        .mockReturnValueOnce({ ...mockConnectionRow, db_username: 'newuser' });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { username: 'newuser' });
      const response = await PUT(request, createParams());

      expect(response.status).toBe(200);
      expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it('should re-encrypt password when provided and disconnect', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'new_encrypted',
        iv: 'new_iv',
        authTag: 'new_tag',
      });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID })
        .mockReturnValueOnce(mockConnectionRow);

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { password: 'newpassword' });
      const response = await PUT(request, createParams());

      expect(response.status).toBe(200);
      expect(mockEncrypt).toHaveBeenCalledWith('newpassword');
      expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it('should disconnect active connection when dbType changes', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID })
        .mockReturnValueOnce({ ...mockConnectionRow, db_type: 'postgresql' });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { dbType: 'postgresql' });
      const response = await PUT(request, createParams());

      expect(response.status).toBe(200);
      expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
    });

    it('should handle disconnect errors gracefully during update', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: TEST_ID })
        .mockReturnValueOnce({ ...mockConnectionRow, host: '10.0.0.5' });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockRejectedValue(new Error('Not connected'));
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { host: '10.0.0.5' });
      const response = await PUT(request, createParams());

      // Should still succeed even if disconnect fails
      expect(response.status).toBe(200);
    });

    it('should return 500 when database update fails', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockGet = vi.fn().mockReturnValue({ id: TEST_ID });
      const mockRun = vi.fn().mockImplementation(() => { throw new Error('Update failed'); });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('PUT', { host: '10.0.0.5' });
      const response = await PUT(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to update database connection');
    });
  });

  describe('DELETE /api/databases/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest('DELETE');
      const response = await DELETE(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when connection does not exist', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
          run: vi.fn(),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest('DELETE');
      const response = await DELETE(request, createParams('nonexistent'));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Database connection not found');
    });

    it('should disconnect and delete connection successfully', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn().mockReturnValue({ id: TEST_ID });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('DELETE');
      const response = await DELETE(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toBe('Database connection deleted');
      expect(mockDisconnect).toHaveBeenCalledWith(TEST_ID);
      expect(mockRun).toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully during delete', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRun = vi.fn();
      const mockGet = vi.fn().mockReturnValue({ id: TEST_ID });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockRejectedValue(new Error('Not connected'));
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('DELETE');
      const response = await DELETE(request, createParams());
      const body = await response.json();

      // Should still succeed even if disconnect fails
      expect(response.status).toBe(200);
      expect(body.message).toBe('Database connection deleted');
    });

    it('should return 500 when database delete fails', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockGet = vi.fn().mockReturnValue({ id: TEST_ID });
      const mockRun = vi.fn().mockImplementation(() => { throw new Error('Delete failed'); });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: mockGet,
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      mockGetDatabaseManager.mockReturnValue({ disconnect: mockDisconnect } as any);

      const request = createRequest('DELETE');
      const response = await DELETE(request, createParams());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to delete database connection');
    });
  });
});
