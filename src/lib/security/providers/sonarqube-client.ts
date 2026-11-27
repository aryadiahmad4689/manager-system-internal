import { HttpClientError, nativeHttpRequest } from '@/lib/http/native-http';
import {
  cacheSecurityToken,
  clearSecurityToken,
  decryptSecurityCachedToken,
  decryptSecuritySecret,
  type SecurityConnectionRow,
} from '../security-manager';
import type {
  SecurityAuthType,
  SecurityFinding,
  SecurityMetricBadge,
  SecurityProjectDetails,
  SecurityProjectSummary,
  SecurityTestResult,
} from '../types';

interface SonarProjectRaw {
  key: string;
  name: string;
  qualifier?: string;
  lastAnalysisDate?: string;
  analysisDate?: string;
  qualityGateStatus?: string;
}

interface SonarMeasureRaw {
  metric: string;
  value?: string;
}

interface SonarIssueRaw {
  key: string;
  rule: string;
  severity: string;
  component: string;
  line?: number;
  message: string;
  type: string;
  status: string;
  effort?: string;
}

interface SonarHotspotRaw {
  key: string;
  component: string;
  line?: number;
  message: string;
  securityCategory?: string;
  vulnerabilityProbability?: string;
  status: string;
}

function mapSonarSeverity(severity: string): SecurityFinding['severity'] {
  switch (severity.toUpperCase()) {
    case 'BLOCKER':
      return 'CRITICAL';
    case 'CRITICAL':
    case 'HIGH':
      return 'HIGH';
    case 'MAJOR':
    case 'MEDIUM':
      return 'MEDIUM';
    case 'MINOR':
    case 'LOW':
      return 'LOW';
    default:
      return 'INFO';
  }
}

function buildCookieHeaderFromSetCookie(
  setCookie: string | string[] | undefined
): { cookieHeader: string; xsrfToken?: string } | null {
  if (!setCookie) return null;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const pairs: string[] = [];
  let xsrfToken: string | undefined;

  for (const entry of list) {
    const firstPart = entry.split(';')[0]?.trim();
    if (!firstPart || !firstPart.includes('=')) continue;
    const eqIdx = firstPart.indexOf('=');
    const name = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (!val) continue;
    pairs.push(`${name}=${val}`);
    if (name === 'XSRF-TOKEN') {
      xsrfToken = decodeURIComponent(val);
    }
  }

  if (pairs.length === 0) return null;
  return { cookieHeader: pairs.join('; '), xsrfToken };
}

async function obtainSonarAuthHeaders(
  baseUrl: string,
  authType: SecurityAuthType,
  username: string,
  secret: string,
  insecureTls: boolean
): Promise<{ headers: Record<string, string>; cacheValue?: string }> {
  if (authType === 'token') {
    const basic = Buffer.from(`${secret.trim()}:`, 'utf8').toString('base64');
    return { headers: { Authorization: `Basic ${basic}` } };
  }

  if (!username || !secret) {
    throw new HttpClientError('Username and password are required for SonarQube', 400);
  }

  const loginBody = new URLSearchParams({
    login: username,
    password: secret,
  }).toString();

  const loginRes = await nativeHttpRequest(`${baseUrl}/api/authentication/login`, {
    method: 'POST',
    insecureTls,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
    },
    body: loginBody,
  });

  if (loginRes.status === 401 || loginRes.status === 403) {
    throw new HttpClientError('Invalid SonarQube username or password', 401);
  }

  const parsedCookies = buildCookieHeaderFromSetCookie(
    loginRes.headers['set-cookie']
  );

  if (loginRes.status >= 200 && loginRes.status < 300 && parsedCookies) {
    const authHeaders: Record<string, string> = {
      Cookie: parsedCookies.cookieHeader,
      ...(parsedCookies.xsrfToken
        ? { 'X-XSRF-TOKEN': parsedCookies.xsrfToken }
        : {}),
    };
    return {
      headers: authHeaders,
      cacheValue: JSON.stringify(authHeaders),
    };
  }

  // Fallback to HTTP Basic Auth if /api/authentication/login did not yield cookies
  const basic = Buffer.from(`${username}:${secret}`, 'utf8').toString('base64');
  return { headers: { Authorization: `Basic ${basic}` } };
}

async function getSavedSonarHeaders(
  row: SecurityConnectionRow,
  forceRefresh = false
): Promise<Record<string, string>> {
  if (row.auth_type === 'token') {
    const token = decryptSecuritySecret(row);
    const basic = Buffer.from(`${token}:`, 'utf8').toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  if (!forceRefresh && row.encrypted_token && row.token_expires_at) {
    const expiresMs = Date.parse(row.token_expires_at);
    if (!Number.isNaN(expiresMs) && expiresMs - Date.now() > 60_000) {
      const cached = decryptSecurityCachedToken(row);
      if (cached) {
        try {
          return JSON.parse(cached) as Record<string, string>;
        } catch {
          // ignore malformed cache
        }
      }
    }
  }

  const password = decryptSecuritySecret(row);
  const auth = await obtainSonarAuthHeaders(
    row.base_url,
    'password',
    row.username || '',
    password,
    row.insecure_tls === 1
  );

  if (auth.cacheValue) {
    cacheSecurityToken(row.id, auth.cacheValue, 3600);
  }

  return auth.headers;
}

async function sonarGet<T>(
  row: SecurityConnectionRow,
  apiPath: string
): Promise<T> {
  const insecureTls = row.insecure_tls === 1;
  let headers = await getSavedSonarHeaders(row, false);

  let res = await nativeHttpRequest<T>(`${row.base_url}${apiPath}`, {
    insecureTls,
    headers,
  });

  const isInsufficientPrivileges =
    res.status === 403 &&
    res.text.toLowerCase().includes('insufficient privileges');

  if (
    (res.status === 401 || (res.status === 403 && !isInsufficientPrivileges)) &&
    row.auth_type === 'password'
  ) {
    clearSecurityToken(row.id);
    headers = await getSavedSonarHeaders(row, true);
    res = await nativeHttpRequest<T>(`${row.base_url}${apiPath}`, {
      insecureTls,
      headers,
    });
  }

  if (res.status >= 400) {
    const msg =
      (res.json as Record<string, unknown> | null)?.errors &&
      Array.isArray((res.json as { errors?: Array<{ msg?: string }> }).errors)
        ? (res.json as { errors: Array<{ msg?: string }> }).errors
            .map((e) => e.msg)
            .filter(Boolean)
            .join('; ')
        : `SonarQube API error (HTTP ${res.status})`;
    throw new HttpClientError(msg || `SonarQube API error (HTTP ${res.status})`, res.status);
  }

  return (res.json ?? {}) as T;
}

export async function testSonarQubeConnection(input: {
  baseUrl: string;
  authType: SecurityAuthType;
  username?: string | null;
  secret: string;
  insecureTls: boolean;
}): Promise<SecurityTestResult> {
  try {
    const auth = await obtainSonarAuthHeaders(
      input.baseUrl,
      input.authType,
      input.username || '',
      input.secret,
      input.insecureTls
    );

    const validateRes = await nativeHttpRequest<{ valid?: boolean }>(
      `${input.baseUrl}/api/authentication/validate`,
      { insecureTls: input.insecureTls, headers: auth.headers }
    );

    if (validateRes.status >= 400 || validateRes.json?.valid === false) {
      return {
        connected: false,
        provider: 'sonarqube',
        authType: input.authType,
        error: 'SonarQube rejected the credentials (authentication/validate failed)',
      };
    }

    const [versionRes, projectsRes] = await Promise.allSettled([
      nativeHttpRequest(`${input.baseUrl}/api/server/version`, {
        insecureTls: input.insecureTls,
        headers: auth.headers,
      }),
      nativeHttpRequest<{ paging?: { total?: number } }>(
        `${input.baseUrl}/api/components/search?qualifiers=TRK&ps=1`,
        { insecureTls: input.insecureTls, headers: auth.headers }
      ),
    ]);

    const version =
      versionRes.status === 'fulfilled' && versionRes.value.status === 200
        ? versionRes.value.text.trim()
        : null;
    const projectCount =
      projectsRes.status === 'fulfilled' && projectsRes.value.status === 200
        ? projectsRes.value.json?.paging?.total
        : undefined;

    return {
      connected: true,
      provider: 'sonarqube',
      authType: input.authType,
      version,
      username: input.username || 'Token User',
      projectCount,
    };
  } catch (err) {
    return {
      connected: false,
      provider: 'sonarqube',
      authType: input.authType,
      error: err instanceof Error ? err.message : 'SonarQube connection failed',
    };
  }
}

interface SonarPagedProjectsResponse {
  paging?: {
    pageIndex?: number;
    pageSize?: number;
    total?: number;
  };
  components?: SonarProjectRaw[];
}

async function fetchPagedSonarProjects(
  row: SecurityConnectionRow,
  buildPath: (page: number, pageSize: number) => string
): Promise<SonarProjectRaw[]> {
  const pageSize = 500;
  const maxPages = 5;
  const all: SonarProjectRaw[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = await sonarGet<SonarPagedProjectsResponse>(
      row,
      buildPath(page, pageSize)
    );
    const items = Array.isArray(res.components) ? res.components : [];
    all.push(...items);

    const total = res.paging?.total;
    if (
      items.length < pageSize ||
      (typeof total === 'number' && all.length >= total)
    ) {
      break;
    }
  }

  return all;
}

export async function listSonarQubeProjects(
  row: SecurityConnectionRow,
  query = ''
): Promise<SecurityProjectSummary[]> {
  const trimmedQuery = query.trim();

  let components: SonarProjectRaw[];
  try {
    components = await fetchPagedSonarProjects(row, (page, pageSize) => {
      const searchParams = new URLSearchParams({
        ps: String(pageSize),
        p: String(page),
      });
      if (trimmedQuery) {
        const safeQuery = trimmedQuery.replace(/"/g, '');
        searchParams.set('filter', `query = "${safeQuery}"`);
      }
      return `/api/components/search_projects?${searchParams.toString()}`;
    });
  } catch (err) {
    if (
      err instanceof HttpClientError &&
      (err.statusCode === 404 || err.statusCode === 403 || err.statusCode === 400)
    ) {
      components = await fetchPagedSonarProjects(row, (page, pageSize) => {
        const fallbackParams = new URLSearchParams({
          qualifiers: 'TRK,APP',
          ps: String(pageSize),
          p: String(page),
        });
        if (trimmedQuery) {
          fallbackParams.set('q', trimmedQuery);
        }
        return `/api/components/search?${fallbackParams.toString()}`;
      });
    } else {
      throw err;
    }
  }

  return components.map((c) => ({
    id: c.key,
    key: c.key,
    name: c.name,
    lastScanDate: c.lastAnalysisDate || c.analysisDate || null,
    statusLabel:
      c.qualityGateStatus ||
      (c.qualifier === 'TRK' ? 'Project' : c.qualifier || null),
    statusTone:
      c.qualityGateStatus === 'OK'
        ? 'success'
        : c.qualityGateStatus === 'ERROR'
        ? 'danger'
        : c.qualityGateStatus === 'WARN'
        ? 'warning'
        : 'neutral',
    portalUrl: `${row.base_url}/dashboard?id=${encodeURIComponent(c.key)}`,
  }));
}

export async function getSonarQubeProjectDetails(
  row: SecurityConnectionRow,
  projectKey: string
): Promise<SecurityProjectDetails> {
  const encodedKey = encodeURIComponent(projectKey);

  const [qgRes, measuresRes, issuesRes, hotspotsRes] = await Promise.allSettled([
    sonarGet<{
      projectStatus?: {
        status?: string;
        conditions?: Array<{
          metricKey: string;
          status: string;
          actualValue?: string;
          errorThreshold?: string;
        }>;
      };
    }>(row, `/api/qualitygates/project_status?projectKey=${encodedKey}`),
    sonarGet<{
      component?: { name?: string; measures?: SonarMeasureRaw[] };
    }>(
      row,
      `/api/measures/component?component=${encodedKey}&metricKeys=bugs,vulnerabilities,code_smells,security_hotspots,coverage,duplicated_lines_density`
    ),
    sonarGet<{ issues?: SonarIssueRaw[] }>(
      row,
      `/api/issues/search?componentKeys=${encodedKey}&resolved=false&ps=50`
    ),
    sonarGet<{ hotspots?: SonarHotspotRaw[] }>(
      row,
      `/api/hotspots/search?projectKey=${encodedKey}&ps=30`
    ),
  ]);

  const qgStatus =
    qgRes.status === 'fulfilled'
      ? qgRes.value.projectStatus?.status || null
      : null;

  const measures =
    measuresRes.status === 'fulfilled' &&
    Array.isArray(measuresRes.value.component?.measures)
      ? measuresRes.value.component.measures
      : [];

  const measureMap = new Map<string, string>();
  for (const m of measures) {
    if (m.metric && m.value !== undefined) {
      measureMap.set(m.metric, m.value);
    }
  }

  const metrics: SecurityMetricBadge[] = [
    {
      label: 'Quality Gate',
      value: qgStatus || 'N/A',
      tone:
        qgStatus === 'OK'
          ? 'success'
          : qgStatus === 'ERROR'
          ? 'danger'
          : qgStatus === 'WARN'
          ? 'warning'
          : 'neutral',
    },
    {
      label: 'Bugs',
      value: measureMap.get('bugs') ?? '-',
      tone: Number(measureMap.get('bugs') || 0) > 0 ? 'danger' : 'success',
    },
    {
      label: 'Vulnerabilities',
      value: measureMap.get('vulnerabilities') ?? '-',
      tone: Number(measureMap.get('vulnerabilities') || 0) > 0 ? 'danger' : 'success',
    },
    {
      label: 'Security Hotspots',
      value: measureMap.get('security_hotspots') ?? '-',
      tone: Number(measureMap.get('security_hotspots') || 0) > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Code Smells',
      value: measureMap.get('code_smells') ?? '-',
      tone: 'info',
    },
    {
      label: 'Coverage',
      value: measureMap.has('coverage') ? `${measureMap.get('coverage')}%` : '-',
      tone: 'neutral',
    },
    {
      label: 'Duplication',
      value: measureMap.has('duplicated_lines_density')
        ? `${measureMap.get('duplicated_lines_density')}%`
        : '-',
      tone: 'neutral',
    },
  ];

  const findings: SecurityFinding[] = [];

  if (issuesRes.status === 'fulfilled' && Array.isArray(issuesRes.value.issues)) {
    for (const issue of issuesRes.value.issues) {
      const filePart = issue.component.includes(':')
        ? issue.component.split(':').slice(1).join(':')
        : issue.component;
      findings.push({
        id: issue.key,
        title: issue.message,
        severity: mapSonarSeverity(issue.severity),
        category: `${issue.type} (${issue.rule})`,
        location: issue.line ? `${filePart}:${issue.line}` : filePart,
        status: issue.status,
      });
    }
  }

  if (
    hotspotsRes.status === 'fulfilled' &&
    Array.isArray(hotspotsRes.value.hotspots)
  ) {
    for (const hs of hotspotsRes.value.hotspots) {
      const filePart = hs.component.includes(':')
        ? hs.component.split(':').slice(1).join(':')
        : hs.component;
      findings.push({
        id: hs.key,
        title: hs.message,
        severity: mapSonarSeverity(hs.vulnerabilityProbability || 'MEDIUM'),
        category: `HOTSPOT (${hs.securityCategory || 'security'})`,
        location: hs.line ? `${filePart}:${hs.line}` : filePart,
        status: hs.status,
      });
    }
  }

  const projectName =
    (measuresRes.status === 'fulfilled' && measuresRes.value.component?.name) ||
    projectKey;

  return {
    provider: 'sonarqube',
    projectId: projectKey,
    projectKey,
    projectName,
    portalUrl: `${row.base_url}/dashboard?id=${encodedKey}`,
    qualityGateStatus: qgStatus,
    metrics,
    scans: [],
    findings,
  };
}
