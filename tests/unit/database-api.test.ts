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

import { getServerSession } from 'next-auth';
import { getDb } from '@/lib/db';
import { encrypt } from '@/lib/crypto/credential-store';
import { GET, POST } from '@/app/api/databases/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetDb = vi.mocked(getDb);
const mockEncrypt = vi.mocked(encrypt);

function createMockDb(overrides: Record<string, any> = {}) {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn(),
      ...overrides,
    }),
  };
}

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/databases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Database API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/databases', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return list of database connections without passwords', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockRows = [
        {
          id: 'conn-1',
          vm_id: 'vm-1',
          vm_label: 'Production VM',
          db_type: 'mysql',
          host: 'localhost',
          port: 3306,
          db_username: 'root',
          label: 'Prod DB',
          created_at: '2024-01-01 00:00:00',
          updated_at: '2024-01-01 00:00:00',
        },
      ];

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue(mockRows),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('conn-1');
      expect(body[0].dbType).toBe('mysql');
      expect(body[0].host).toBe('localhost');
      expect(body[0].port).toBe(3306);
      expect(body[0].username).toBe('root');
      expect(body[0].label).toBe('Prod DB');
      expect(body[0].status).toBe('disconnected');
      // Ensure password is never returned
      expect(body[0].password).toBeUndefined();
      expect(body[0].encrypted_password).toBeUndefined();
      expect(body[0].encryptedPassword).toBeUndefined();
    });

    it('should return empty array when no connections exist', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual([]);
    });

    it('should return 500 when database query fails', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetDb.mockImplementation(() => { throw new Error('DB error'); });

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve database connections');
    });
  });

  describe('POST /api/databases', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid JSON body', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = new Request('http://localhost/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON body');
    });

    it('should return 400 when dbType is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('dbType');
    });

    it('should return 400 when dbType is invalid', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        dbType: 'oracle',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('dbType');
    });

    it('should return 400 when username is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        dbType: 'mysql',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('username');
    });

    it('should return 400 when password is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('password');
    });

    it('should return 400 when port is out of range (too high)', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
        port: 70000,
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when port is 0', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
        port: 0,
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when port is not an integer', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
        port: 3306.5,
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should successfully create a connection with default port for mysql', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'encrypted_pass',
        iv: 'test_iv',
        authTag: 'test_tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.dbType).toBe('mysql');
      expect(body.host).toBe('localhost');
      expect(body.port).toBe(3306);
      expect(body.username).toBe('root');
      expect(body.status).toBe('disconnected');
      // Password should never be in response
      expect(body.password).toBeUndefined();
      expect(body.encryptedPassword).toBeUndefined();
      // Verify encrypt was called with the password
      expect(mockEncrypt).toHaveBeenCalledWith('secret');
    });

    it('should use default port 5432 for postgresql', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'postgresql',
        username: 'postgres',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.port).toBe(5432);
    });

    it('should use default port 3306 for mariadb', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mariadb',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.port).toBe(3306);
    });

    it('should use custom port when provided', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
        port: 3307,
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.port).toBe(3307);
    });

    it('should use custom host when provided', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
        host: '10.0.0.5',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.host).toBe('10.0.0.5');
    });

    it('should default host to localhost when not provided', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.host).toBe('localhost');
    });

    it('should include label in response when provided', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
        label: 'Production MySQL',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.label).toBe('Production MySQL');
    });

    it('should return 500 when database insert fails', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn().mockImplementation(() => { throw new Error('Insert failed'); });
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to create database connection');
    });

    it('should sanitize inputs by trimming whitespace', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockEncrypt.mockReturnValue({
        ciphertext: 'enc',
        iv: 'iv',
        authTag: 'tag',
      });

      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      };
      mockGetDb.mockReturnValue(mockDb as any);

      const request = createRequest({
        dbType: 'mysql',
        username: '  root  ',
        password: 'secret',
        host: '  10.0.0.1  ',
        label: '  My Label  ',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.username).toBe('root');
      expect(body.host).toBe('10.0.0.1');
      expect(body.label).toBe('My Label');
    });
  });
});
