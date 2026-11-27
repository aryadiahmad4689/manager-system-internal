import crypto from 'crypto';
import { getDb } from '../db';
import { decrypt, encrypt } from '../crypto/credential-store';
import { normalizeSecurityBaseUrl, sanitizeSecurityInput } from './security-urls';
import type {
  CreateSecurityConnectionInput,
  SecurityAuthType,
  SecurityConnectionPublic,
  SecurityProvider,
  UpdateSecurityConnectionInput,
} from './types';

export interface SecurityConnectionRow {
  id: string;
  provider: SecurityProvider;
  label: string;
  base_url: string;
  auth_type: SecurityAuthType;
  tenant_account: string | null;
  username: string | null;
  client_id: string | null;
  encrypted_client_secret: string | null;
  client_secret_iv: string | null;
  client_secret_auth_tag: string | null;
  encrypted_secret: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  encrypted_token: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  token_expires_at: string | null;
  insecure_tls: number;
  created_at: string;
  updated_at: string;
}

function rowToPublic(row: SecurityConnectionRow): SecurityConnectionPublic {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    authType: row.auth_type,
    tenantAccount: row.tenant_account,
    username: row.username,
    clientId: row.client_id,
    hasClientSecret: Boolean(row.encrypted_client_secret),
    insecureTls: row.insecure_tls === 1,
    hasCachedToken: Boolean(row.encrypted_token),
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSecurityConnections(): SecurityConnectionPublic[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM security_connections ORDER BY created_at DESC')
    .all() as SecurityConnectionRow[];
  return rows.map(rowToPublic);
}

export function getSecurityConnectionPublic(
  id: string
): SecurityConnectionPublic | null {
  const row = getSecurityConnectionRow(id);
  return row ? rowToPublic(row) : null;
}

export function getSecurityConnectionRow(id: string): SecurityConnectionRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM security_connections WHERE id = ?')
    .get(id) as SecurityConnectionRow | undefined;
  return row ?? null;
}

export function decryptSecuritySecret(row: SecurityConnectionRow): string {
  return decrypt({
    ciphertext: row.encrypted_secret,
    iv: row.encryption_iv,
    authTag: row.encryption_auth_tag,
  });
}

export function decryptSecurityClientSecret(
  row: SecurityConnectionRow
): string | null {
  if (
    !row.encrypted_client_secret ||
    !row.client_secret_iv ||
    !row.client_secret_auth_tag
  ) {
    return null;
  }
  return decrypt({
    ciphertext: row.encrypted_client_secret,
    iv: row.client_secret_iv,
    authTag: row.client_secret_auth_tag,
  });
}

export function decryptSecurityCachedToken(
  row: SecurityConnectionRow
): string | null {
  if (!row.encrypted_token || !row.token_iv || !row.token_auth_tag) {
    return null;
  }
  return decrypt({
    ciphertext: row.encrypted_token,
    iv: row.token_iv,
    authTag: row.token_auth_tag,
  });
}

export function createSecurityConnection(
  input: CreateSecurityConnectionInput
): SecurityConnectionPublic {
  const db = getDb();
  const label = sanitizeSecurityInput(input.label);
  const baseUrl = normalizeSecurityBaseUrl(input.provider, input.baseUrl);
  const authType: SecurityAuthType = input.authType;
  const tenantAccount =
    input.provider === 'cxsca' && input.tenantAccount
      ? sanitizeSecurityInput(input.tenantAccount)
      : null;
  const username =
    authType === 'password' && input.username
      ? sanitizeSecurityInput(input.username)
      : null;
  const clientId =
    input.provider === 'cxsast' && input.clientId
      ? sanitizeSecurityInput(input.clientId)
      : null;

  const encryptedSecret = encrypt(input.secret);
  const encryptedClientSecret =
    input.provider === 'cxsast' && input.clientSecret?.trim()
      ? encrypt(input.clientSecret.trim())
      : null;

  const insecureTls = input.insecureTls === false ? 0 : 1;
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  db.prepare(
    `INSERT INTO security_connections (
      id, provider, label, base_url, auth_type, tenant_account, username,
      client_id, encrypted_client_secret, client_secret_iv, client_secret_auth_tag,
      encrypted_secret, encryption_iv, encryption_auth_tag,
      insecure_tls, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.provider,
    label,
    baseUrl,
    authType,
    tenantAccount,
    username,
    clientId,
    encryptedClientSecret?.ciphertext ?? null,
    encryptedClientSecret?.iv ?? null,
    encryptedClientSecret?.authTag ?? null,
    encryptedSecret.ciphertext,
    encryptedSecret.iv,
    encryptedSecret.authTag,
    insecureTls,
    now,
    now
  );

  const created = getSecurityConnectionPublic(id);
  if (!created) {
    throw new Error('Failed to load newly created security connection');
  }
  return created;
}

export function updateSecurityConnection(
  id: string,
  input: UpdateSecurityConnectionInput
): SecurityConnectionPublic | null {
  const existing = getSecurityConnectionRow(id);
  if (!existing) return null;

  const setClauses: string[] = [];
  const values: Array<string | number | null> = [];
  let shouldClearToken = false;

  if (input.label !== undefined) {
    setClauses.push('label = ?');
    values.push(sanitizeSecurityInput(input.label));
  }

  if (input.baseUrl !== undefined) {
    setClauses.push('base_url = ?');
    values.push(normalizeSecurityBaseUrl(existing.provider, input.baseUrl));
    shouldClearToken = true;
  }

  if (input.authType !== undefined) {
    setClauses.push('auth_type = ?');
    values.push(input.authType);
    shouldClearToken = true;
  }

  if (input.tenantAccount !== undefined) {
    setClauses.push('tenant_account = ?');
    values.push(
      input.tenantAccount ? sanitizeSecurityInput(input.tenantAccount) : null
    );
    shouldClearToken = true;
  }

  if (input.username !== undefined) {
    setClauses.push('username = ?');
    values.push(input.username ? sanitizeSecurityInput(input.username) : null);
    shouldClearToken = true;
  }

  if (input.clientId !== undefined) {
    setClauses.push('client_id = ?');
    values.push(input.clientId ? sanitizeSecurityInput(input.clientId) : null);
    shouldClearToken = true;
  }

  if (input.clientSecret !== undefined) {
    if (input.clientSecret === null || input.clientSecret === '') {
      setClauses.push(
        'encrypted_client_secret = NULL',
        'client_secret_iv = NULL',
        'client_secret_auth_tag = NULL'
      );
    } else {
      const enc = encrypt(input.clientSecret);
      setClauses.push(
        'encrypted_client_secret = ?',
        'client_secret_iv = ?',
        'client_secret_auth_tag = ?'
      );
      values.push(enc.ciphertext, enc.iv, enc.authTag);
    }
    shouldClearToken = true;
  }

  if (input.secret !== undefined && input.secret.length > 0) {
    const enc = encrypt(input.secret);
    setClauses.push(
      'encrypted_secret = ?',
      'encryption_iv = ?',
      'encryption_auth_tag = ?'
    );
    values.push(enc.ciphertext, enc.iv, enc.authTag);
    shouldClearToken = true;
  }

  if (input.insecureTls !== undefined) {
    setClauses.push('insecure_tls = ?');
    values.push(input.insecureTls ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return rowToPublic(existing);
  }

  if (shouldClearToken) {
    setClauses.push(
      'encrypted_token = NULL',
      'token_iv = NULL',
      'token_auth_tag = NULL',
      'token_expires_at = NULL'
    );
  }

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const db = getDb();
  db.prepare(
    `UPDATE security_connections SET ${setClauses.join(', ')} WHERE id = ?`
  ).run(...values);

  return getSecurityConnectionPublic(id);
}

export function deleteSecurityConnection(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM security_connections WHERE id = ?').run(id);
  return res.changes > 0;
}

export function cacheSecurityToken(
  id: string,
  token: string,
  expiresInSeconds: number
): void {
  const db = getDb();
  const enc = encrypt(token);
  const expiresAt = new Date(
    Date.now() + Math.max(60, expiresInSeconds) * 1000
  ).toISOString();

  db.prepare(
    `UPDATE security_connections
     SET encrypted_token = ?, token_iv = ?, token_auth_tag = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(enc.ciphertext, enc.iv, enc.authTag, expiresAt, id);
}

export function clearSecurityToken(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE security_connections
     SET encrypted_token = NULL, token_iv = NULL, token_auth_tag = NULL, token_expires_at = NULL
     WHERE id = ?`
  ).run(id);
}
