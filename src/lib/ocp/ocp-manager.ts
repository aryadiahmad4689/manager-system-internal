import crypto from 'crypto';
import { getDb } from '../db';
import { decrypt, encrypt } from '../crypto/credential-store';
import { deriveApiUrlFromConsoleUrl, normalizeHttpUrl, sanitizeOcpInput } from './ocp-urls';
import type {
  CreateOcpClusterInput,
  OcpAuthType,
  OcpClusterPublic,
  UpdateOcpClusterInput,
} from './types';

export interface OcpClusterRow {
  id: string;
  label: string;
  console_url: string;
  api_url: string;
  auth_type: OcpAuthType;
  username: string | null;
  encrypted_secret: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  encrypted_token: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  token_expires_at: string | null;
  default_namespace: string | null;
  insecure_tls: number;
  created_at: string;
  updated_at: string;
}

function rowToPublic(row: OcpClusterRow): OcpClusterPublic {
  return {
    id: row.id,
    label: row.label,
    consoleUrl: row.console_url,
    apiUrl: row.api_url,
    authType: row.auth_type,
    username: row.username,
    defaultNamespace: row.default_namespace,
    insecureTls: row.insecure_tls === 1,
    hasCachedToken: Boolean(row.encrypted_token),
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listOcpClusters(): OcpClusterPublic[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM ocp_clusters ORDER BY created_at DESC')
    .all() as OcpClusterRow[];
  return rows.map(rowToPublic);
}

export function getOcpClusterPublic(id: string): OcpClusterPublic | null {
  const row = getOcpClusterRow(id);
  return row ? rowToPublic(row) : null;
}

export function getOcpClusterRow(id: string): OcpClusterRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM ocp_clusters WHERE id = ?')
    .get(id) as OcpClusterRow | undefined;
  return row ?? null;
}

export function decryptClusterSecret(row: OcpClusterRow): string {
  return decrypt({
    ciphertext: row.encrypted_secret,
    iv: row.encryption_iv,
    authTag: row.encryption_auth_tag,
  });
}

export function decryptClusterCachedToken(row: OcpClusterRow): string | null {
  if (!row.encrypted_token || !row.token_iv || !row.token_auth_tag) {
    return null;
  }
  return decrypt({
    ciphertext: row.encrypted_token,
    iv: row.token_iv,
    authTag: row.token_auth_tag,
  });
}

export function createOcpCluster(input: CreateOcpClusterInput): OcpClusterPublic {
  const db = getDb();
  const label = sanitizeOcpInput(input.label);
  const consoleUrl = normalizeHttpUrl(input.consoleUrl);
  const apiUrl = input.apiUrl
    ? normalizeHttpUrl(input.apiUrl)
    : deriveApiUrlFromConsoleUrl(consoleUrl);
  const authType: OcpAuthType = input.authType;
  const username =
    authType === 'oauth_password' && input.username
      ? sanitizeOcpInput(input.username)
      : null;
  const defaultNamespace = input.defaultNamespace
    ? sanitizeOcpInput(input.defaultNamespace)
    : null;
  const insecureTls = input.insecureTls === false ? 0 : 1;

  const encrypted = encrypt(input.secret);
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  db.prepare(
    `INSERT INTO ocp_clusters (
      id, label, console_url, api_url, auth_type, username,
      encrypted_secret, encryption_iv, encryption_auth_tag,
      default_namespace, insecure_tls, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    label,
    consoleUrl,
    apiUrl,
    authType,
    username,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.authTag,
    defaultNamespace,
    insecureTls,
    now,
    now
  );

  const created = getOcpClusterPublic(id);
  if (!created) {
    throw new Error('Failed to load newly created OCP cluster');
  }
  return created;
}

export function updateOcpCluster(
  id: string,
  input: UpdateOcpClusterInput
): OcpClusterPublic | null {
  const existing = getOcpClusterRow(id);
  if (!existing) return null;

  const setClauses: string[] = [];
  const values: Array<string | number | null> = [];
  let shouldClearCachedToken = false;

  if (input.label !== undefined) {
    setClauses.push('label = ?');
    values.push(sanitizeOcpInput(input.label));
  }

  if (input.consoleUrl !== undefined) {
    setClauses.push('console_url = ?');
    values.push(normalizeHttpUrl(input.consoleUrl));
  }

  if (input.apiUrl !== undefined) {
    setClauses.push('api_url = ?');
    values.push(normalizeHttpUrl(input.apiUrl));
    shouldClearCachedToken = true;
  }

  if (input.authType !== undefined) {
    setClauses.push('auth_type = ?');
    values.push(input.authType);
    shouldClearCachedToken = true;
  }

  if (input.username !== undefined) {
    setClauses.push('username = ?');
    values.push(input.username ? sanitizeOcpInput(input.username) : null);
    shouldClearCachedToken = true;
  }

  if (input.secret !== undefined && input.secret.length > 0) {
    const encrypted = encrypt(input.secret);
    setClauses.push(
      'encrypted_secret = ?',
      'encryption_iv = ?',
      'encryption_auth_tag = ?'
    );
    values.push(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
    shouldClearCachedToken = true;
  }

  if (input.defaultNamespace !== undefined) {
    setClauses.push('default_namespace = ?');
    values.push(
      input.defaultNamespace ? sanitizeOcpInput(input.defaultNamespace) : null
    );
  }

  if (input.insecureTls !== undefined) {
    setClauses.push('insecure_tls = ?');
    values.push(input.insecureTls ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return rowToPublic(existing);
  }

  if (shouldClearCachedToken) {
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
  db.prepare(`UPDATE ocp_clusters SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...values
  );

  return getOcpClusterPublic(id);
}

export function deleteOcpCluster(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM ocp_clusters WHERE id = ?').run(id);
  return result.changes > 0;
}

export function cacheClusterOAuthToken(
  id: string,
  accessToken: string,
  expiresInSeconds: number
): void {
  const db = getDb();
  const encrypted = encrypt(accessToken);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  db.prepare(
    `UPDATE ocp_clusters
     SET encrypted_token = ?, token_iv = ?, token_auth_tag = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(encrypted.ciphertext, encrypted.iv, encrypted.authTag, expiresAt, id);
}

export function clearClusterOAuthToken(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE ocp_clusters
     SET encrypted_token = NULL, token_iv = NULL, token_auth_tag = NULL, token_expires_at = NULL
     WHERE id = ?`
  ).run(id);
}
