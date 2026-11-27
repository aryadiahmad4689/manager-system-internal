import type { SecurityProvider } from './types';

export function sanitizeSecurityInput(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.trim().replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Normalizes a pasted portal/login URL into its clean base origin (and optional subpath).
 * Strips login/callback paths such as:
 * - `/sessions/new?return_to=...` (SonarQube)
 * - `/CxRestAPI/auth/...` or `/CxWebClient/...` (Checkmarx SAST)
 */
export function normalizeSecurityBaseUrl(
  provider: SecurityProvider,
  rawUrl: string
): string {
  const cleaned = sanitizeSecurityInput(rawUrl);
  if (!cleaned) {
    throw new Error('Base URL is required');
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

  const origin = `${parsed.protocol}//${parsed.host}`;
  const lowerPath = parsed.pathname.toLowerCase();

  if (provider === 'sonarqube') {
    if (
      lowerPath === '/' ||
      lowerPath.startsWith('/sessions') ||
      lowerPath.startsWith('/projects') ||
      lowerPath.startsWith('/dashboard')
    ) {
      return origin;
    }
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    return `${origin}${trimmedPath}`;
  }

  if (provider === 'cxsast') {
    if (
      lowerPath === '/' ||
      lowerPath.startsWith('/cxrestapi') ||
      lowerPath.startsWith('/cxwebclient') ||
      lowerPath.startsWith('/cxwebinterface')
    ) {
      return origin;
    }
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    return `${origin}${trimmedPath}`;
  }

  // Checkmarx SCA portal URL is always origin-rooted
  return origin;
}

/**
 * Derives Checkmarx SCA Identity (`platform.checkmarx.net`) and API (`api-sca.checkmarx.net`)
 * base URLs from the portal URL (e.g. `https://eu.sca.checkmarx.net`).
 */
export function deriveCxScaEndpoints(portalBaseUrl: string): {
  portalUrl: string;
  identityUrl: string;
  apiUrl: string;
} {
  const portalUrl = normalizeSecurityBaseUrl('cxsca', portalBaseUrl);
  const parsed = new URL(portalUrl);
  const host = parsed.hostname.toLowerCase();

  if (host === 'eu.sca.checkmarx.net') {
    return {
      portalUrl,
      identityUrl: 'https://eu.platform.checkmarx.net',
      apiUrl: 'https://eu.api-sca.checkmarx.net',
    };
  }

  if (host === 'sca.checkmarx.net' || host === 'us.sca.checkmarx.net') {
    return {
      portalUrl,
      identityUrl: 'https://platform.checkmarx.net',
      apiUrl: 'https://api-sca.checkmarx.net',
    };
  }

  if (host.includes('.sca.checkmarx.net')) {
    const region = host.split('.sca.checkmarx.net')[0];
    return {
      portalUrl,
      identityUrl: `https://${region}.platform.checkmarx.net`,
      apiUrl: `https://${region}.api-sca.checkmarx.net`,
    };
  }

  return {
    portalUrl,
    identityUrl: portalUrl,
    apiUrl: portalUrl,
  };
}
