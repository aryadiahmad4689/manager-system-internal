import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import {
  decryptSecurityClientSecret,
  decryptSecuritySecret,
  getSecurityConnectionRow,
} from '@/lib/security/security-manager';
import { testRawSecurityConnection } from '@/lib/security/security-client';
import { handleSecurityApiError } from '@/lib/security/api-helpers';
import type { SecurityAuthType, SecurityProvider } from '@/lib/security/types';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const provider = raw.provider as SecurityProvider;
  const authType = raw.authType as SecurityAuthType;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl : '';

  if (provider !== 'sonarqube' && provider !== 'cxsast' && provider !== 'cxsca') {
    return NextResponse.json(
      { error: 'provider must be one of: sonarqube, cxsast, cxsca' },
      { status: 400 }
    );
  }
  if (authType !== 'password' && authType !== 'token') {
    return NextResponse.json(
      { error: 'authType must be password or token' },
      { status: 400 }
    );
  }
  if (!baseUrl.trim()) {
    return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 });
  }

  let secret = typeof raw.secret === 'string' ? raw.secret : '';
  let clientSecret =
    typeof raw.clientSecret === 'string' ? raw.clientSecret : undefined;

  if (typeof raw.connectionId === 'string' && raw.connectionId) {
    const existing = getSecurityConnectionRow(raw.connectionId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Security connection not found' },
        { status: 404 }
      );
    }
    if (!secret) {
      secret = decryptSecuritySecret(existing);
    }
    if (clientSecret === undefined) {
      clientSecret = decryptSecurityClientSecret(existing) ?? undefined;
    }
  }

  if (!secret) {
    return NextResponse.json(
      { error: authType === 'token' ? 'token is required' : 'password is required' },
      { status: 400 }
    );
  }

  try {
    const result = await testRawSecurityConnection({
      provider,
      baseUrl,
      authType,
      tenantAccount:
        typeof raw.tenantAccount === 'string' ? raw.tenantAccount : undefined,
      username: typeof raw.username === 'string' ? raw.username : undefined,
      clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
      clientSecret,
      secret,
      insecureTls: raw.insecureTls === undefined ? true : Boolean(raw.insecureTls),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to test security connection');
  }
}
