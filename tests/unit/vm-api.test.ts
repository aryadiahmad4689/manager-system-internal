import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock next-auth before importing routes
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

// Mock the vm-manager module
vi.mock('@/lib/vm/vm-manager', () => ({
  listVMs: vi.fn(),
  addVM: vi.fn(),
  getVMStatus: vi.fn(),
}));

// Mock auth config
vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';
import { listVMs, addVM, getVMStatus } from '@/lib/vm/vm-manager';
import { GET, POST } from '@/app/api/vms/route';
import { GET as GET_STATUS } from '@/app/api/vms/[id]/status/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockListVMs = vi.mocked(listVMs);
const mockAddVM = vi.mocked(addVM);
const mockGetVMStatus = vi.mocked(getVMStatus);

describe('VM API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/vms', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return list of VMs when authenticated', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const mockVMs = [
        {
          id: 'vm-1',
          label: 'Test VM',
          host: '192.168.1.1',
          port: 22,
          username: 'root',
          encryptedPassword: 'enc',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];
      mockListVMs.mockResolvedValue(mockVMs);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].label).toBe('Test VM');
    });

    it('should return 500 when listVMs throws', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockListVMs.mockRejectedValue(new Error('DB error'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve VM list');
    });
  });

  describe('POST /api/vms', () => {
    function createRequest(body: unknown): Request {
      return new Request('http://localhost/api/vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid JSON body', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = new Request('http://localhost/api/vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON body');
    });

    it('should return 400 when label is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ host: '1.2.3.4', username: 'root', password: 'pass' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('label');
    });

    it('should return 400 when label is empty string', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: '  ', host: '1.2.3.4', username: 'root', password: 'pass' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('label');
    });

    it('should return 400 when host is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: 'VM', username: 'root', password: 'pass' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('host');
    });

    it('should return 400 when username is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', password: 'pass' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('username');
    });

    it('should return 400 when password is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('password');
    });

    it('should return 400 when port is out of range', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass', port: 70000 });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when port is 0', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass', port: 0 });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should return 400 when port is not an integer', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass', port: 22.5 });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('port');
    });

    it('should successfully add a VM with valid data', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      const mockVM = {
        id: 'new-vm-id',
        label: 'Production',
        host: '172.18.139.186',
        port: 22,
        username: 'root',
        encryptedPassword: 'encrypted',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      mockAddVM.mockResolvedValue(mockVM);

      const request = createRequest({
        label: 'Production',
        host: '172.18.139.186',
        username: 'root',
        password: 'secret',
      });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.label).toBe('Production');
      expect(mockAddVM).toHaveBeenCalledWith({
        label: 'Production',
        host: '172.18.139.186',
        port: 22,
        username: 'root',
        encryptedPassword: 'secret',
      });
    });

    it('should use default port 22 when port is not provided', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockAddVM.mockResolvedValue({
        id: 'id',
        label: 'VM',
        host: '1.2.3.4',
        port: 22,
        username: 'root',
        encryptedPassword: 'enc',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass' });
      await POST(request as any);

      expect(mockAddVM).toHaveBeenCalledWith(
        expect.objectContaining({ port: 22 })
      );
    });

    it('should use custom port when provided', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockAddVM.mockResolvedValue({
        id: 'id',
        label: 'VM',
        host: '1.2.3.4',
        port: 2222,
        username: 'root',
        encryptedPassword: 'enc',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass', port: 2222 });
      await POST(request as any);

      expect(mockAddVM).toHaveBeenCalledWith(
        expect.objectContaining({ port: 2222 })
      );
    });

    it('should sanitize inputs by trimming whitespace', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockAddVM.mockResolvedValue({
        id: 'id',
        label: 'VM',
        host: '1.2.3.4',
        port: 22,
        username: 'root',
        encryptedPassword: 'enc',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = createRequest({
        label: '  My VM  ',
        host: '  1.2.3.4  ',
        username: '  root  ',
        password: 'pass',
      });
      await POST(request as any);

      expect(mockAddVM).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'My VM',
          host: '1.2.3.4',
          username: 'root',
        })
      );
    });

    it('should return 500 when addVM throws', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockAddVM.mockRejectedValue(new Error('Encryption failed'));

      const request = createRequest({ label: 'VM', host: '1.2.3.4', username: 'root', password: 'pass' });
      const response = await POST(request as any);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to add VM');
    });
  });

  describe('GET /api/vms/:id/status', () => {
    function createStatusParams(id: string) {
      return { params: { id } };
    }

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET_STATUS(
        new Request('http://localhost/api/vms/abc123/status'),
        createStatusParams('abc123')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return VM status when authenticated', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetVMStatus.mockResolvedValue({
        vmId: 'abc123def456abc1',
        status: 'online',
        lastChecked: new Date('2024-01-01'),
        failCount: 0,
      });

      const response = await GET_STATUS(
        new Request('http://localhost/api/vms/abc123def456abc1/status'),
        createStatusParams('abc123def456abc1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.vmId).toBe('abc123def456abc1');
      expect(body.status).toBe('online');
    });

    it('should return 404 when VM is not found', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetVMStatus.mockRejectedValue(new Error('VM status not found for id: nonexistent'));

      const response = await GET_STATUS(
        new Request('http://localhost/api/vms/abcdef1234567890/status'),
        createStatusParams('abcdef1234567890')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('VM not found');
    });

    it('should return 400 for invalid id format', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const response = await GET_STATUS(
        new Request('http://localhost/api/vms/invalid!@#/status'),
        createStatusParams('invalid!@#')
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid VM id');
    });

    it('should return 500 for unexpected errors', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockGetVMStatus.mockRejectedValue(new Error('Database connection lost'));

      const response = await GET_STATUS(
        new Request('http://localhost/api/vms/abcdef1234567890/status'),
        createStatusParams('abcdef1234567890')
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to retrieve VM status');
    });
  });
});
