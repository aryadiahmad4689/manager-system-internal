import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createDb } from '@/lib/db';

const mockGetDb = vi.fn();

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    getDb: () => mockGetDb(),
  };
});

import {
  cacheClusterOAuthToken,
  createOcpCluster,
  decryptClusterCachedToken,
  decryptClusterSecret,
  deleteOcpCluster,
  getOcpClusterPublic,
  getOcpClusterRow,
  listOcpClusters,
  updateOcpCluster,
} from '@/lib/ocp/ocp-manager';

const TEST_DB_DIR = path.resolve(process.cwd(), 'data', 'test');

describe('OCP Cluster Manager', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    dbPath = path.join(
      TEST_DB_DIR,
      `ocp-manager-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = createDb(dbPath);
    mockGetDb.mockReturnValue(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    for (const suffix of ['', '-shm', '-wal']) {
      if (fs.existsSync(dbPath + suffix)) {
        try {
          fs.unlinkSync(dbPath + suffix);
        } catch {
          // ignore
        }
      }
    }
  });

  it('creates an OCP cluster with encrypted secret and auto-derived apiUrl', () => {
    const created = createOcpCluster({
      label: 'OCP New Dev',
      consoleUrl: 'https://console-openshift-console.apps.ocp-new-dev.bri.co.id/',
      authType: 'oauth_password',
      username: 'brimo',
      secret: 'secret-pass',
      defaultNamespace: 'brimo-dev',
      insecureTls: true,
    });

    expect(created.label).toBe('OCP New Dev');
    expect(created.consoleUrl).toBe(
      'https://console-openshift-console.apps.ocp-new-dev.bri.co.id'
    );
    expect(created.apiUrl).toBe('https://api.ocp-new-dev.bri.co.id:6443');
    expect(created.username).toBe('brimo');
    expect((created as any).secret).toBeUndefined();
    expect((created as any).encrypted_secret).toBeUndefined();

    const row = getOcpClusterRow(created.id)!;
    expect(row.encrypted_secret).not.toBe('secret-pass');
    expect(decryptClusterSecret(row)).toBe('secret-pass');
  });

  it('lists clusters without exposing encrypted secrets', () => {
    createOcpCluster({
      label: 'Cluster A',
      consoleUrl: 'https://console-openshift-console.apps.a.bri.co.id/',
      authType: 'token',
      secret: 'sha256~tok',
    });

    const list = listOcpClusters();
    expect(list).toHaveLength(1);
    expect(list[0].authType).toBe('token');
    expect(list[0].username).toBeNull();
  });

  it('caches and clears OAuth token when secret updates', () => {
    const created = createOcpCluster({
      label: 'OCP Dev',
      consoleUrl: 'https://console-openshift-console.apps.ocp-new-dev.bri.co.id/',
      authType: 'oauth_password',
      username: 'brimo',
      secret: 'pass-1',
    });

    cacheClusterOAuthToken(created.id, 'sha256~cached-token', 3600);
    let row = getOcpClusterRow(created.id)!;
    expect(decryptClusterCachedToken(row)).toBe('sha256~cached-token');
    expect(getOcpClusterPublic(created.id)?.hasCachedToken).toBe(true);

    // Updating only label preserves cached token
    updateOcpCluster(created.id, { label: 'OCP Dev Updated' });
    row = getOcpClusterRow(created.id)!;
    expect(decryptClusterCachedToken(row)).toBe('sha256~cached-token');

    // Updating secret clears cached token
    updateOcpCluster(created.id, { secret: 'pass-2' });
    row = getOcpClusterRow(created.id)!;
    expect(decryptClusterSecret(row)).toBe('pass-2');
    expect(decryptClusterCachedToken(row)).toBeNull();
  });

  it('deletes an OCP cluster cleanly', () => {
    const created = createOcpCluster({
      label: 'Delete Me',
      consoleUrl: 'https://console-openshift-console.apps.del.bri.co.id',
      authType: 'token',
      secret: 'sha256~x',
    });

    expect(deleteOcpCluster(created.id)).toBe(true);
    expect(deleteOcpCluster(created.id)).toBe(false);
    expect(getOcpClusterPublic(created.id)).toBeNull();
  });
});
