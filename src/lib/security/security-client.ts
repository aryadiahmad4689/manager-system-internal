import { HttpClientError } from '@/lib/http/native-http';
import { getSecurityConnectionRow } from './security-manager';
import { normalizeSecurityBaseUrl } from './security-urls';
import {
  getSonarQubeProjectDetails,
  listSonarQubeProjects,
  testSonarQubeConnection,
} from './providers/sonarqube-client';
import {
  getCxSastProjectDetails,
  listCxSastProjects,
  testCxSastConnection,
} from './providers/cxsast-client';
import {
  getCxScaProjectDetails,
  listCxScaProjects,
  testCxScaConnection,
} from './providers/cxsca-client';
import type {
  SecurityAuthType,
  SecurityProjectDetails,
  SecurityProjectSummary,
  SecurityProvider,
  SecurityTestResult,
} from './types';

export async function testRawSecurityConnection(input: {
  provider: SecurityProvider;
  baseUrl: string;
  authType: SecurityAuthType;
  tenantAccount?: string | null;
  username?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  secret: string;
  insecureTls?: boolean;
}): Promise<SecurityTestResult> {
  const normalizedUrl = normalizeSecurityBaseUrl(input.provider, input.baseUrl);
  const insecureTls = input.insecureTls !== false;

  switch (input.provider) {
    case 'sonarqube':
      return testSonarQubeConnection({
        baseUrl: normalizedUrl,
        authType: input.authType,
        username: input.username,
        secret: input.secret,
        insecureTls,
      });
    case 'cxsast':
      return testCxSastConnection({
        baseUrl: normalizedUrl,
        authType: input.authType,
        username: input.username,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        secret: input.secret,
        insecureTls,
      });
    case 'cxsca':
      return testCxScaConnection({
        baseUrl: normalizedUrl,
        authType: input.authType,
        tenantAccount: input.tenantAccount,
        username: input.username,
        secret: input.secret,
        insecureTls,
      });
  }
}

export async function testSavedSecurityConnection(
  connectionId: string
): Promise<SecurityTestResult> {
  const row = getSecurityConnectionRow(connectionId);
  if (!row) {
    throw new HttpClientError('Security connection not found', 404);
  }

  const { decryptSecurityClientSecret, decryptSecuritySecret } = await import(
    './security-manager'
  );

  return testRawSecurityConnection({
    provider: row.provider,
    baseUrl: row.base_url,
    authType: row.auth_type,
    tenantAccount: row.tenant_account,
    username: row.username,
    clientId: row.client_id,
    clientSecret: decryptSecurityClientSecret(row),
    secret: decryptSecuritySecret(row),
    insecureTls: row.insecure_tls === 1,
  });
}

export async function listSecurityProjects(
  connectionId: string,
  query = ''
): Promise<SecurityProjectSummary[]> {
  const row = getSecurityConnectionRow(connectionId);
  if (!row) {
    throw new HttpClientError('Security connection not found', 404);
  }

  switch (row.provider) {
    case 'sonarqube':
      return listSonarQubeProjects(row, query);
    case 'cxsast':
      return listCxSastProjects(row, query);
    case 'cxsca':
      return listCxScaProjects(row, query);
  }
}

export async function getSecurityProjectDetails(
  connectionId: string,
  projectId: string,
  projectName?: string
): Promise<SecurityProjectDetails> {
  const row = getSecurityConnectionRow(connectionId);
  if (!row) {
    throw new HttpClientError('Security connection not found', 404);
  }
  if (!projectId.trim()) {
    throw new HttpClientError('projectId or projectKey is required', 400);
  }

  switch (row.provider) {
    case 'sonarqube':
      return getSonarQubeProjectDetails(row, projectId.trim());
    case 'cxsast':
      return getCxSastProjectDetails(row, projectId.trim(), projectName);
    case 'cxsca':
      return getCxScaProjectDetails(row, projectId.trim(), projectName);
  }
}
