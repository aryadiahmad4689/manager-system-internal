/**
 * Sanitizes a string by trimming whitespace and removing control characters.
 */
export function sanitizeOcpInput(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.trim().replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Normalizes and validates an HTTP/HTTPS URL for OpenShift endpoints.
 * Strips trailing slashes and rejects non-HTTP(S) schemes.
 */
export function normalizeHttpUrl(rawUrl: string): string {
  const cleaned = sanitizeOcpInput(rawUrl);
  if (!cleaned) {
    throw new Error('URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL must start with https:// or http://');
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${normalizedPath === '/' ? '' : normalizedPath}`;
}

/**
 * Derives the standard OpenShift 4 API URL (`https://api.<domain>:6443`)
 * from a console URL (`https://console-openshift-console.apps.<domain>`).
 */
export function deriveApiUrlFromConsoleUrl(consoleUrl: string): string {
  const normalized = normalizeHttpUrl(consoleUrl);
  const parsed = new URL(normalized);
  const host = parsed.hostname;

  const consolePrefixes = [
    'console-openshift-console.apps.',
    'console.apps.',
  ];

  for (const prefix of consolePrefixes) {
    if (host.startsWith(prefix)) {
      const clusterDomain = host.slice(prefix.length);
      if (clusterDomain) {
        return `https://api.${clusterDomain}:6443`;
      }
    }
  }

  if (host.startsWith('api.')) {
    return parsed.port ? `${parsed.protocol}//${parsed.host}` : `https://${host}:6443`;
  }

  const parts = host.split('.');
  if (parts.length >= 3 && parts[1] === 'apps') {
    const clusterDomain = parts.slice(2).join('.');
    return `https://api.${clusterDomain}:6443`;
  }

  return parsed.port ? `${parsed.protocol}//${parsed.host}` : `https://${host}:6443`;
}

/**
 * Validates Kubernetes / OpenShift resource names (namespaces, pods, deployments, containers)
 * to prevent path traversal or query injection when composing API paths.
 */
export function validateK8sName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 253 || name.includes('..')) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

/**
 * Validates a Kubernetes ConfigMap data key (`[-._a-zA-Z0-9]+`, max 253 chars).
 */
export function validateConfigMapKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.length > 253) return false;
  return /^[-._a-zA-Z0-9]+$/.test(key);
}

/**
 * Parses `access_token`, `expires_in`, and `token_type` from an OpenShift OAuth
 * implicit redirect Location header (`...#access_token=sha256~...&expires_in=86400`).
 */
export function parseOAuthTokenFromLocation(locationHeader: string): {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
} | null {
  if (!locationHeader) return null;

  const hashIdx = locationHeader.indexOf('#');
  const queryIdx = locationHeader.indexOf('?');
  const paramStr =
    hashIdx >= 0
      ? locationHeader.slice(hashIdx + 1)
      : queryIdx >= 0
      ? locationHeader.slice(queryIdx + 1)
      : '';

  if (!paramStr) return null;

  const params = new URLSearchParams(paramStr);
  const accessToken = params.get('access_token');
  if (!accessToken) return null;

  const expiresRaw = Number(params.get('expires_in') || '86400');
  const expiresIn = Number.isFinite(expiresRaw) && expiresRaw > 0 ? expiresRaw : 86400;
  const tokenType = params.get('token_type') || 'Bearer';

  return { accessToken, expiresIn, tokenType };
}

/**
 * Formats an ISO timestamp into a compact human-readable age string (e.g. "3d", "5h", "12m").
 */
export function formatK8sAge(createdTimestamp?: string): string {
  if (!createdTimestamp) return '-';
  const createdMs = Date.parse(createdTimestamp);
  if (Number.isNaN(createdMs)) return '-';

  const diffSec = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 48) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}
