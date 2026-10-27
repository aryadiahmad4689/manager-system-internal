import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock next-auth before importing routes
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

// Mock the service-detector module
vi.mock('@/lib/services/service-detector', () => ({
  getServiceDetector: vi.fn(),
}));

// Mock auth config
vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';
import { getServiceDetector } from '@/lib/services/service-detector';
import { GET } from '@/app/api/vms/[id]/services/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetServiceDetector = vi.mocked(getServiceDetector);

describe('Services API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = new Request('http://localhost/api/vms/vm-1/services');
    const res = await GET(req, { params: { id: 'vm-1' } });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 400 when VM id format is invalid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const req = new Request('http://localhost/api/vms/invalid!id/services');
    const res = await GET(req, { params: { id: 'invalid!id' } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid VM id format');
  });

  it('should return 200 with detected services when authenticated', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const mockResult = {
      vmId: 'vm-1234',
      scannedAt: '2026-10-26T10:00:00Z',
      services: [
        {
          id: 'listen-8080',
          name: 'beedle-epay',
          type: 'listening' as const,
          status: 'running',
          ports: ['8080'],
          workingDir: '/home/ubuntu/apps/beedle-epay',
          execPath: '/home/ubuntu/apps/beedle-epay/bin/app',
        },
      ],
    };

    mockGetServiceDetector.mockReturnValue({
      detectServices: vi.fn().mockResolvedValue(mockResult),
    } as any);

    const req = new Request('http://localhost/api/vms/vm-1234/services');
    const res = await GET(req, { params: { id: 'vm-1234' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.vmId).toBe('vm-1234');
    expect(body.services.length).toBe(1);
    expect(body.services[0].name).toBe('beedle-epay');
    expect(body.services[0].workingDir).toBe('/home/ubuntu/apps/beedle-epay');
  });

  it('should return 500 when service detector throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    mockGetServiceDetector.mockReturnValue({
      detectServices: vi.fn().mockRejectedValue(new Error('Connection timed out')),
    } as any);

    const req = new Request('http://localhost/api/vms/vm-1234/services');
    const res = await GET(req, { params: { id: 'vm-1234' } });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });
});
