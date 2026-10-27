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
import { POST } from '@/app/api/vms/[id]/services/test-port/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetSSHManager = vi.mocked(getSSHManager);

describe('Port Tester API', () => {
  const mockExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSSHManager.mockReturnValue({
      executeCommand: mockExecute,
    } as any);
  });

  it('should return 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = new Request('http://localhost/api/vms/vm-1/services/test-port', {
      method: 'POST',
      body: JSON.stringify({ port: 4045 }),
    });
    const res = await POST(req, { params: { id: 'vm-1' } });
    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid port', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const req = new Request('http://localhost/api/vms/vm-1/services/test-port', {
      method: 'POST',
      body: JSON.stringify({ port: 'not-a-port' }),
    });
    const res = await POST(req, { params: { id: 'vm-1' } });
    expect(res.status).toBe(400);
  });

  it('should return 200 with test result on HTTP 200', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    mockExecute.mockResolvedValue('200|0.015');

    const req = new Request('http://localhost/api/vms/vm-1/services/test-port', {
      method: 'POST',
      body: JSON.stringify({ port: 4045, path: '/health' }),
    });
    const res = await POST(req, { params: { id: 'vm-1' } });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.port).toBe(4045);
    expect(data.reachable).toBe(true);
    expect(data.httpCode).toBe(200);
    expect(data.responseTimeMs).toBe(15);
    expect(data.status).toBe('200 OK');
  });

  it('should handle unreachable port (curl returns 000)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    mockExecute.mockResolvedValue('000|0');

    const req = new Request('http://localhost/api/vms/vm-1/services/test-port', {
      method: 'POST',
      body: JSON.stringify({ port: 9999 }),
    });
    const res = await POST(req, { params: { id: 'vm-1' } });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.reachable).toBe(false);
    expect(data.httpCode).toBe(0);
    expect(data.status).toContain('Connection Refused');
  });
});
