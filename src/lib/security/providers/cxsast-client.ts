import { HttpClientError, nativeHttpRequest } from '@/lib/http/native-http';
import {
  cacheSecurityToken,
  clearSecurityToken,
  decryptSecurityCachedToken,
  decryptSecurityClientSecret,
  decryptSecuritySecret,
  type SecurityConnectionRow,
} from '../security-manager';
import type {
  SecurityAuthType,
  SecurityFinding,
  SecurityMetricBadge,
  SecurityProjectDetails,
  SecurityProjectSummary,
  SecurityScanHistoryItem,
  SecurityTestResult,
} from '../types';

export const DEFAULT_CXSAST_CLIENT_ID = 'resource_owner_client';
export const DEFAULT_CXSAST_CLIENT_SECRET = '014DF517-39D1-4453-B7B3-9930C563627C';

interface CxSastTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface CxSastProjectRaw {
  id: number;
  name: string;
  isPublic?: boolean;
}

interface CxSastScanRaw {
  id: number;
  status?: { name?: string };
  dateAndTime?: { finishedOn?: string; startedOn?: string };
  scanState?: { linesOfCode?: number; sourceId?: string };
  origin?: string;
}

interface CxSastStatsRaw {
  highSeverity?: number;
  mediumSeverity?: number;
  lowSeverity?: number;
  infoSeverity?: number;
  highSeverityCounter?: number;
  mediumSeverityCounter?: number;
  lowSeverityCounter?: number;
  infoSeverityCounter?: number;
}

interface CxSastODataResultRaw {
  Id?: number;
  QueryName?: string;
  Severity?: string;
  StateId?: number;
  SourceFileName?: string;
  Line?: number;
  Comment?: string;
  CweId?: number;
}

async function obtainCxSastToken(
  baseUrl: string,
  username: string,
  password: string,
  clientId: string,
  clientSecret: string,
  insecureTls: boolean
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!username || !password) {
    throw new HttpClientError('Username and password are required for CxSAST', 400);
  }

  const scopesToTry = ['sast_api access_control_api', 'sast_rest_api'];

  for (const scope of scopesToTry) {
    const body = new URLSearchParams({
      username,
      password,
      grant_type: 'password',
      scope,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();

    const res = await nativeHttpRequest<CxSastTokenResponse>(
      `${baseUrl}/cxrestapi/auth/identity/connect/token`,
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

    if (res.json?.error === 'invalid_scope') {
      continue;
    }

    if (
      res.json?.error === 'unauthorized_client' ||
      res.json?.error === 'invalid_client'
    ) {
      throw new HttpClientError(
        `Checkmarx SAST rejected client "${clientId}" (${res.json.error}). Configure Custom Client ID/Secret in Advanced or switch to Bearer Token mode.`,
        401
      );
    }

    throw new HttpClientError(
      res.json?.error_description ||
        res.json?.error ||
        `Checkmarx SAST auth failed (HTTP ${res.status})`,
      res.status >= 400 ? res.status : 401
    );
  }

  throw new HttpClientError('Checkmarx SAST OAuth token exchange failed', 401);
}

async function getSavedCxSastToken(
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
  const customSecret = decryptSecurityClientSecret(row);
  const { accessToken, expiresIn } = await obtainCxSastToken(
    row.base_url,
    row.username || '',
    password,
    row.client_id || DEFAULT_CXSAST_CLIENT_ID,
    customSecret || DEFAULT_CXSAST_CLIENT_SECRET,
    row.insecure_tls === 1
  );

  cacheSecurityToken(row.id, accessToken, expiresIn);
  return accessToken;
}

async function cxSastGet<T>(
  row: SecurityConnectionRow,
  apiPath: string
): Promise<T> {
  const insecureTls = row.insecure_tls === 1;
  let token = await getSavedCxSastToken(row, false);

  const callWith = (bearer: string) =>
    nativeHttpRequest<T>(`${row.base_url}${apiPath}`, {
      insecureTls,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json;v=1.0',
      },
    });

  let res = await callWith(token);
  if (res.status === 401 && row.auth_type === 'password') {
    clearSecurityToken(row.id);
    token = await getSavedCxSastToken(row, true);
    res = await callWith(token);
  }

  if (res.status >= 400) {
    throw new HttpClientError(
      `Checkmarx SAST API error (HTTP ${res.status})`,
      res.status
    );
  }

  return (res.json ?? ({} as T)) as T;
}

function mapCxSastSeverity(sev?: string): SecurityFinding['severity'] {
  switch ((sev || '').toLowerCase()) {
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

export async function testCxSastConnection(input: {
  baseUrl: string;
  authType: SecurityAuthType;
  username?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  secret: string;
  insecureTls: boolean;
}): Promise<SecurityTestResult> {
  try {
    let token: string;
    if (input.authType === 'password') {
      const auth = await obtainCxSastToken(
        input.baseUrl,
        input.username || '',
        input.secret,
        input.clientId || DEFAULT_CXSAST_CLIENT_ID,
        input.clientSecret || DEFAULT_CXSAST_CLIENT_SECRET,
        input.insecureTls
      );
      token = auth.accessToken;
    } else {
      token = input.secret.trim();
    }

    const projectsRes = await nativeHttpRequest<CxSastProjectRaw[]>(
      `${input.baseUrl}/cxrestapi/projects`,
      {
        insecureTls: input.insecureTls,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json;v=1.0',
        },
      }
    );

    if (projectsRes.status >= 400) {
      return {
        connected: false,
        provider: 'cxsast',
        authType: input.authType,
        error: `Checkmarx SAST rejected request (HTTP ${projectsRes.status})`,
      };
    }

    const projectCount = Array.isArray(projectsRes.json)
      ? projectsRes.json.length
      : undefined;

    return {
      connected: true,
      provider: 'cxsast',
      authType: input.authType,
      username: input.username || 'Bearer Token',
      projectCount,
    };
  } catch (err) {
    return {
      connected: false,
      provider: 'cxsast',
      authType: input.authType,
      error: err instanceof Error ? err.message : 'Checkmarx SAST connection failed',
    };
  }
}

export async function listCxSastProjects(
  row: SecurityConnectionRow,
  query = ''
): Promise<SecurityProjectSummary[]> {
  const projects = await cxSastGet<CxSastProjectRaw[]>(row, '/cxrestapi/projects');
  const q = query.trim().toLowerCase();

  return (Array.isArray(projects) ? projects : [])
    .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.id).includes(q))
    .map((p) => ({
      id: String(p.id),
      key: String(p.id),
      name: p.name,
      lastScanDate: null,
      statusLabel: p.isPublic ? 'Public' : 'Private',
      statusTone: 'neutral',
      portalUrl: `${row.base_url}/CxWebClient/projectscans.aspx?id=${p.id}`,
    }));
}

export async function getCxSastProjectDetails(
  row: SecurityConnectionRow,
  projectId: string,
  projectName?: string
): Promise<SecurityProjectDetails> {
  const scansRaw = await cxSastGet<CxSastScanRaw[]>(
    row,
    `/cxrestapi/sast/scans?projectId=${encodeURIComponent(projectId)}&last=10`
  );

  const scanList = Array.isArray(scansRaw) ? scansRaw : [];
  const scans: SecurityScanHistoryItem[] = scanList.map((s) => ({
    id: String(s.id),
    status: s.status?.name || 'Unknown',
    date: s.dateAndTime?.finishedOn || s.dateAndTime?.startedOn || null,
    loc: s.scanState?.linesOfCode ?? null,
  }));

  const finishedScan =
    scanList.find((s) => s.status?.name?.toLowerCase() === 'finished') ||
    scanList[0];

  const metrics: SecurityMetricBadge[] = [];
  const findings: SecurityFinding[] = [];
  const notes: string[] = [];

  if (finishedScan) {
    const [statsRes, odataRes] = await Promise.allSettled([
      cxSastGet<CxSastStatsRaw>(
        row,
        `/cxrestapi/sast/scans/${finishedScan.id}/resultsStatistics`
      ),
      cxSastGet<{ value?: CxSastODataResultRaw[] }>(
        row,
        `/Cxwebinterface/odata/v1/Scans(${finishedScan.id})/Results?$top=100`
      ),
    ]);

    if (statsRes.status === 'fulfilled') {
      const st = statsRes.value;
      const high = Number(st.highSeverity ?? st.highSeverityCounter ?? 0);
      const med = Number(st.mediumSeverity ?? st.mediumSeverityCounter ?? 0);
      const low = Number(st.lowSeverity ?? st.lowSeverityCounter ?? 0);
      const info = Number(st.infoSeverity ?? st.infoSeverityCounter ?? 0);

      if (scans[0]) {
        scans[0].highCount = high;
        scans[0].mediumCount = med;
        scans[0].lowCount = low;
        scans[0].infoCount = info;
      }

      metrics.push(
        { label: 'High', value: high, tone: high > 0 ? 'danger' : 'success' },
        { label: 'Medium', value: med, tone: med > 0 ? 'warning' : 'neutral' },
        { label: 'Low', value: low, tone: 'info' },
        { label: 'Info', value: info, tone: 'neutral' }
      );
    }

    if (odataRes.status === 'fulfilled' && Array.isArray(odataRes.value?.value)) {
      for (const r of odataRes.value.value) {
        findings.push({
          id: String(r.Id ?? `${finishedScan.id}-${findings.length}`),
          title: r.QueryName || 'SAST Finding',
          severity: mapCxSastSeverity(r.Severity),
          category: r.CweId ? `CWE-${r.CweId}` : 'SAST',
          location: r.SourceFileName
            ? r.Line
              ? `${r.SourceFileName}:${r.Line}`
              : r.SourceFileName
            : '-',
          description: r.Comment || undefined,
        });
      }
    } else {
      notes.push(
        'Detailed per-line findings via CxSAST OData are unavailable or restricted; summary statistics and scan history are shown.'
      );
    }
  } else {
    notes.push('No scans found for this project yet.');
  }

  return {
    provider: 'cxsast',
    projectId,
    projectKey: projectId,
    projectName: projectName || `Project #${projectId}`,
    portalUrl: `${row.base_url}/CxWebClient/projectscans.aspx?id=${encodeURIComponent(projectId)}`,
    metrics,
    scans,
    findings,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
