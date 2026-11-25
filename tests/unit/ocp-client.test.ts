import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockHttpsRequest = vi.fn();
const mockGetOcpClusterRow = vi.fn();
const mockDecryptClusterSecret = vi.fn();
const mockDecryptClusterCachedToken = vi.fn();
const mockCacheClusterOAuthToken = vi.fn();
const mockClearClusterOAuthToken = vi.fn();

vi.mock('https', () => ({
  default: {
    request: (...args: any[]) => mockHttpsRequest(...args),
  },
  request: (...args: any[]) => mockHttpsRequest(...args),
}));

vi.mock('@/lib/ocp/ocp-manager', () => ({
  getOcpClusterRow: (...args: any[]) => mockGetOcpClusterRow(...args),
  decryptClusterSecret: (...args: any[]) => mockDecryptClusterSecret(...args),
  decryptClusterCachedToken: (...args: any[]) => mockDecryptClusterCachedToken(...args),
  cacheClusterOAuthToken: (...args: any[]) => mockCacheClusterOAuthToken(...args),
  clearClusterOAuthToken: (...args: any[]) => mockClearClusterOAuthToken(...args),
}));

import {
  computePodStatus,
  decodeK8sExecFrame,
  executeClusterApi,
  getConfigMap,
  getPodLogs,
  listWorkloads,
  obtainOAuthToken,
  performResourceAction,
  updateConfigMap,
} from '@/lib/ocp/ocp-client';

function queueMockHttpResponses(
  responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body: string;
  }>
) {
  mockHttpsRequest.mockImplementation((_opts: any, cb: (res: any) => void) => {
    const next = responses.shift() || { status: 500, body: '{}' };
    const req = new EventEmitter() as any;
    req.setTimeout = vi.fn();
    req.write = vi.fn();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      const res = new EventEmitter() as any;
      res.statusCode = next.status;
      res.headers = next.headers || {};
      cb(res);
      process.nextTick(() => {
        if (next.body) res.emit('data', Buffer.from(next.body));
        res.emit('end');
      });
    });
    return req;
  });
}

describe('OCP Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('obtainOAuthToken', () => {
    it('discovers OAuth endpoint and extracts access_token from 302 Location', async () => {
      queueMockHttpResponses([
        {
          status: 200,
          body: JSON.stringify({
            authorization_endpoint:
              'https://oauth-openshift.apps.ocp-new-dev.bri.co.id/oauth/authorize',
          }),
        },
        {
          status: 302,
          headers: {
            location:
              'https://oauth-openshift.apps.ocp-new-dev.bri.co.id/oauth/token/implicit#access_token=sha256~testtoken123&expires_in=86400&token_type=Bearer',
          },
          body: '',
        },
      ]);

      const result = await obtainOAuthToken(
        'https://api.ocp-new-dev.bri.co.id:6443',
        'brimo',
        'secret',
        true
      );

      expect(result).toEqual({
        accessToken: 'sha256~testtoken123',
        expiresIn: 86400,
      });
    });

    it('surfaces helpful message when cluster redirects to SSO/interactive login', async () => {
      queueMockHttpResponses([
        {
          status: 200,
          body: JSON.stringify({
            authorization_endpoint:
              'https://oauth-openshift.apps.ocp-new-dev.bri.co.id/oauth/authorize',
          }),
        },
        {
          status: 302,
          headers: {
            location: 'https://sso.bri.co.id/auth/realms/bri/protocol/openid-connect/auth',
          },
          body: '',
        },
      ]);

      await expect(
        obtainOAuthToken('https://api.ocp-new-dev.bri.co.id:6443', 'brimo', 'secret', true)
      ).rejects.toThrow('Bearer Token');
    });

    it('rejects 401 invalid credentials', async () => {
      queueMockHttpResponses([
        {
          status: 200,
          body: JSON.stringify({
            authorization_endpoint:
              'https://oauth-openshift.apps.ocp-new-dev.bri.co.id/oauth/authorize',
          }),
        },
        { status: 401, body: '' },
      ]);

      await expect(
        obtainOAuthToken('https://api.ocp-new-dev.bri.co.id:6443', 'brimo', 'wrong', true)
      ).rejects.toThrow('Invalid OpenShift username or password');
    });
  });

  describe('executeClusterApi', () => {
    it('refreshes OAuth token once on 401 and retries request', async () => {
      mockGetOcpClusterRow.mockReturnValue({
        id: 'c1',
        api_url: 'https://api.ocp-new-dev.bri.co.id:6443',
        auth_type: 'oauth_password',
        username: 'brimo',
        insecure_tls: 1,
        encrypted_token: 'enc-old',
        token_iv: 'iv',
        token_auth_tag: 'tag',
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      mockDecryptClusterCachedToken.mockReturnValue('sha256~expired');
      mockDecryptClusterSecret.mockReturnValue('brimo-pass');

      queueMockHttpResponses([
        { status: 401, body: JSON.stringify({ message: 'Unauthorized' }) },
        {
          status: 200,
          body: JSON.stringify({
            authorization_endpoint: 'https://oauth.example.com/oauth/authorize',
          }),
        },
        {
          status: 302,
          headers: {
            location: 'https://oauth.example.com/implicit#access_token=sha256~fresh&expires_in=3600',
          },
          body: '',
        },
        { status: 200, body: JSON.stringify({ items: [] }) },
      ]);

      const { response } = await executeClusterApi('c1', '/api/v1/namespaces');
      expect(response.status).toBe(200);
      expect(mockClearClusterOAuthToken).toHaveBeenCalledWith('c1');
      expect(mockCacheClusterOAuthToken).toHaveBeenCalledWith('c1', 'sha256~fresh', 3600);
    });
  });

  describe('computePodStatus & decodeK8sExecFrame', () => {
    it('detects CrashLoopBackOff and Terminating states', () => {
      expect(
        computePodStatus({
          metadata: { deletionTimestamp: '2026-01-01T00:00:00Z' },
          status: { phase: 'Running' },
        })
      ).toBe('Terminating');

      expect(
        computePodStatus({
          metadata: {},
          status: {
            phase: 'Running',
            containerStatuses: [
              { state: { waiting: { reason: 'CrashLoopBackOff' } } },
            ],
          },
        })
      ).toBe('CrashLoopBackOff');
    });

    it('decodes Kubernetes WebSocket channel frames', () => {
      const stdoutFrame = Buffer.concat([Buffer.from([1]), Buffer.from('hello world')]);
      expect(decodeK8sExecFrame(stdoutFrame)).toEqual({
        channel: 1,
        payload: 'hello world',
      });
      expect(decodeK8sExecFrame(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('getPodLogs', () => {
    it('sends Accept header compatible with Kubernetes API server negotiation', async () => {
      mockGetOcpClusterRow.mockReturnValue({
        id: 'c1',
        api_url: 'https://api.ocp-new-dev.bri.co.id:6443',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptClusterSecret.mockReturnValue('sha256~token');

      queueMockHttpResponses([
        { status: 200, body: '2026-11-25T03:00:00Z started pod\n' },
      ]);

      const logs = await getPodLogs('c1', 'brimo', 'api-pod', 'app', 100);
      expect(logs).toContain('started pod');

      const requestOptions = mockHttpsRequest.mock.calls[0][0];
      expect(requestOptions.headers.Accept).toContain('application/json');
    });
  });

  describe('listWorkloads & performResourceAction validation', () => {
    it('rejects invalid namespace names', async () => {
      await expect(listWorkloads('c1', '../kube-system')).rejects.toThrow(
        'Invalid namespace name'
      );
      await expect(
        performResourceAction('c1', {
          action: 'scale',
          namespace: 'brimo',
          kind: 'Deployment',
          name: 'app',
          replicas: 999,
        })
      ).rejects.toThrow('between 0 and 50');
    });

    it('includes configMaps in listWorkloads and degrades gracefully on 403', async () => {
      mockGetOcpClusterRow.mockReturnValue({
        id: 'c1',
        api_url: 'https://api.ocp-new-dev.bri.co.id:6443',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptClusterSecret.mockReturnValue('sha256~token');

      queueMockHttpResponses([
        { status: 200, body: JSON.stringify({ items: [] }) }, // pods
        { status: 200, body: JSON.stringify({ items: [] }) }, // deployments
        { status: 404, body: JSON.stringify({}) }, // dc
        { status: 200, body: JSON.stringify({ items: [] }) }, // services
        { status: 404, body: JSON.stringify({}) }, // routes
        { status: 403, body: JSON.stringify({ message: 'Forbidden' }) }, // configmaps
      ]);

      const res = await listWorkloads('c1', 'brimo');
      expect(res.configMaps).toEqual([]);
      expect(res.warnings).toContain('Unable to load ConfigMaps');
    });
  });

  describe('ConfigMap get & update', () => {
    it('fetches and updates a mutable ConfigMap using GET + PUT', async () => {
      mockGetOcpClusterRow.mockReturnValue({
        id: 'c1',
        api_url: 'https://api.ocp-new-dev.bri.co.id:6443',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptClusterSecret.mockReturnValue('sha256~token');

      queueMockHttpResponses([
        {
          status: 200,
          body: JSON.stringify({
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'app-config', namespace: 'brimo', resourceVersion: '10' },
            data: { KEY1: 'old', KEY2: 'remove' },
          }),
        },
      ]);

      const cm = await getConfigMap('c1', 'brimo', 'app-config');
      expect(cm.keyCount).toBe(2);
      expect(cm.data.KEY1).toBe('old');

      queueMockHttpResponses([
        {
          status: 200,
          body: JSON.stringify({
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'app-config', namespace: 'brimo', resourceVersion: '10' },
            data: { KEY1: 'old', KEY2: 'remove' },
          }),
        },
        {
          status: 200,
          body: JSON.stringify({
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'app-config', namespace: 'brimo', resourceVersion: '11' },
            data: { KEY1: 'updated', KEY3: 'added' },
          }),
        },
      ]);

      const updated = await updateConfigMap('c1', 'brimo', 'app-config', {
        KEY1: 'updated',
        KEY3: 'added',
      });
      expect(updated.data).toEqual({ KEY1: 'updated', KEY3: 'added' });
      expect(mockHttpsRequest.mock.calls[2][0].method).toBe('PUT');
    });

    it('rejects edits to immutable ConfigMaps and invalid keys', async () => {
      await expect(
        updateConfigMap('c1', 'brimo', 'app-config', { 'bad key': 'x' })
      ).rejects.toThrow('Invalid ConfigMap key');

      mockGetOcpClusterRow.mockReturnValue({
        id: 'c1',
        api_url: 'https://api.ocp-new-dev.bri.co.id:6443',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptClusterSecret.mockReturnValue('sha256~token');

      queueMockHttpResponses([
        {
          status: 200,
          body: JSON.stringify({
            metadata: { name: 'locked-cm', namespace: 'brimo' },
            immutable: true,
            data: { A: '1' },
          }),
        },
      ]);

      await expect(
        updateConfigMap('c1', 'brimo', 'locked-cm', { A: '2' })
      ).rejects.toThrow('immutable');
    });
  });
});
