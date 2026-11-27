import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));
vi.mock('@/lib/auth/auth.config', () => ({ authOptions: {} }));
vi.mock('@/lib/security/security-manager', () => ({
  listSecurityConnections: vi.fn(),
  createSecurityConnection: vi.fn(),
  getSecurityConnectionPublic: vi.fn(),
  getSecurityConnectionRow: vi.fn(),
  decryptSecuritySecret: vi.fn(),
  decryptSecurityClientSecret: vi.fn(),
  updateSecurityConnection: vi.fn(),
  deleteSecurityConnection: vi.fn(),
}));
vi.mock('@/lib/security/security-client', () => ({
  testRawSecurityConnection: vi.fn(),
  testSavedSecurityConnection: vi.fn(),
  listSecurityProjects: vi.fn(),
  getSecurityProjectDetails: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import {
  createSecurityConnection,
  deleteSecurityConnection,
  getSecurityConnectionPublic,
  listSecurityConnections,
} from '@/lib/security/security-manager';
import {
  getSecurityProjectDetails,
  listSecurityProjects,
  testRawSecurityConnection,
} from '@/lib/security/security-client';

import {
  GET as listConns,
  POST as createConn,
} from '@/app/api/security/connections/route';
import { POST as testConn } from '@/app/api/security/connections/test/route';
import {
  GET as getConn,
  DELETE as deleteConn,
} from '@/app/api/security/connections/[id]/route';
import { GET as getProjects } from '@/app/api/security/connections/[id]/projects/route';
import { GET as getDetails } from '@/app/api/security/connections/[id]/details/route';

const mockSession = vi.mocked(getServerSession);

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Security API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated access with 401', async () => {
    mockSession.mockResolvedValue(null);
    const res = await listConns();
    expect(res.status).toBe(401);
  });

  it('validates and creates security connections', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });
    vi.mocked(listSecurityConnections).mockReturnValue([]);
    expect((await listConns()).status).toBe(200);

    const badSca = await createConn(
      jsonReq('http://localhost/api/security/connections', 'POST', {
        provider: 'cxsca',
        label: 'SCA',
        baseUrl: 'https://eu.sca.checkmarx.net/',
        authType: 'password',
        username: 'sap',
        secret: 'pw',
      })
    );
    expect(badSca.status).toBe(400);

    vi.mocked(createSecurityConnection).mockReturnValue({
      id: 'sec1',
      provider: 'cxsca',
      label: 'Checkmarx SCA',
      baseUrl: 'https://eu.sca.checkmarx.net',
      authType: 'password',
      tenantAccount: 'bri',
      username: 'sap',
      clientId: null,
      hasClientSecret: false,
      insecureTls: true,
      hasCachedToken: false,
      tokenExpiresAt: null,
      createdAt: '',
      updatedAt: '',
    });

    const okRes = await createConn(
      jsonReq('http://localhost/api/security/connections', 'POST', {
        provider: 'cxsca',
        label: 'Checkmarx SCA',
        baseUrl: 'https://eu.sca.checkmarx.net/',
        authType: 'password',
        tenantAccount: 'bri',
        username: 'sap',
        secret: 'pw',
      })
    );
    expect(okRes.status).toBe(201);
  });

  it('tests connection and queries projects & details', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });

    vi.mocked(testRawSecurityConnection).mockResolvedValue({
      connected: true,
      provider: 'sonarqube',
      authType: 'password',
      version: '10.6.0',
    });

    const testRes = await testConn(
      jsonReq('http://localhost/api/security/connections/test', 'POST', {
        provider: 'sonarqube',
        baseUrl: 'https://sonarqube-enterprise.bri.co.id/',
        authType: 'password',
        username: 'brimo',
        secret: 'pw',
      })
    );
    expect(testRes.status).toBe(200);
    expect((await testRes.json()).connected).toBe(true);

    vi.mocked(getSecurityConnectionPublic).mockReturnValue(null);
    expect(
      (
        await getConn(
          new NextRequest('http://localhost/api/security/connections/missing'),
          { params: { id: 'missing' } }
        )
      ).status
    ).toBe(404);

    vi.mocked(deleteSecurityConnection).mockReturnValue(true);
    expect(
      (
        await deleteConn(
          new NextRequest('http://localhost/api/security/connections/sec1', {
            method: 'DELETE',
          }),
          { params: { id: 'sec1' } }
        )
      ).status
    ).toBe(200);

    vi.mocked(listSecurityProjects).mockResolvedValue([]);
    expect(
      (
        await getProjects(
          new NextRequest('http://localhost/api/security/connections/sec1/projects'),
          { params: { id: 'sec1' } }
        )
      ).status
    ).toBe(200);

    const missingKey = await getDetails(
      new NextRequest('http://localhost/api/security/connections/sec1/details'),
      { params: { id: 'sec1' } }
    );
    expect(missingKey.status).toBe(400);

    vi.mocked(getSecurityProjectDetails).mockResolvedValue({
      provider: 'sonarqube',
      projectId: 'brimo',
      projectKey: 'brimo',
      projectName: 'BRImo',
      metrics: [],
      scans: [],
      findings: [],
    });
    const okDetails = await getDetails(
      new NextRequest(
        'http://localhost/api/security/connections/sec1/details?projectKey=brimo'
      ),
      { params: { id: 'sec1' } }
    );
    expect(okDetails.status).toBe(200);
  });
});
