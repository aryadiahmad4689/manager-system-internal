import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNativeHttpRequest = vi.fn();
const mockGetRow = vi.fn();
const mockDecryptSecret = vi.fn();
const mockDecryptClientSecret = vi.fn();
const mockDecryptCachedToken = vi.fn();
const mockCacheToken = vi.fn();
const mockClearToken = vi.fn();

vi.mock('@/lib/http/native-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/native-http')>();
  return {
    ...actual,
    nativeHttpRequest: (...args: any[]) => mockNativeHttpRequest(...args),
  };
});

vi.mock('@/lib/security/security-manager', () => ({
  getSecurityConnectionRow: (...args: any[]) => mockGetRow(...args),
  decryptSecuritySecret: (...args: any[]) => mockDecryptSecret(...args),
  decryptSecurityClientSecret: (...args: any[]) => mockDecryptClientSecret(...args),
  decryptSecurityCachedToken: (...args: any[]) => mockDecryptCachedToken(...args),
  cacheSecurityToken: (...args: any[]) => mockCacheToken(...args),
  clearSecurityToken: (...args: any[]) => mockClearToken(...args),
}));

import {
  getSecurityProjectDetails,
  listSecurityProjects,
  testRawSecurityConnection,
} from '@/lib/security/security-client';

describe('Security Provider Clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SonarQube Client', () => {
    it('logs in via /api/authentication/login cookie and fetches quality gate + issues', async () => {
      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 200,
          headers: {
            'set-cookie': ['JWT-SESSION=abc; Path=/; HttpOnly', 'XSRF-TOKEN=xsrf1'],
          },
          text: '',
          json: null,
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{"valid":true}',
          json: { valid: true },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '10.6.0',
          json: null,
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: { paging: { total: 12 } },
        });

      const testRes = await testRawSecurityConnection({
        provider: 'sonarqube',
        baseUrl: 'https://sonarqube-enterprise.bri.co.id/sessions/new',
        authType: 'password',
        username: 'brimo',
        secret: 'pw',
      });

      expect(testRes.connected).toBe(true);
      expect(testRes.version).toBe('10.6.0');
      expect(testRes.projectCount).toBe(12);

      mockGetRow.mockReturnValue({
        id: 'sq1',
        provider: 'sonarqube',
        base_url: 'https://sonarqube-enterprise.bri.co.id',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptSecret.mockReturnValue('squ_token');

      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: { projectStatus: { status: 'OK' } },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: {
            component: {
              name: 'BRImo API',
              measures: [
                { metric: 'bugs', value: '0' },
                { metric: 'vulnerabilities', value: '2' },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: {
            issues: [
              {
                key: 'iss-1',
                rule: 'go:S123',
                severity: 'CRITICAL',
                component: 'brimo:main.go',
                line: 42,
                message: 'SQL query should be parameterized',
                type: 'VULNERABILITY',
                status: 'OPEN',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: { hotspots: [] },
        });

      const details = await getSecurityProjectDetails('sq1', 'brimo');
      expect(details.qualityGateStatus).toBe('OK');
      expect(details.findings).toHaveLength(1);
      expect(details.findings[0].severity).toBe('HIGH');
      expect(details.findings[0].location).toBe('main.go:42');
    });

    it('uses non-admin components/search_projects and falls back to components/search?qualifiers=TRK', async () => {
      mockGetRow.mockReturnValue({
        id: 'sq2',
        provider: 'sonarqube',
        base_url: 'https://sonarqube-enterprise.bri.co.id',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptSecret.mockReturnValue('squ_token');

      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 403,
          headers: {},
          text: '{"errors":[{"msg":"Insufficient privileges"}]}',
          json: { errors: [{ msg: 'Insufficient privileges' }] },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: {
            components: [
              {
                key: 'com.bri:brimo',
                name: 'BRImo Service',
                qualifier: 'TRK',
              },
            ],
          },
        });

      const projects = await listSecurityProjects('sq2', 'brimo');
      expect(projects).toHaveLength(1);
      expect(projects[0].key).toBe('com.bri:brimo');
      expect(mockNativeHttpRequest.mock.calls[0][0]).toContain(
        '/api/components/search_projects'
      );
      expect(mockNativeHttpRequest.mock.calls[1][0]).toContain(
        '/api/components/search?qualifiers=TRK'
      );
    });

    it('auto-paginates SonarQube projects when total exceeds 500', async () => {
      mockGetRow.mockReturnValue({
        id: 'sq3',
        provider: 'sonarqube',
        base_url: 'https://sonarqube-enterprise.bri.co.id',
        auth_type: 'token',
        username: null,
        insecure_tls: 1,
      });
      mockDecryptSecret.mockReturnValue('squ_token');

      const page1 = Array.from({ length: 500 }, (_, i) => ({
        key: `proj-${i}`,
        name: `Project ${i}`,
        qualifier: 'TRK',
      }));
      const page2 = [
        { key: 'proj-500', name: 'Project 500', qualifier: 'TRK' },
      ];

      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: { paging: { pageIndex: 1, pageSize: 500, total: 501 }, components: page1 },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '{}',
          json: { paging: { pageIndex: 2, pageSize: 500, total: 501 }, components: page2 },
        });

      const projects = await listSecurityProjects('sq3');
      expect(projects).toHaveLength(501);
      expect(projects[500].key).toBe('proj-500');
    });
  });

  describe('Checkmarx CxSAST Client', () => {
    it('falls back to sast_rest_api scope and lists projects + scan statistics', async () => {
      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 400,
          headers: {},
          text: '',
          json: { error: 'invalid_scope' },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '',
          json: { access_token: 'sast-jwt', expires_in: 3600 },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '',
          json: [{ id: 101, name: 'brimo-backend', isPublic: true }],
        });

      const testRes = await testRawSecurityConnection({
        provider: 'cxsast',
        baseUrl: 'https://sast.bri.co.id/CxWebClient/Projects.aspx',
        authType: 'password',
        username: 'SAP',
        secret: 'pw',
      });

      expect(testRes.connected).toBe(true);
      expect(testRes.projectCount).toBe(1);

      mockGetRow.mockReturnValue({
        id: 'sast1',
        provider: 'cxsast',
        base_url: 'https://sast.bri.co.id',
        auth_type: 'password',
        username: 'SAP',
        insecure_tls: 1,
        encrypted_token: 'enc',
        token_iv: 'iv',
        token_auth_tag: 'tag',
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      mockDecryptCachedToken.mockReturnValue('sast-jwt');

      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '',
          json: [{ id: 55, status: { name: 'Finished' }, dateAndTime: { finishedOn: '2026-11-25T01:00:00Z' } }],
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '',
          json: { highSeverity: 3, mediumSeverity: 7, lowSeverity: 10, infoSeverity: 1 },
        })
        .mockResolvedValueOnce({
          status: 403,
          headers: {},
          text: '',
          json: {},
        });

      const details = await getSecurityProjectDetails('sast1', '101', 'brimo-backend');
      expect(details.metrics[0].value).toBe(3);
      expect(details.notes?.[0]).toContain('OData');
    });
  });

  describe('Checkmarx SCA Client', () => {
    it('authenticates with Tenant acr_values and lists projects + CVEs', async () => {
      mockGetRow.mockReturnValue({
        id: 'sca1',
        provider: 'cxsca',
        base_url: 'https://eu.sca.checkmarx.net',
        auth_type: 'password',
        tenant_account: 'bri',
        username: 'sap',
        insecure_tls: 1,
      });
      mockDecryptSecret.mockReturnValue('sca-pass');

      mockNativeHttpRequest
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '',
          json: { access_token: 'sca-jwt', expires_in: 3600 },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          text: '',
          json: [
            {
              id: 'proj-uuid',
              name: 'qcash-brimen-service',
              riskScore: 8.5,
              highVulnerabilityCount: 4,
              mediumVulnerabilityCount: 2,
            },
          ],
        });

      const projects = await listSecurityProjects('sca1', 'brimen');
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('qcash-brimen-service');
      expect(projects[0].statusTone).toBe('danger');
      expect(mockCacheToken).toHaveBeenCalledWith('sca1', 'sca-jwt', 3600);
    });
  });
});
