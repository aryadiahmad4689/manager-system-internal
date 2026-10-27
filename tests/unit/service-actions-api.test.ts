import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

vi.mock('@/lib/ssh/ssh-manager', () => ({
  getSSHManager: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { POST as POST_ACTION } from '@/app/api/vms/[id]/services/action/route';
import { GET as GET_LOGS } from '@/app/api/vms/[id]/services/logs/route';
import { GET as GET_RESOURCES } from '@/app/api/vms/[id]/resources/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetSSHManager = vi.mocked(getSSHManager);

describe('Service Actions & Logs API', () => {
  const mockExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSSHManager.mockReturnValue({
      executeCommand: mockExecute,
    } as any);
  });

  describe('POST /api/vms/:id/services/action', () => {
    it('should return 401 when unauthenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const req = new Request('http://localhost/api/vms/vm-1/services/action', {
        method: 'POST',
        body: JSON.stringify({ serviceName: 'nginx', action: 'restart' }),
      });
      const res = await POST_ACTION(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid action', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const req = new Request('http://localhost/api/vms/vm-1/services/action', {
        method: 'POST',
        body: JSON.stringify({ serviceName: 'nginx', action: 'destroy_all' }),
      });
      const res = await POST_ACTION(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid action');
    });

    it('should return 400 for malicious serviceName', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const req = new Request('http://localhost/api/vms/vm-1/services/action', {
        method: 'POST',
        body: JSON.stringify({ serviceName: 'nginx; rm -rf /', action: 'restart' }),
      });
      const res = await POST_ACTION(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid service name');
    });

    it('should execute restart and return success', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue('');

      const req = new Request('http://localhost/api/vms/vm-1/services/action', {
        method: 'POST',
        body: JSON.stringify({ serviceName: 'paradisev2.service', action: 'restart' }),
      });
      const res = await POST_ACTION(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.action).toBe('restart');
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe('GET /api/vms/:id/services/logs', () => {
    it('should return logs for unit', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue('line 1\nline 2');

      const req = new Request('http://localhost/api/vms/vm-1/services/logs?unit=paradisev2.service&lines=50');
      const res = await GET_LOGS(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.unit).toBe('paradisev2.service');
      expect(data.logs).toBe('line 1\nline 2');
    });

    it('should return 400 if unit is missing', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

      const req = new Request('http://localhost/api/vms/vm-1/services/logs');
      const res = await GET_LOGS(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/vms/:id/resources', () => {
    it('should return resources', async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
      mockExecute.mockResolvedValue(`
===UPTIME_START===
up 1 day
===UPTIME_END===
===RAM_START===
Mem: 8000000000 4000000000 2000000000 0 0 4000000000
===RAM_END===
===DISK_START===
Filesystem 1B-blocks Used Available Use% Mounted on
/dev/sda1 1000 400 600 40% /
===DISK_END===
===CPU_START===
%Cpu(s): 5.0 us, 5.0 sy, 0.0 ni, 90.0 id
===CPU_END===
`);

      const req = new Request('http://localhost/api/vms/vm-1/resources');
      const res = await GET_RESOURCES(req, { params: { id: 'vm-1' } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.uptime).toBe('up 1 day');
      expect(data.cpuPercent).toBe(10);
    });
  });
});
