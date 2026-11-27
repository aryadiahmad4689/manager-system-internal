import { HttpClientError, nativeHttpRequest } from '@/lib/http/native-http';
import {
  cacheSecurityToken,
  clearSecurityToken,
  decryptSecurityCachedToken,
  decryptSecuritySecret,
  type SecurityConnectionRow,
} from '../security-manager';
import { deriveCxScaEndpoints } from '../security-urls';
import type {
  SecurityAuthType,
  SecurityFinding,
  SecurityMetricBadge,
  SecurityProjectDetails,
  SecurityProjectSummary,
  SecurityScanHistoryItem,
  SecurityTestResult,
} from '../types';

interface CxScaTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface CxScaProjectRaw {
  id: string;
  name: string;
  lastSuccessfulScanDate?: string;
  riskScore?: number;
  highVulnerabilityCount?: number;
  mediumVulnerabilityCount?: number;
  lowVulnerabilityCount?: number;
}

interface CxScaScanRaw {
  scanId?: string;
  id?: string;
  status?: { name?: string } | string;
  createdOn?: string;
  finishedOn?: string;
  riskScore?: number;
}

interface CxScaRiskSummaryRaw {
  riskScore?: number;
  totalPackages?: number;
  directPackages?: number;
  highVulnerabilityCount?: number;
  mediumVulnerabilityCount?: number;
  lowVulnerabilityCount?: number;
  totalVulnerabilityCount?: number;
}

interface CxScaVulnerabilityRaw {
  id?: string;
  cveName?: string;
  severity?: string;
  score?: number;
  packageId?: string;
  packageName?: string;
  packageVersion?: string;
  recommendedVersion?: string;
  description?: string;
}

function mapCxScaSeverity(sev?: string): SecurityFinding['severity'] {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    default:
      return 'INFO';
  }
}

async function obtainCxScaToken(
  portalBaseUrl: string,
  tenantAccount: string,
  username: string,
  password: string,
  insecureTls: boolean
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!tenantAccount || !username || !password) {
    throw new HttpClientError(
      'Account/Tenant, username, and password are required for Checkmarx SCA',
      400
    );
  }

  const { identityUrl } = deriveCxScaEndpoints(portalBaseUrl);
  const body = new URLSearchParams({
    username,
    password,
    acr_values: `Tenant:${tenantAccount}`,
    scope: 'sca_api',
    client_id: 'sca_resource_owner',
    grant_type: 'password',
  }).toString();

  const res = await nativeHttpRequest<CxScaTokenResponse>(
    `${identityUrl}/identity/connect/token`,
    {
      method: 'POST',
      insecureTls,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );

  if (res.status >= 200 && res.status < 300 && res.json?.access_token) {
    return {
      accessToken: res.json.access_token,
      expiresIn: Number(res.json.expires_in) || 3600,
    };
  }

  throw new HttpClientError(
    res.json?.error_description ||
      res.json?.error ||
      `Checkmarx SCA login failed (HTTP ${res.status})`,
    res.status >= 400 ? res.status : 401
  );
}

async function getSavedCxScaToken(
  row: SecurityConnectionRow,
  forceRefresh = false
): Promise<string> {
  if (row.auth_type === 'token') {
    return decryptSecuritySecret(row);
  }

  if (!forceRefresh && row.encrypted_token && row.token_expires_at) {
    const expiresMs = Date.parse(row.token_expires_at);
    if (!Number.isNaN(expiresMs) && expiresMs - Date.now() > 60_000) {
      const cached = decryptSecurityCachedToken(row);
      if (cached) return cached;
    }
  }

  const password = decryptSecuritySecret(row);
  const { accessToken, expiresIn } = await obtainCxScaToken(
    row.base_url,
    row.tenant_account || '',
    row.username || '',
    password,
    row.insecure_tls === 1
  );

  cacheSecurityToken(row.id, accessToken, expiresIn);
  return accessToken;
}

async function cxScaGet<T>(
  row: SecurityConnectionRow,
  apiPath: string
): Promise<T> {
  const { apiUrl } = deriveCxScaEndpoints(row.base_url);
  const insecureTls = row.insecure_tls === 1;
  let token = await getSavedCxScaToken(row, false);

  const callWith = (bearer: string) =>
    nativeHttpRequest<T>(`${apiUrl}${apiPath}`, {
      insecureTls,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
      },
    });

  let res = await callWith(token);
  if (res.status === 401 && row.auth_type === 'password') {
    clearSecurityToken(row.id);
    token = await getSavedCxScaToken(row, true);
    res = await callWith(token);
  }

  if (res.status >= 400) {
    throw new HttpClientError(
      `Checkmarx SCA API error (HTTP ${res.status})`,
      res.status
    );
  }

  return (res.json ?? ({} as T)) as T;
}

export async function testCxScaConnection(input: {
  baseUrl: string;
  authType: SecurityAuthType;
  tenantAccount?: string | null;
  username?: string | null;
  secret: string;
  insecureTls: boolean;
}): Promise<SecurityTestResult> {
  try {
    const { apiUrl } = deriveCxScaEndpoints(input.baseUrl);
    let token: string;
    if (input.authType === 'password') {
      const auth = await obtainCxScaToken(
        input.baseUrl,
        input.tenantAccount || '',
        input.username || '',
        input.secret,
        input.insecureTls
      );
      token = auth.accessToken;
    } else {
      token = input.secret.trim();
    }

    const projectsRes = await nativeHttpRequest<
      CxScaProjectRaw[] | { items?: CxScaProjectRaw[] }
    >(`${apiUrl}/risk-management/projects`, {
      insecureTls: input.insecureTls,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (projectsRes.status >= 400) {
      return {
        connected: false,
        provider: 'cxsca',
        authType: input.authType,
        error: `Checkmarx SCA rejected request (HTTP ${projectsRes.status})`,
      };
    }

    const items = Array.isArray(projectsRes.json)
      ? projectsRes.json
      : Array.isArray(projectsRes.json?.items)
      ? projectsRes.json.items
      : [];

    return {
      connected: true,
      provider: 'cxsca',
      authType: input.authType,
      username: input.username
        ? `${input.tenantAccount || '-'}/${input.username}`
        : 'Bearer Token',
      projectCount: items.length,
    };
  } catch (err) {
    return {
      connected: false,
      provider: 'cxsca',
      authType: input.authType,
      error: err instanceof Error ? err.message : 'Checkmarx SCA connection failed',
    };
  }
}

export async function listCxScaProjects(
  row: SecurityConnectionRow,
  query = ''
): Promise<SecurityProjectSummary[]> {
  const raw = await cxScaGet<
    CxScaProjectRaw[] | { items?: CxScaProjectRaw[] }
  >(row, '/risk-management/projects');

  const projects = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
    ? raw.items
    : [];

  const q = query.trim().toLowerCase();
  const { portalUrl } = deriveCxScaEndpoints(row.base_url);

  return projects
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    .map((p) => {
      const high = Number(p.highVulnerabilityCount ?? 0);
      const med = Number(p.mediumVulnerabilityCount ?? 0);
      const tone: SecurityProjectSummary['statusTone'] =
        high > 0 ? 'danger' : med > 0 ? 'warning' : 'success';

      return {
        id: p.id,
        key: p.id,
        name: p.name,
        lastScanDate: p.lastSuccessfulScanDate || null,
        statusLabel:
          p.riskScore !== undefined ? `Risk ${p.riskScore}` : high > 0 ? `${high} High` : 'Scanned',
        statusTone: tone,
        portalUrl: `${portalUrl}/#/projects/${encodeURIComponent(p.id)}`,
      };
    });
}

export async function getCxScaProjectDetails(
  row: SecurityConnectionRow,
  projectId: string,
  projectName?: string
): Promise<SecurityProjectDetails> {
  const { portalUrl } = deriveCxScaEndpoints(row.base_url);
  const scansRaw = await cxScaGet<
    CxScaScanRaw[] | { items?: CxScaScanRaw[] }
  >(row, `/risk-management/scans?projectId=${encodeURIComponent(projectId)}`);

  const scanList = Array.isArray(scansRaw)
    ? scansRaw
    : Array.isArray(scansRaw?.items)
    ? scansRaw.items
    : [];

  const scans: SecurityScanHistoryItem[] = scanList.slice(0, 10).map((s) => ({
    id: s.scanId || s.id || '-',
    status:
      typeof s.status === 'string'
        ? s.status
        : s.status?.name || 'Completed',
    date: s.finishedOn || s.createdOn || null,
    riskScore: s.riskScore ?? null,
  }));

  const latestScanId = scans[0]?.id;
  const metrics: SecurityMetricBadge[] = [];
  const findings: SecurityFinding[] = [];
  const notes: string[] = [];

  if (latestScanId && latestScanId !== '-') {
    const [summaryRes, vulnsRes] = await Promise.allSettled([
      cxScaGet<CxScaRiskSummaryRaw>(
        row,
        `/risk-management/risk-reports/${encodeURIComponent(latestScanId)}/summary`
      ),
      cxScaGet<CxScaVulnerabilityRaw[] | { items?: CxScaVulnerabilityRaw[] }>(
        row,
        `/risk-management/risk-reports/${encodeURIComponent(latestScanId)}/vulnerabilities`
      ),
    ]);

    if (summaryRes.status === 'fulfilled') {
      const s = summaryRes.value;
      const high = Number(s.highVulnerabilityCount ?? 0);
      const med = Number(s.mediumVulnerabilityCount ?? 0);
      const low = Number(s.lowVulnerabilityCount ?? 0);
      metrics.push(
        {
          label: 'Risk Score',
          value: s.riskScore ?? '-',
          tone: Number(s.riskScore || 0) >= 7 ? 'danger' : 'warning',
        },
        { label: 'High CVEs', value: high, tone: high > 0 ? 'danger' : 'success' },
        { label: 'Medium CVEs', value: med, tone: med > 0 ? 'warning' : 'neutral' },
        { label: 'Low CVEs', value: low, tone: 'info' },
        { label: 'Packages', value: s.totalPackages ?? '-', tone: 'neutral' }
      );
    }

    if (vulnsRes.status === 'fulfilled') {
      const rawVulns = Array.isArray(vulnsRes.value)
        ? vulnsRes.value
        : Array.isArray(vulnsRes.value?.items)
        ? vulnsRes.value.items
        : [];

      for (const v of rawVulns.slice(0, 100)) {
        const pkgLabel = v.packageName
          ? `${v.packageName}${v.packageVersion ? `@${v.packageVersion}` : ''}`
          : v.packageId || '-';
        findings.push({
          id: v.id || `${v.cveName || 'cve'}-${findings.length}`,
          title: v.cveName || 'Package Vulnerability',
          severity: mapCxScaSeverity(v.severity),
          category: v.score !== undefined ? `CVSS ${v.score}` : 'SCA CVE',
          location: pkgLabel,
          description: v.description || undefined,
          recommendation: v.recommendedVersion
            ? `Upgrade to ${v.recommendedVersion}`
            : undefined,
        });
      }
    } else {
      notes.push('Unable to load detailed vulnerability list for the latest scan.');
    }
  } else {
    notes.push('No scans found for this Checkmarx SCA project.');
  }

  return {
    provider: 'cxsca',
    projectId,
    projectKey: projectId,
    projectName: projectName || projectId,
    portalUrl: `${portalUrl}/#/projects/${encodeURIComponent(projectId)}`,
    metrics,
    scans,
    findings,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
