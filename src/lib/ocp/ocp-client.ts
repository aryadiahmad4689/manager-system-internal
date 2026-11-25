import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import {
  cacheClusterOAuthToken,
  clearClusterOAuthToken,
  decryptClusterCachedToken,
  decryptClusterSecret,
  getOcpClusterRow,
  type OcpClusterRow,
} from './ocp-manager';
import {
  deriveApiUrlFromConsoleUrl,
  formatK8sAge,
  normalizeHttpUrl,
  parseOAuthTokenFromLocation,
  validateConfigMapKey,
  validateK8sName,
} from './ocp-urls';
import type {
  OcpActionPayload,
  OcpAuthType,
  OcpConfigMap,
  OcpDeployment,
  OcpDescribeKind,
  OcpDescribeResponse,
  OcpEvent,
  OcpPod,
  OcpProject,
  OcpRoute,
  OcpService,
  OcpTestResult,
  OcpWorkloadsResponse,
} from './types';

export class OcpClientError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'OcpClientError';
    this.statusCode = statusCode;
  }
}

export interface K8sMetadata {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  annotations?: Record<string, string>;
  managedFields?: unknown;
}

export interface K8sContainerStatus {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    waiting?: { reason?: string };
    terminated?: { reason?: string; exitCode?: number };
  };
}

export interface K8sContainerSpec {
  name?: string;
  image?: string;
}

export interface K8sRawPod {
  metadata?: K8sMetadata;
  spec?: {
    nodeName?: string;
    containers?: K8sContainerSpec[];
  };
  status?: {
    phase?: string;
    podIP?: string;
    initContainerStatuses?: K8sContainerStatus[];
    containerStatuses?: K8sContainerStatus[];
  };
}

interface K8sRawDeployment {
  metadata?: K8sMetadata;
  spec?: {
    replicas?: number;
    template?: { spec?: { containers?: K8sContainerSpec[] } };
  };
  status?: {
    readyReplicas?: number;
    availableReplicas?: number;
  };
}

interface K8sRawService {
  metadata?: K8sMetadata;
  spec?: {
    type?: string;
    clusterIP?: string;
    ports?: Array<{ port?: number; targetPort?: string | number; protocol?: string }>;
  };
}

interface K8sRawRoute {
  metadata?: K8sMetadata;
  spec?: {
    host?: string;
    path?: string;
    tls?: unknown;
    to?: { name?: string };
    port?: { targetPort?: string | number };
  };
}

interface K8sRawConfigMap {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  immutable?: boolean;
}

interface K8sRawEvent {
  metadata?: K8sMetadata;
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  source?: { component?: string };
  reportingComponent?: string;
}

interface K8sJsonObject {
  authorization_endpoint?: string;
  gitVersion?: string;
  message?: string;
  metadata?: K8sMetadata;
  items?: unknown[];
  status?: { phase?: string };
  [key: string]: unknown;
}

export interface HttpResponseResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: K8sJsonObject | null;
}

export interface OcpHttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  insecureTls?: boolean;
  timeoutMs?: number;
}

/**
 * Performs an HTTP/HTTPS request using Node.js native modules.
 * Supports self-signed / internal corporate TLS certificates via insecureTls.
 */
export function ocpHttpRequest(
  targetUrl: string,
  options: OcpHttpRequestOptions = {}
): Promise<HttpResponseResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new OcpClientError(`Invalid URL: ${targetUrl}`, 400));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const method = options.method || 'GET';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (options.body !== undefined && !headers['Content-Length']) {
      headers['Content-Length'] = String(Buffer.byteLength(options.body));
    }

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      ...(isHttps ? { rejectUnauthorized: !options.insecureTls } : {}),
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: K8sJsonObject | null = null;
        try {
          json = text ? (JSON.parse(text) as K8sJsonObject) : null;
        } catch {
          json = null;
        }
        resolve({
          status: res.statusCode || 500,
          headers: res.headers as Record<string, string | string[] | undefined>,
          text,
          json,
        });
      });
    });

    req.on('error', (err) => {
      reject(new OcpClientError(`Network error connecting to ${parsed.host}: ${err.message}`, 502));
    });

    req.setTimeout(options.timeoutMs ?? 15000, () => {
      req.destroy();
      reject(new OcpClientError(`Request timeout connecting to ${parsed.host}`, 504));
    });

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function getHeaderString(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const val = headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
}

/**
 * Discovers the OpenShift OAuth authorization endpoint from the API server.
 */
export async function discoverOAuthAuthorizationEndpoint(
  apiUrl: string,
  insecureTls: boolean
): Promise<string> {
  const normalizedApi = normalizeHttpUrl(apiUrl);
  const discoveryUrl = `${normalizedApi}/.well-known/oauth-authorization-server`;
  const res = await ocpHttpRequest(discoveryUrl, { insecureTls });

  if (res.status !== 200 || !res.json?.authorization_endpoint) {
    throw new OcpClientError(
      `Failed to discover OpenShift OAuth server at ${discoveryUrl} (HTTP ${res.status})`,
      res.status >= 400 ? res.status : 502
    );
  }

  return res.json.authorization_endpoint as string;
}

/**
 * Exchanges OpenShift username/password for an OAuth access token via
 * `openshift-challenging-client` (equivalent to `oc login -u ... -p ...`).
 */
export async function obtainOAuthToken(
  apiUrl: string,
  username: string,
  password: string,
  insecureTls: boolean
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!username || !password) {
    throw new OcpClientError('Username and password are required for OAuth login', 400);
  }

  const authEndpoint = await discoverOAuthAuthorizationEndpoint(apiUrl, insecureTls);
  const authorizeUrl = `${authEndpoint}?response_type=token&client_id=openshift-challenging-client`;
  const basicAuth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

  const res = await ocpHttpRequest(authorizeUrl, {
    method: 'GET',
    insecureTls,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'X-CSRF-Token': '1',
      Accept: '*/*',
    },
  });

  if (res.status >= 300 && res.status < 400) {
    const location = getHeaderString(res.headers, 'location');
    const parsed = parseOAuthTokenFromLocation(location);
    if (parsed) {
      return {
        accessToken: parsed.accessToken,
        expiresIn: parsed.expiresIn,
      };
    }

    throw new OcpClientError(
      'OpenShift OAuth redirected to an interactive/SSO login page instead of returning an access token. If this cluster uses SSO/OIDC or MFA, switch Auth Mode to Bearer Token.',
      401
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new OcpClientError('Invalid OpenShift username or password', 401);
  }

  throw new OcpClientError(
    `OpenShift OAuth login failed (HTTP ${res.status})`,
    res.status >= 400 ? res.status : 502
  );
}

/**
 * Returns a valid Bearer token for a stored OCP cluster row.
 * Refreshes and caches OAuth tokens when auth_type is 'oauth_password'.
 */
export async function getClusterToken(
  row: OcpClusterRow,
  forceRefresh = false
): Promise<string> {
  if (row.auth_type === 'token') {
    return decryptClusterSecret(row);
  }

  const safetyWindowMs = 60 * 1000;
  if (!forceRefresh && row.encrypted_token && row.token_expires_at) {
    const expiresMs = Date.parse(row.token_expires_at);
    if (!Number.isNaN(expiresMs) && expiresMs - Date.now() > safetyWindowMs) {
      const cached = decryptClusterCachedToken(row);
      if (cached) return cached;
    }
  }

  const password = decryptClusterSecret(row);
  const { accessToken, expiresIn } = await obtainOAuthToken(
    row.api_url,
    row.username || '',
    password,
    row.insecure_tls === 1
  );
  cacheClusterOAuthToken(row.id, accessToken, expiresIn);
  return accessToken;
}

/**
 * Executes an authenticated OpenShift/Kubernetes API request for a stored cluster.
 * Automatically refreshes expired OAuth tokens once on HTTP 401.
 */
export async function executeClusterApi(
  clusterId: string,
  apiPath: string,
  options: OcpHttpRequestOptions = {}
): Promise<{ row: OcpClusterRow; response: HttpResponseResult }> {
  const row = getOcpClusterRow(clusterId);
  if (!row) {
    throw new OcpClientError('OCP cluster not found', 404);
  }

  const insecureTls = row.insecure_tls === 1;
  let token = await getClusterToken(row, false);

  const sendWithToken = (bearerToken: string) =>
    ocpHttpRequest(`${row.api_url}${apiPath}`, {
      ...options,
      insecureTls,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        ...(options.headers || {}),
      },
    });

  let response = await sendWithToken(token);

  if (response.status === 401 && row.auth_type === 'oauth_password') {
    clearClusterOAuthToken(row.id);
    token = await getClusterToken(row, true);
    response = await sendWithToken(token);
  }

  return { row, response };
}

function extractApiError(response: HttpResponseResult, fallback: string): string {
  if (response.json?.message) {
    return `${fallback}: ${response.json.message}`;
  }
  return `${fallback} (HTTP ${response.status})`;
}

async function verifyTokenAgainstCluster(
  apiUrl: string,
  token: string,
  authType: OcpAuthType,
  insecureTls: boolean,
  fallbackUsername?: string | null
): Promise<OcpTestResult> {
  const headers = { Authorization: `Bearer ${token}` };

  // Check projects/namespaces first to prove API access works
  let projectsRes = await ocpHttpRequest(
    `${apiUrl}/apis/project.openshift.io/v1/projects?limit=5`,
    { headers, insecureTls }
  );
  if (projectsRes.status === 404 || projectsRes.status === 403) {
    projectsRes = await ocpHttpRequest(`${apiUrl}/api/v1/namespaces?limit=5`, {
      headers,
      insecureTls,
    });
  }

  if (projectsRes.status === 401) {
    return {
      connected: false,
      authType,
      error: 'Authentication rejected by cluster (HTTP 401 Unauthorized)',
    };
  }

  if (projectsRes.status >= 400 && projectsRes.status !== 403) {
    return {
      connected: false,
      authType,
      error: extractApiError(projectsRes, 'Failed to query cluster API'),
    };
  }

  // Optional: query user identity and server version
  const [userRes, versionRes] = await Promise.allSettled([
    ocpHttpRequest(`${apiUrl}/apis/user.openshift.io/v1/users/~`, {
      headers,
      insecureTls,
    }),
    ocpHttpRequest(`${apiUrl}/version`, { headers, insecureTls }),
  ]);

  let resolvedUsername: string | null = fallbackUsername || null;
  if (
    userRes.status === 'fulfilled' &&
    userRes.value.status === 200 &&
    userRes.value.json?.metadata?.name
  ) {
    resolvedUsername = userRes.value.json.metadata.name;
  }

  let serverVersion: string | null = null;
  if (
    versionRes.status === 'fulfilled' &&
    versionRes.value.status === 200 &&
    versionRes.value.json?.gitVersion
  ) {
    serverVersion = versionRes.value.json.gitVersion;
  }

  const projectCount = Array.isArray(projectsRes.json?.items)
    ? projectsRes.json.items.length
    : undefined;

  return {
    connected: true,
    username: resolvedUsername,
    serverVersion,
    authType,
    projectCount,
  };
}

/**
 * Tests connection parameters directly (before saving a cluster in the form modal).
 */
export async function testRawClusterConnection(input: {
  consoleUrl: string;
  apiUrl?: string;
  authType: OcpAuthType;
  username?: string | null;
  secret: string;
  insecureTls?: boolean;
}): Promise<OcpTestResult> {
  try {
    const normalizedConsole = normalizeHttpUrl(input.consoleUrl);
    const apiUrl = input.apiUrl
      ? normalizeHttpUrl(input.apiUrl)
      : deriveApiUrlFromConsoleUrl(normalizedConsole);
    const insecureTls = input.insecureTls !== false;

    let token: string;
    if (input.authType === 'oauth_password') {
      const oauth = await obtainOAuthToken(
        apiUrl,
        input.username || '',
        input.secret,
        insecureTls
      );
      token = oauth.accessToken;
    } else {
      token = input.secret.trim();
      if (!token) {
        return {
          connected: false,
          authType: input.authType,
          error: 'Bearer token is required',
        };
      }
    }

    return await verifyTokenAgainstCluster(
      apiUrl,
      token,
      input.authType,
      insecureTls,
      input.username
    );
  } catch (err) {
    return {
      connected: false,
      authType: input.authType,
      error: err instanceof Error ? err.message : 'Connection test failed',
    };
  }
}

/**
 * Tests connectivity and refreshes cached OAuth token for an existing saved cluster.
 */
export async function testSavedClusterConnection(
  clusterId: string
): Promise<OcpTestResult> {
  const row = getOcpClusterRow(clusterId);
  if (!row) {
    throw new OcpClientError('OCP cluster not found', 404);
  }

  try {
    const token = await getClusterToken(row, row.auth_type === 'oauth_password');
    return await verifyTokenAgainstCluster(
      row.api_url,
      token,
      row.auth_type,
      row.insecure_tls === 1,
      row.username
    );
  } catch (err) {
    return {
      connected: false,
      authType: row.auth_type,
      error: err instanceof Error ? err.message : 'Connection test failed',
    };
  }
}

/**
 * Lists OpenShift Projects (falling back to Kubernetes Namespaces).
 */
export async function listProjects(clusterId: string): Promise<OcpProject[]> {
  let { response } = await executeClusterApi(
    clusterId,
    '/apis/project.openshift.io/v1/projects'
  );

  if (response.status === 404 || response.status === 403) {
    const nsAttempt = await executeClusterApi(clusterId, '/api/v1/namespaces');
    response = nsAttempt.response;
  }

  if (response.status >= 400) {
    throw new OcpClientError(
      extractApiError(response, 'Failed to list projects'),
      response.status
    );
  }

  const items = Array.isArray(response.json?.items)
    ? (response.json.items as Array<{ metadata?: K8sMetadata; status?: { phase?: string } }>)
    : [];
  return items
    .map((item): OcpProject => ({
      name: item?.metadata?.name || '',
      displayName: item?.metadata?.annotations?.['openshift.io/display-name'] || undefined,
      status: item?.status?.phase || 'Active',
      createdAt: item?.metadata?.creationTimestamp,
    }))
    .filter((p: OcpProject) => Boolean(p.name))
    .sort((a: OcpProject, b: OcpProject) => a.name.localeCompare(b.name));
}

export function computePodStatus(pod: K8sRawPod): string {
  if (pod?.metadata?.deletionTimestamp) {
    return 'Terminating';
  }

  const initStatuses = Array.isArray(pod?.status?.initContainerStatuses)
    ? pod.status.initContainerStatuses
    : [];
  for (const cs of initStatuses) {
    if (cs?.state?.waiting?.reason) {
      return `Init:${cs.state.waiting.reason}`;
    }
    if (cs?.state?.terminated && cs.state.terminated.exitCode !== 0) {
      return `Init:${cs.state.terminated.reason || 'Error'}`;
    }
  }

  const statuses = Array.isArray(pod?.status?.containerStatuses)
    ? pod.status.containerStatuses
    : [];
  for (const cs of statuses) {
    if (cs?.state?.waiting?.reason) {
      return cs.state.waiting.reason;
    }
    if (cs?.state?.terminated?.reason && cs.state.terminated.reason !== 'Completed') {
      return cs.state.terminated.reason;
    }
  }

  return pod?.status?.phase || 'Unknown';
}

function mapPodItem(pod: K8sRawPod, fallbackNamespace: string): OcpPod {
  const containerSpecs = Array.isArray(pod?.spec?.containers)
    ? pod.spec.containers
    : [];
  const statuses = Array.isArray(pod?.status?.containerStatuses)
    ? pod.status.containerStatuses
    : [];

  const totalCount = containerSpecs.length || statuses.length;
  const readyCount = statuses.filter((s) => Boolean(s?.ready)).length;
  const restarts = statuses.reduce(
    (sum: number, s) => sum + (Number(s?.restartCount) || 0),
    0
  );

  return {
    name: pod?.metadata?.name || '',
    namespace: pod?.metadata?.namespace || fallbackNamespace,
    status: computePodStatus(pod),
    ready: `${readyCount}/${totalCount}`,
    readyCount,
    totalCount,
    restarts,
    podIP: pod?.status?.podIP || null,
    nodeName: pod?.spec?.nodeName || null,
    containers: containerSpecs
      .map((c) => c.name || '')
      .filter((name): name is string => Boolean(name)),
    age: formatK8sAge(pod?.metadata?.creationTimestamp),
    createdAt: pod?.metadata?.creationTimestamp,
  };
}

function mapDeploymentItem(
  item: K8sRawDeployment,
  kind: 'Deployment' | 'DeploymentConfig',
  fallbackNamespace: string
): OcpDeployment {
  const containers = Array.isArray(item?.spec?.template?.spec?.containers)
    ? item.spec.template.spec.containers
    : [];

  return {
    name: item?.metadata?.name || '',
    namespace: item?.metadata?.namespace || fallbackNamespace,
    kind,
    replicas: Number(item?.spec?.replicas ?? 0),
    readyReplicas: Number(item?.status?.readyReplicas ?? 0),
    availableReplicas: Number(item?.status?.availableReplicas ?? 0),
    images: containers
      .map((c) => c.image || '')
      .filter((img): img is string => Boolean(img)),
    age: formatK8sAge(item?.metadata?.creationTimestamp),
    createdAt: item?.metadata?.creationTimestamp,
  };
}

function mapConfigMapItem(
  cm: K8sRawConfigMap,
  fallbackNamespace: string
): OcpConfigMap {
  const data = cm?.data && typeof cm.data === 'object' ? { ...cm.data } : {};
  const binaryKeys =
    cm?.binaryData && typeof cm.binaryData === 'object'
      ? Object.keys(cm.binaryData)
      : [];

  return {
    name: cm?.metadata?.name || '',
    namespace: cm?.metadata?.namespace || fallbackNamespace,
    data,
    binaryKeys,
    keyCount: Object.keys(data).length + binaryKeys.length,
    immutable: Boolean(cm?.immutable),
    age: formatK8sAge(cm?.metadata?.creationTimestamp),
    createdAt: cm?.metadata?.creationTimestamp,
  };
}

/**
 * Lists Pods, Deployments, DeploymentConfigs, Services, Routes, and ConfigMaps in a namespace.
 */
export async function listWorkloads(
  clusterId: string,
  namespace: string
): Promise<OcpWorkloadsResponse> {
  if (!validateK8sName(namespace)) {
    throw new OcpClientError('Invalid namespace name', 400);
  }

  const ns = encodeURIComponent(namespace);
  const [podsRes, deployRes, dcRes, svcRes, routeRes, cmRes] =
    await Promise.allSettled([
      executeClusterApi(clusterId, `/api/v1/namespaces/${ns}/pods`),
      executeClusterApi(clusterId, `/apis/apps/v1/namespaces/${ns}/deployments`),
      executeClusterApi(
        clusterId,
        `/apis/apps.openshift.io/v1/namespaces/${ns}/deploymentconfigs`
      ),
      executeClusterApi(clusterId, `/api/v1/namespaces/${ns}/services`),
      executeClusterApi(
        clusterId,
        `/apis/route.openshift.io/v1/namespaces/${ns}/routes`
      ),
      executeClusterApi(clusterId, `/api/v1/namespaces/${ns}/configmaps`),
    ]);

  if (podsRes.status === 'rejected') {
    throw podsRes.reason;
  }
  if (podsRes.value.response.status >= 400) {
    throw new OcpClientError(
      extractApiError(podsRes.value.response, 'Failed to list pods'),
      podsRes.value.response.status
    );
  }

  const warnings: string[] = [];

  const podItems = Array.isArray(podsRes.value.response.json?.items)
    ? (podsRes.value.response.json.items as K8sRawPod[])
    : [];
  const pods: OcpPod[] = podItems.map((p) => mapPodItem(p, namespace));

  const deployments: OcpDeployment[] = [];
  if (deployRes.status === 'fulfilled' && deployRes.value.response.status === 200) {
    const items = Array.isArray(deployRes.value.response.json?.items)
      ? (deployRes.value.response.json.items as K8sRawDeployment[])
      : [];
    deployments.push(
      ...items.map((d) => mapDeploymentItem(d, 'Deployment', namespace))
    );
  } else {
    warnings.push('Unable to load Deployments');
  }

  if (dcRes.status === 'fulfilled' && dcRes.value.response.status === 200) {
    const items = Array.isArray(dcRes.value.response.json?.items)
      ? (dcRes.value.response.json.items as K8sRawDeployment[])
      : [];
    deployments.push(
      ...items.map((d) => mapDeploymentItem(d, 'DeploymentConfig', namespace))
    );
  }

  const services: OcpService[] = [];
  if (svcRes.status === 'fulfilled' && svcRes.value.response.status === 200) {
    const items = Array.isArray(svcRes.value.response.json?.items)
      ? (svcRes.value.response.json.items as K8sRawService[])
      : [];
    services.push(
      ...items.map((s): OcpService => {
        const portList = Array.isArray(s?.spec?.ports) ? s.spec.ports : [];
        return {
          name: s?.metadata?.name || '',
          namespace: s?.metadata?.namespace || namespace,
          type: s?.spec?.type || 'ClusterIP',
          clusterIP: s?.spec?.clusterIP || null,
          ports: portList.map(
            (p) =>
              `${p.port}${p.targetPort ? `->${p.targetPort}` : ''}/${p.protocol || 'TCP'}`
          ),
          age: formatK8sAge(s?.metadata?.creationTimestamp),
        };
      })
    );
  }

  const routes: OcpRoute[] = [];
  if (routeRes.status === 'fulfilled' && routeRes.value.response.status === 200) {
    const items = Array.isArray(routeRes.value.response.json?.items)
      ? (routeRes.value.response.json.items as K8sRawRoute[])
      : [];
    routes.push(
      ...items.map((r): OcpRoute => {
        const host = r?.spec?.host || '';
        const routePath = r?.spec?.path || '';
        const tls = Boolean(r?.spec?.tls);
        const scheme = tls ? 'https' : 'http';
        return {
          name: r?.metadata?.name || '',
          namespace: r?.metadata?.namespace || namespace,
          host,
          path: routePath,
          tls,
          targetService: r?.spec?.to?.name || '-',
          targetPort: String(r?.spec?.port?.targetPort ?? '-'),
          url: host ? `${scheme}://${host}${routePath}` : '',
          age: formatK8sAge(r?.metadata?.creationTimestamp),
        };
      })
    );
  }

  const configMaps: OcpConfigMap[] = [];
  if (cmRes.status === 'fulfilled' && cmRes.value.response.status === 200) {
    const items = Array.isArray(cmRes.value.response.json?.items)
      ? (cmRes.value.response.json.items as K8sRawConfigMap[])
      : [];
    configMaps.push(
      ...items
        .map((cm) => mapConfigMapItem(cm, namespace))
        .filter((cm) => Boolean(cm.name))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  } else {
    warnings.push('Unable to load ConfigMaps');
  }

  return {
    namespace,
    pods,
    deployments,
    services,
    routes,
    configMaps,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Fetches a single ConfigMap in a namespace.
 */
export async function getConfigMap(
  clusterId: string,
  namespace: string,
  name: string
): Promise<OcpConfigMap> {
  if (!validateK8sName(namespace) || !validateK8sName(name)) {
    throw new OcpClientError('Invalid namespace or ConfigMap name', 400);
  }

  const { response } = await executeClusterApi(
    clusterId,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`
  );

  if (response.status >= 400) {
    throw new OcpClientError(
      extractApiError(response, `Failed to fetch ConfigMap ${name}`),
      response.status
    );
  }

  return mapConfigMapItem((response.json || {}) as K8sRawConfigMap, namespace);
}

/**
 * Updates an existing ConfigMap's `data` map using GET + PUT with `resourceVersion`.
 */
export async function updateConfigMap(
  clusterId: string,
  namespace: string,
  name: string,
  data: Record<string, string>
): Promise<OcpConfigMap> {
  if (!validateK8sName(namespace) || !validateK8sName(name)) {
    throw new OcpClientError('Invalid namespace or ConfigMap name', 400);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new OcpClientError('ConfigMap data must be a key-value object', 400);
  }

  const sanitizedData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!validateConfigMapKey(key)) {
      throw new OcpClientError(
        `Invalid ConfigMap key "${key}": only alphanumeric characters, '-', '_', and '.' are allowed`,
        400
      );
    }
    if (typeof value !== 'string') {
      throw new OcpClientError(`Value for key "${key}" must be a string`, 400);
    }
    sanitizedData[key] = value;
  }

  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`;
  const { response: getRes } = await executeClusterApi(clusterId, path);

  if (getRes.status >= 400) {
    throw new OcpClientError(
      extractApiError(getRes, `Failed to load ConfigMap ${name}`),
      getRes.status
    );
  }

  const existing = (getRes.json || {}) as K8sRawConfigMap;
  if (existing.immutable) {
    throw new OcpClientError(
      `ConfigMap ${name} is immutable and cannot be edited`,
      422
    );
  }

  const updatedBody: K8sRawConfigMap = {
    ...existing,
    apiVersion: existing.apiVersion || 'v1',
    kind: existing.kind || 'ConfigMap',
    data: sanitizedData,
  };

  const { response: putRes } = await executeClusterApi(clusterId, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedBody),
  });

  if (putRes.status >= 400) {
    throw new OcpClientError(
      extractApiError(putRes, `Failed to update ConfigMap ${name}`),
      putRes.status
    );
  }

  return mapConfigMapItem((putRes.json || {}) as K8sRawConfigMap, namespace);
}

/**
 * Fetches snapshot logs for a pod container.
 */
export async function getPodLogs(
  clusterId: string,
  namespace: string,
  podName: string,
  container?: string,
  tailLines = 200
): Promise<string> {
  if (!validateK8sName(namespace) || !validateK8sName(podName)) {
    throw new OcpClientError('Invalid namespace or pod name', 400);
  }
  if (container && !validateK8sName(container)) {
    throw new OcpClientError('Invalid container name', 400);
  }

  const safeLines = Math.min(Math.max(1, Math.floor(tailLines)), 5000);
  const params = new URLSearchParams({
    tailLines: String(safeLines),
    timestamps: 'true',
  });
  if (container) {
    params.set('container', container);
  }

  const { response } = await executeClusterApi(
    clusterId,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${params.toString()}`,
    { headers: { Accept: 'application/json, */*' } }
  );

  if (response.status >= 400) {
    throw new OcpClientError(
      extractApiError(response, 'Failed to fetch pod logs'),
      response.status
    );
  }

  return response.text;
}

function getDescribeApiPath(
  kind: OcpDescribeKind,
  namespace: string,
  name: string
): string {
  const ns = encodeURIComponent(namespace);
  const resName = encodeURIComponent(name);

  switch (kind) {
    case 'Pod':
      return `/api/v1/namespaces/${ns}/pods/${resName}`;
    case 'Deployment':
      return `/apis/apps/v1/namespaces/${ns}/deployments/${resName}`;
    case 'DeploymentConfig':
      return `/apis/apps.openshift.io/v1/namespaces/${ns}/deploymentconfigs/${resName}`;
    case 'Service':
      return `/api/v1/namespaces/${ns}/services/${resName}`;
    case 'Route':
      return `/apis/route.openshift.io/v1/namespaces/${ns}/routes/${resName}`;
    case 'ConfigMap':
      return `/api/v1/namespaces/${ns}/configmaps/${resName}`;
  }
}

/**
 * Fetches detailed resource definition (without noisy managedFields) and related Events.
 */
export async function getResourceDescribe(
  clusterId: string,
  namespace: string,
  kind: OcpDescribeKind,
  name: string
): Promise<OcpDescribeResponse> {
  if (!validateK8sName(namespace) || !validateK8sName(name)) {
    throw new OcpClientError('Invalid namespace or resource name', 400);
  }

  const resourcePath = getDescribeApiPath(kind, namespace, name);
  const eventsPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/events?fieldSelector=${encodeURIComponent(`involvedObject.name=${name}`)}`;

  const [resourceRes, eventsRes] = await Promise.all([
    executeClusterApi(clusterId, resourcePath),
    executeClusterApi(clusterId, eventsPath).catch(() => null),
  ]);

  if (resourceRes.response.status >= 400) {
    throw new OcpClientError(
      extractApiError(resourceRes.response, `Failed to describe ${kind} ${name}`),
      resourceRes.response.status
    );
  }

  const rawResource = resourceRes.response.json || {};
  const cleanedResource: Record<string, unknown> = { ...rawResource };
  if (cleanedResource.metadata && typeof cleanedResource.metadata === 'object') {
    const metaCopy = { ...(cleanedResource.metadata as Record<string, unknown>) };
    delete metaCopy.managedFields;
    cleanedResource.metadata = metaCopy;
  }

  const rawEvents =
    eventsRes && eventsRes.response.status === 200 && Array.isArray(eventsRes.response.json?.items)
      ? (eventsRes.response.json.items as K8sRawEvent[])
      : [];

  const events: OcpEvent[] = rawEvents.map((ev) => ({
    type: ev?.type || 'Normal',
    reason: ev?.reason || '-',
    message: ev?.message || '',
    count: Number(ev?.count ?? 1),
    lastTimestamp: ev?.lastTimestamp || ev?.eventTime || ev?.metadata?.creationTimestamp || '',
    source: ev?.source?.component || ev?.reportingComponent || '-',
  }));

  return {
    kind,
    name,
    namespace,
    resource: cleanedResource,
    events,
  };
}

/**
 * Performs scale, rollout restart, or pod deletion operations.
 */
export async function performResourceAction(
  clusterId: string,
  payload: OcpActionPayload
): Promise<{ message: string }> {
  if (!validateK8sName(payload.namespace) || !validateK8sName(payload.name)) {
    throw new OcpClientError('Invalid namespace or resource name', 400);
  }

  const ns = encodeURIComponent(payload.namespace);
  const name = encodeURIComponent(payload.name);

  if (payload.action === 'delete-pod') {
    const { response } = await executeClusterApi(
      clusterId,
      `/api/v1/namespaces/${ns}/pods/${name}`,
      { method: 'DELETE' }
    );
    if (response.status >= 400) {
      throw new OcpClientError(
        extractApiError(response, `Failed to delete pod ${payload.name}`),
        response.status
      );
    }
    return { message: `Pod ${payload.name} deleted` };
  }

  const baseGroupPath =
    payload.kind === 'DeploymentConfig'
      ? `/apis/apps.openshift.io/v1/namespaces/${ns}/deploymentconfigs/${name}`
      : `/apis/apps/v1/namespaces/${ns}/deployments/${name}`;

  if (payload.action === 'scale') {
    if (!Number.isInteger(payload.replicas) || payload.replicas < 0 || payload.replicas > 50) {
      throw new OcpClientError('Replicas must be an integer between 0 and 50', 400);
    }

    const { response } = await executeClusterApi(clusterId, `${baseGroupPath}/scale`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ spec: { replicas: payload.replicas } }),
    });

    if (response.status >= 400) {
      throw new OcpClientError(
        extractApiError(response, `Failed to scale ${payload.kind} ${payload.name}`),
        response.status
      );
    }
    return {
      message: `Scaled ${payload.kind} ${payload.name} to ${payload.replicas} replica(s)`,
    };
  }

  if (payload.action === 'restart') {
    const { response } = await executeClusterApi(clusterId, baseGroupPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
              },
            },
          },
        },
      }),
    });

    if (response.status >= 400) {
      throw new OcpClientError(
        extractApiError(response, `Failed to restart ${payload.kind} ${payload.name}`),
        response.status
      );
    }
    return {
      message: `Triggered rollout restart for ${payload.kind} ${payload.name}`,
    };
  }

  throw new OcpClientError('Unsupported OCP action', 400);
}

export interface PodLogStreamHandle {
  close: () => void;
}

/**
 * Opens a live `follow=true` HTTPS stream for pod logs.
 */
export async function openPodLogStream(
  clusterId: string,
  namespace: string,
  podName: string,
  container: string | undefined,
  tailLines: number,
  callbacks: {
    onData: (chunk: string) => void;
    onError: (message: string) => void;
    onClose: () => void;
  }
): Promise<PodLogStreamHandle> {
  if (!validateK8sName(namespace) || !validateK8sName(podName)) {
    throw new OcpClientError('Invalid namespace or pod name', 400);
  }
  if (container && !validateK8sName(container)) {
    throw new OcpClientError('Invalid container name', 400);
  }

  const row = getOcpClusterRow(clusterId);
  if (!row) {
    throw new OcpClientError('OCP cluster not found', 404);
  }

  const token = await getClusterToken(row, false);
  const safeLines = Math.min(Math.max(1, Math.floor(tailLines || 200)), 2000);
  const params = new URLSearchParams({
    follow: 'true',
    timestamps: 'true',
    tailLines: String(safeLines),
  });
  if (container) params.set('container', container);

  const targetUrl = `${row.api_url}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${params.toString()}`;
  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  let closed = false;
  const req = transport.request(
    {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, */*',
      },
      ...(isHttps ? { rejectUnauthorized: row.insecure_tls !== 1 } : {}),
    },
    (res) => {
      if ((res.statusCode || 500) >= 400) {
        let errBody = '';
        res.on('data', (c: Buffer) => {
          errBody += c.toString('utf8');
        });
        res.on('end', () => {
          if (!closed) {
            closed = true;
            callbacks.onError(
              `Log stream failed (HTTP ${res.statusCode}): ${errBody.slice(0, 300)}`
            );
            callbacks.onClose();
          }
        });
        return;
      }

      res.on('data', (chunk: Buffer) => {
        if (!closed) {
          callbacks.onData(chunk.toString('utf8'));
        }
      });

      res.on('end', () => {
        if (!closed) {
          closed = true;
          callbacks.onClose();
        }
      });
    }
  );

  req.on('error', (err) => {
    if (!closed) {
      closed = true;
      callbacks.onError(`Log stream error: ${err.message}`);
      callbacks.onClose();
    }
  });

  req.end();

  return {
    close: () => {
      if (!closed) {
        closed = true;
        req.destroy();
      }
    },
  };
}

export interface PodExecSession {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

/**
 * Decodes a Kubernetes WebSocket exec frame (`v4.channel.k8s.io`).
 * Channel byte: 1 = stdout, 2 = stderr, 3 = error status.
 */
export function decodeK8sExecFrame(raw: Buffer | string): {
  channel: number;
  payload: string;
} | null {
  const buf = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  if (buf.length === 0) return null;
  const channel = buf[0];
  const payload = buf.subarray(1).toString('utf8');
  return { channel, payload };
}

/**
 * Opens an interactive pod exec WebSocket session (`v4.channel.k8s.io`).
 */
export async function openPodExecSession(
  clusterId: string,
  namespace: string,
  podName: string,
  container: string | undefined,
  shell: '/bin/sh' | '/bin/bash',
  cols: number,
  rows: number,
  callbacks: {
    onOpen?: () => void;
    onData: (data: string) => void;
    onError: (message: string) => void;
    onClose: () => void;
  }
): Promise<PodExecSession> {
  if (!validateK8sName(namespace) || !validateK8sName(podName)) {
    throw new OcpClientError('Invalid namespace or pod name', 400);
  }
  if (container && !validateK8sName(container)) {
    throw new OcpClientError('Invalid container name', 400);
  }

  const row = getOcpClusterRow(clusterId);
  if (!row) {
    throw new OcpClientError('OCP cluster not found', 404);
  }

  const token = await getClusterToken(row, false);
  const safeShell = shell === '/bin/bash' ? '/bin/bash' : '/bin/sh';

  const parsedApi = new URL(row.api_url);
  const wsScheme = parsedApi.protocol === 'http:' ? 'ws:' : 'wss:';
  const params = new URLSearchParams({
    stdin: 'true',
    stdout: 'true',
    stderr: 'true',
    tty: 'true',
    command: safeShell,
  });
  if (container) {
    params.set('container', container);
  }

  const execUrl = `${wsScheme}//${parsedApi.host}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${params.toString()}`;

  const ws = new WebSocket(execUrl, ['v4.channel.k8s.io'], {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    rejectUnauthorized: row.insecure_tls !== 1,
  });

  let closed = false;

  const sendResize = (w: number, h: number) => {
    if (ws.readyState === WebSocket.OPEN) {
      const resizeJson = JSON.stringify({
        Width: Math.max(10, Math.floor(w || 80)),
        Height: Math.max(4, Math.floor(h || 24)),
      });
      ws.send(Buffer.concat([Buffer.from([4]), Buffer.from(resizeJson, 'utf8')]));
    }
  };

  ws.on('open', () => {
    sendResize(cols, rows);
    callbacks.onOpen?.();
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    const buf = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.from(raw as ArrayBuffer);

    const frame = decodeK8sExecFrame(buf);
    if (!frame) return;

    if (frame.channel === 1 || frame.channel === 2) {
      if (frame.payload) {
        callbacks.onData(frame.payload);
      }
    } else if (frame.channel === 3 && frame.payload) {
      try {
        const statusObj = JSON.parse(frame.payload);
        if (statusObj.status && statusObj.status !== 'Success') {
          callbacks.onError(statusObj.message || 'Pod exec terminated with error');
        }
      } catch {
        callbacks.onError(frame.payload);
      }
    }
  });

  ws.on('error', (err) => {
    if (!closed) {
      callbacks.onError(`Pod exec connection error: ${err.message}`);
    }
  });

  ws.on('unexpected-response', (_req, res) => {
    if (!closed) {
      callbacks.onError(`Pod exec rejected by cluster (HTTP ${res.statusCode})`);
      closed = true;
      callbacks.onClose();
    }
  });

  ws.on('close', () => {
    if (!closed) {
      closed = true;
      callbacks.onClose();
    }
  });

  return {
    write: (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.concat([Buffer.from([0]), Buffer.from(data, 'utf8')]));
      }
    },
    resize: (newCols: number, newRows: number) => {
      sendResize(newCols, newRows);
    },
    close: () => {
      if (!closed) {
        closed = true;
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      }
    },
  };
}
