import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));
vi.mock('@/lib/auth/auth.config', () => ({ authOptions: {} }));
vi.mock('@/lib/ocp/ocp-manager', () => ({
  listOcpClusters: vi.fn(),
  createOcpCluster: vi.fn(),
  getOcpClusterPublic: vi.fn(),
  getOcpClusterRow: vi.fn(),
  decryptClusterSecret: vi.fn(),
  updateOcpCluster: vi.fn(),
  deleteOcpCluster: vi.fn(),
}));
vi.mock('@/lib/ocp/ocp-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ocp/ocp-client')>();
  return {
    ...actual,
    testRawClusterConnection: vi.fn(),
    testSavedClusterConnection: vi.fn(),
    listProjects: vi.fn(),
    listWorkloads: vi.fn(),
    getResourceDescribe: vi.fn(),
    performResourceAction: vi.fn(),
    getConfigMap: vi.fn(),
    updateConfigMap: vi.fn(),
  };
});

import { getServerSession } from 'next-auth';
import {
  createOcpCluster,
  deleteOcpCluster,
  getOcpClusterPublic,
  listOcpClusters,
  updateOcpCluster,
} from '@/lib/ocp/ocp-manager';
import {
  getConfigMap,
  getResourceDescribe,
  listWorkloads,
  performResourceAction,
  testRawClusterConnection,
  updateConfigMap,
} from '@/lib/ocp/ocp-client';

import { GET as listClusters, POST as addCluster } from '@/app/api/ocp/clusters/route';
import { POST as testCluster } from '@/app/api/ocp/clusters/test/route';
import {
  GET as getCluster,
  PUT as putCluster,
  DELETE as removeCluster,
} from '@/app/api/ocp/clusters/[id]/route';
import { GET as getResources } from '@/app/api/ocp/clusters/[id]/resources/route';
import { POST as postAction } from '@/app/api/ocp/clusters/[id]/actions/route';
import { GET as getDescribe } from '@/app/api/ocp/clusters/[id]/describe/route';
import {
  GET as getConfigMapRoute,
  PUT as putConfigMapRoute,
} from '@/app/api/ocp/clusters/[id]/configmaps/[name]/route';

const mockSession = vi.mocked(getServerSession);

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('OCP API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockSession.mockResolvedValue(null);
    const res = await listClusters();
    expect(res.status).toBe(401);
  });

  it('lists and creates OCP clusters', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });
    vi.mocked(listOcpClusters).mockReturnValue([]);
    const listRes = await listClusters();
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual([]);

    vi.mocked(createOcpCluster).mockReturnValue({
      id: 'c1',
      label: 'OCP New Dev',
      consoleUrl: 'https://console-openshift-console.apps.ocp-new-dev.bri.co.id',
      apiUrl: 'https://api.ocp-new-dev.bri.co.id:6443',
      authType: 'oauth_password',
      username: 'brimo',
      defaultNamespace: null,
      insecureTls: true,
      hasCachedToken: false,
      tokenExpiresAt: null,
      createdAt: '2026-11-25 10:00:00',
      updatedAt: '2026-11-25 10:00:00',
    });

    const createRes = await addCluster(
      jsonReq('http://localhost/api/ocp/clusters', 'POST', {
        label: 'OCP New Dev',
        consoleUrl: 'https://console-openshift-console.apps.ocp-new-dev.bri.co.id/',
        authType: 'oauth_password',
        username: 'brimo',
        secret: 'pw',
      })
    );
    expect(createRes.status).toBe(201);
  });

  it('validates create cluster payload', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });
    const badRes = await addCluster(
      jsonReq('http://localhost/api/ocp/clusters', 'POST', {
        label: 'Test',
        consoleUrl: 'ftp://invalid',
        authType: 'oauth_password',
        username: 'brimo',
        secret: 'pw',
      })
    );
    expect(badRes.status).toBe(400);
  });

  it('tests unsaved cluster connection', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });
    vi.mocked(testRawClusterConnection).mockResolvedValue({
      connected: true,
      username: 'brimo',
      serverVersion: 'v1.29.0',
      authType: 'oauth_password',
    });

    const res = await testCluster(
      jsonReq('http://localhost/api/ocp/clusters/test', 'POST', {
        consoleUrl: 'https://console-openshift-console.apps.ocp-new-dev.bri.co.id/',
        authType: 'oauth_password',
        username: 'brimo',
        secret: 'pw',
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).connected).toBe(true);
  });

  it('supports GET, PUT, DELETE on /api/ocp/clusters/[id]', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });

    vi.mocked(getOcpClusterPublic).mockReturnValue(null);
    const notFound = await getCluster(
      new NextRequest('http://localhost/api/ocp/clusters/missing'),
      { params: { id: 'missing' } }
    );
    expect(notFound.status).toBe(404);

    vi.mocked(updateOcpCluster).mockReturnValue({
      id: 'c1',
      label: 'Updated',
      consoleUrl: 'https://console.example.com',
      apiUrl: 'https://api.example.com:6443',
      authType: 'token',
      username: null,
      defaultNamespace: 'brimo',
      insecureTls: true,
      hasCachedToken: false,
      tokenExpiresAt: null,
      createdAt: '',
      updatedAt: '',
    });

    const putRes = await putCluster(
      jsonReq('http://localhost/api/ocp/clusters/c1', 'PUT', { label: 'Updated' }),
      { params: { id: 'c1' } }
    );
    expect(putRes.status).toBe(200);

    vi.mocked(deleteOcpCluster).mockReturnValue(true);
    const delRes = await removeCluster(
      new NextRequest('http://localhost/api/ocp/clusters/c1', { method: 'DELETE' }),
      { params: { id: 'c1' } }
    );
    expect(delRes.status).toBe(200);
  });

  it('requires namespace query parameter for resources and validates actions', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });

    const missingNs = await getResources(
      new NextRequest('http://localhost/api/ocp/clusters/c1/resources'),
      { params: { id: 'c1' } }
    );
    expect(missingNs.status).toBe(400);

    vi.mocked(listWorkloads).mockResolvedValue({
      namespace: 'brimo',
      pods: [],
      deployments: [],
      services: [],
      routes: [],
      configMaps: [],
    });
    const okResources = await getResources(
      new NextRequest('http://localhost/api/ocp/clusters/c1/resources?namespace=brimo'),
      { params: { id: 'c1' } }
    );
    expect(okResources.status).toBe(200);

    vi.mocked(performResourceAction).mockResolvedValue({ message: 'Scaled Deployment app to 2 replica(s)' });
    const actionRes = await postAction(
      jsonReq('http://localhost/api/ocp/clusters/c1/actions', 'POST', {
        action: 'scale',
        namespace: 'brimo',
        kind: 'Deployment',
        name: 'app',
        replicas: 2,
      }),
      { params: { id: 'c1' } }
    );
    expect(actionRes.status).toBe(200);
  });

  it('supports ConfigMap GET, PUT, and Describe endpoints', async () => {
    mockSession.mockResolvedValue({ user: { name: 'admin' } });

    vi.mocked(getConfigMap).mockResolvedValue({
      name: 'app-config',
      namespace: 'brimo',
      data: { ENV: 'dev' },
      binaryKeys: [],
      keyCount: 1,
      immutable: false,
      age: '2d',
    });

    const cmGetRes = await getConfigMapRoute(
      new NextRequest('http://localhost/api/ocp/clusters/c1/configmaps/app-config?namespace=brimo'),
      { params: { id: 'c1', name: 'app-config' } }
    );
    expect(cmGetRes.status).toBe(200);
    expect((await cmGetRes.json()).data.ENV).toBe('dev');

    vi.mocked(updateConfigMap).mockResolvedValue({
      name: 'app-config',
      namespace: 'brimo',
      data: { ENV: 'staging' },
      binaryKeys: [],
      keyCount: 1,
      immutable: false,
      age: '2d',
    });

    const cmPutRes = await putConfigMapRoute(
      jsonReq('http://localhost/api/ocp/clusters/c1/configmaps/app-config', 'PUT', {
        namespace: 'brimo',
        data: { ENV: 'staging' },
      }),
      { params: { id: 'c1', name: 'app-config' } }
    );
    expect(cmPutRes.status).toBe(200);
    expect((await cmPutRes.json()).data.ENV).toBe('staging');

    vi.mocked(getResourceDescribe).mockResolvedValue({
      kind: 'ConfigMap',
      name: 'app-config',
      namespace: 'brimo',
      resource: { metadata: { name: 'app-config' } },
      events: [],
    });

    const descRes = await getDescribe(
      new NextRequest('http://localhost/api/ocp/clusters/c1/describe?namespace=brimo&kind=ConfigMap&name=app-config'),
      { params: { id: 'c1' } }
    );
    expect(descRes.status).toBe(200);
    expect((await descRes.json()).kind).toBe('ConfigMap');
  });
});
