import { NextResponse } from 'next/server';
import { HttpClientError } from '@/lib/http/native-http';
import { normalizeSecurityBaseUrl } from './security-urls';
import type {
  CreateSecurityConnectionInput,
  SecurityAuthType,
  SecurityProvider,
  UpdateSecurityConnectionInput,
} from './types';

const VALID_PROVIDERS: SecurityProvider[] = ['sonarqube', 'cxsast', 'cxsca'];

export function handleSecurityApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof HttpClientError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ error: message || fallbackMessage }, { status: 500 });
}

export function validateCreateSecurityBody(body: unknown): {
  valid: boolean;
  error?: string;
  data?: CreateSecurityConnectionInput;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const raw = body as Record<string, unknown>;
  const provider = raw.provider as SecurityProvider;
  if (!VALID_PROVIDERS.includes(provider)) {
    return {
      valid: false,
      error: 'provider must be one of: sonarqube, cxsast, cxsca',
    };
  }

  if (!raw.label || typeof raw.label !== 'string' || !raw.label.trim()) {
    return { valid: false, error: 'label is required' };
  }
  if (!raw.baseUrl || typeof raw.baseUrl !== 'string' || !raw.baseUrl.trim()) {
    return { valid: false, error: 'baseUrl is required' };
  }

  try {
    normalizeSecurityBaseUrl(provider, raw.baseUrl);
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid baseUrl',
    };
  }

  const authType = raw.authType as SecurityAuthType;
  if (authType !== 'password' && authType !== 'token') {
    return { valid: false, error: 'authType must be password or token' };
  }

  if (provider === 'cxsca' && authType === 'password') {
    if (
      !raw.tenantAccount ||
      typeof raw.tenantAccount !== 'string' ||
      !raw.tenantAccount.trim()
    ) {
      return {
        valid: false,
        error: 'tenantAccount is required for Checkmarx SCA password login',
      };
    }
  }

  if (authType === 'password') {
    if (!raw.username || typeof raw.username !== 'string' || !raw.username.trim()) {
      return { valid: false, error: 'username is required for password login' };
    }
  }

  if (!raw.secret || typeof raw.secret !== 'string' || !raw.secret.trim()) {
    return {
      valid: false,
      error: authType === 'token' ? 'token is required' : 'password is required',
    };
  }

  return {
    valid: true,
    data: {
      provider,
      label: raw.label,
      baseUrl: raw.baseUrl,
      authType,
      tenantAccount:
        typeof raw.tenantAccount === 'string' ? raw.tenantAccount : undefined,
      username: typeof raw.username === 'string' ? raw.username : undefined,
      clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
      clientSecret:
        typeof raw.clientSecret === 'string' ? raw.clientSecret : undefined,
      secret: raw.secret,
      insecureTls: raw.insecureTls === undefined ? true : Boolean(raw.insecureTls),
    },
  };
}

export function validateUpdateSecurityBody(
  provider: SecurityProvider,
  body: unknown
): {
  valid: boolean;
  error?: string;
  data?: UpdateSecurityConnectionInput;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const raw = body as Record<string, unknown>;
  const data: UpdateSecurityConnectionInput = {};

  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string' || !raw.label.trim()) {
      return { valid: false, error: 'label must be a non-empty string' };
    }
    data.label = raw.label;
  }

  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string') {
      return { valid: false, error: 'baseUrl must be a string' };
    }
    try {
      normalizeSecurityBaseUrl(provider, raw.baseUrl);
      data.baseUrl = raw.baseUrl;
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid baseUrl',
      };
    }
  }

  if (raw.authType !== undefined) {
    if (raw.authType !== 'password' && raw.authType !== 'token') {
      return { valid: false, error: 'authType must be password or token' };
    }
    data.authType = raw.authType;
  }

  if (raw.tenantAccount !== undefined) {
    if (raw.tenantAccount !== null && typeof raw.tenantAccount !== 'string') {
      return { valid: false, error: 'tenantAccount must be a string or null' };
    }
    data.tenantAccount = raw.tenantAccount;
  }

  if (raw.username !== undefined) {
    if (raw.username !== null && typeof raw.username !== 'string') {
      return { valid: false, error: 'username must be a string or null' };
    }
    data.username = raw.username;
  }

  if (raw.clientId !== undefined) {
    if (raw.clientId !== null && typeof raw.clientId !== 'string') {
      return { valid: false, error: 'clientId must be a string or null' };
    }
    data.clientId = raw.clientId;
  }

  if (raw.clientSecret !== undefined) {
    if (raw.clientSecret !== null && typeof raw.clientSecret !== 'string') {
      return { valid: false, error: 'clientSecret must be a string or null' };
    }
    data.clientSecret = raw.clientSecret;
  }

  if (raw.secret !== undefined) {
    if (typeof raw.secret !== 'string') {
      return { valid: false, error: 'secret must be a string' };
    }
    if (raw.secret.trim().length > 0) {
      data.secret = raw.secret;
    }
  }

  if (raw.insecureTls !== undefined) {
    data.insecureTls = Boolean(raw.insecureTls);
  }

  return { valid: true, data };
}
