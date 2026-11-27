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
  cacheSecurityToken,
  createSecurityConnection,
  decryptSecurityCachedToken,
  decryptSecurityClientSecret,
  decryptSecuritySecret,
  deleteSecurityConnection,
  getSecurityConnectionPublic,
  getSecurityConnectionRow,
  listSecurityConnections,
  updateSecurityConnection,
} from '@/lib/security/security-manager';

const TEST_DB_DIR = path.resolve(process.cwd(), 'data', 'test');

describe('Security Connection Manager', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    dbPath = path.join(
      TEST_DB_DIR,
      `sec-manager-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

  it('creates encrypted SonarQube, SAST, and SCA connections without leaking secrets', () => {
    const sonar = createSecurityConnection({
      provider: 'sonarqube',
      label: 'SonarQube BRI',
      baseUrl: 'https://sonarqube-enterprise.bri.co.id/sessions/new?return_to=%2F',
      authType: 'password',
      username: 'brimo',
      secret: 'sonar-pass',
    });

    expect(sonar.baseUrl).toBe('https://sonarqube-enterprise.bri.co.id');
    expect((sonar as any).secret).toBeUndefined();
    expect((sonar as any).encrypted_secret).toBeUndefined();

    const sast = createSecurityConnection({
      provider: 'cxsast',
      label: 'SAST BRI',
      baseUrl: 'https://sast.bri.co.id/CxWebClient/Projects.aspx',
      authType: 'password',
      username: 'SAP',
      clientId: 'custom_client',
      clientSecret: 'custom-client-secret',
      secret: 'sast-pass',
    });

    expect(sast.hasClientSecret).toBe(true);
    const sastRow = getSecurityConnectionRow(sast.id)!;
    expect(decryptSecuritySecret(sastRow)).toBe('sast-pass');
    expect(decryptSecurityClientSecret(sastRow)).toBe('custom-client-secret');

    const sca = createSecurityConnection({
      provider: 'cxsca',
      label: 'Checkmarx SCA',
      baseUrl: 'https://eu.sca.checkmarx.net/',
      authType: 'password',
      tenantAccount: 'bri',
      username: 'sap',
      secret: 'sca-pass',
    });
    expect(sca.tenantAccount).toBe('bri');
    expect(listSecurityConnections()).toHaveLength(3);
  });

  it('caches and clears tokens when credentials change, and deletes cleanly', () => {
    const conn = createSecurityConnection({
      provider: 'cxsca',
      label: 'SCA',
      baseUrl: 'https://eu.sca.checkmarx.net/',
      authType: 'password',
      tenantAccount: 'bri',
      username: 'sap',
      secret: 'pw1',
    });

    cacheSecurityToken(conn.id, 'tok-1', 3600);
    expect(decryptSecurityCachedToken(getSecurityConnectionRow(conn.id)!)).toBe('tok-1');

    updateSecurityConnection(conn.id, { secret: 'pw2' });
    expect(decryptSecurityCachedToken(getSecurityConnectionRow(conn.id)!)).toBeNull();
    expect(decryptSecuritySecret(getSecurityConnectionRow(conn.id)!)).toBe('pw2');

    expect(deleteSecurityConnection(conn.id)).toBe(true);
    expect(getSecurityConnectionPublic(conn.id)).toBeNull();
  });
});
