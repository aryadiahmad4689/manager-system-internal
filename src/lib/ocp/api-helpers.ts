import { NextResponse } from 'next/server';
import { OcpClientError } from './ocp-client';
import { normalizeHttpUrl } from './ocp-urls';
import type { CreateOcpClusterInput, OcpAuthType, UpdateOcpClusterInput } from './types';

export function handleOcpApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof OcpClientError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ error: message || fallbackMessage }, { status: 500 });
}

export function validateClusterCreatePayload(body: unknown): {
  valid: boolean;
  error?: string;
  data?: CreateOcpClusterInput;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const raw = body as Record<string, unknown>;
  if (!raw.label || typeof raw.label !== 'string' || !raw.label.trim()) {
    return { valid: false, error: 'label is required' };
  }
  if (!raw.consoleUrl || typeof raw.consoleUrl !== 'string' || !raw.consoleUrl.trim()) {
    return { valid: false, error: 'consoleUrl is required' };
  }

  try {
    normalizeHttpUrl(raw.consoleUrl);
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? `consoleUrl: ${err.message}` : 'Invalid consoleUrl',
    };
  }

  if (raw.apiUrl !== undefined && raw.apiUrl !== null && String(raw.apiUrl).trim() !== '') {
    if (typeof raw.apiUrl !== 'string') {
      return { valid: false, error: 'apiUrl must be a string' };
    }
    try {
      normalizeHttpUrl(raw.apiUrl);
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? `apiUrl: ${err.message}` : 'Invalid apiUrl',
      };
    }
  }

  const authType = raw.authType as OcpAuthType;
  if (authType !== 'oauth_password' && authType !== 'token') {
    return { valid: false, error: 'authType must be oauth_password or token' };
  }

  if (authType === 'oauth_password') {
    if (!raw.username || typeof raw.username !== 'string' || !raw.username.trim()) {
      return { valid: false, error: 'username is required for oauth_password auth' };
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
      label: raw.label,
      consoleUrl: raw.consoleUrl,
      apiUrl: raw.apiUrl ? String(raw.apiUrl) : undefined,
      authType,
      username: typeof raw.username === 'string' ? raw.username : undefined,
      secret: raw.secret,
      defaultNamespace:
        typeof raw.defaultNamespace === 'string' ? raw.defaultNamespace : undefined,
      insecureTls: raw.insecureTls === undefined ? true : Boolean(raw.insecureTls),
    },
  };
}

export function validateClusterUpdatePayload(body: unknown): {
  valid: boolean;
  error?: string;
  data?: UpdateOcpClusterInput;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const raw = body as Record<string, unknown>;
  const data: UpdateOcpClusterInput = {};

  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string' || !raw.label.trim()) {
      return { valid: false, error: 'label must be a non-empty string' };
    }
    data.label = raw.label;
  }

  if (raw.consoleUrl !== undefined) {
    if (typeof raw.consoleUrl !== 'string') {
      return { valid: false, error: 'consoleUrl must be a string' };
    }
    try {
      normalizeHttpUrl(raw.consoleUrl);
      data.consoleUrl = raw.consoleUrl;
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid consoleUrl',
      };
    }
  }

  if (raw.apiUrl !== undefined) {
    if (typeof raw.apiUrl !== 'string') {
      return { valid: false, error: 'apiUrl must be a string' };
    }
    try {
      normalizeHttpUrl(raw.apiUrl);
      data.apiUrl = raw.apiUrl;
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid apiUrl',
      };
    }
  }

  if (raw.authType !== undefined) {
    if (raw.authType !== 'oauth_password' && raw.authType !== 'token') {
      return { valid: false, error: 'authType must be oauth_password or token' };
    }
    data.authType = raw.authType;
  }

  if (raw.username !== undefined) {
    if (raw.username !== null && typeof raw.username !== 'string') {
      return { valid: false, error: 'username must be a string or null' };
    }
    data.username = raw.username;
  }

  if (raw.secret !== undefined) {
    if (typeof raw.secret !== 'string') {
      return { valid: false, error: 'secret must be a string' };
    }
    if (raw.secret.trim().length > 0) {
      data.secret = raw.secret;
    }
  }

  if (raw.defaultNamespace !== undefined) {
    if (raw.defaultNamespace !== null && typeof raw.defaultNamespace !== 'string') {
      return { valid: false, error: 'defaultNamespace must be a string or null' };
    }
    data.defaultNamespace = raw.defaultNamespace;
  }

  if (raw.insecureTls !== undefined) {
    data.insecureTls = Boolean(raw.insecureTls);
  }

  return { valid: true, data };
}
