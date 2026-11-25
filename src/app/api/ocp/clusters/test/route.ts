import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import {
  decryptClusterSecret,
  getOcpClusterRow,
} from '@/lib/ocp/ocp-manager';
import { testRawClusterConnection } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';
import type { OcpAuthType } from '@/lib/ocp/types';

/**
 * POST /api/ocp/clusters/test — Test unsaved or edited OCP cluster connection settings.
 * Supports passing clusterId so edits without re-typing password can reuse the stored secret.
 */
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
  const consoleUrl = typeof raw.consoleUrl === 'string' ? raw.consoleUrl : '';
  const apiUrl = typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined;
  const authType = raw.authType as OcpAuthType;
  const username = typeof raw.username === 'string' ? raw.username : undefined;
  const insecureTls = raw.insecureTls === undefined ? true : Boolean(raw.insecureTls);
  let secret = typeof raw.secret === 'string' ? raw.secret : '';

  if (!consoleUrl.trim()) {
    return NextResponse.json({ error: 'consoleUrl is required' }, { status: 400 });
  }

  if (authType !== 'oauth_password' && authType !== 'token') {
    return NextResponse.json(
      { error: 'authType must be oauth_password or token' },
      { status: 400 }
    );
  }

  if (!secret && typeof raw.clusterId === 'string' && raw.clusterId) {
    const existing = getOcpClusterRow(raw.clusterId);
    if (!existing) {
      return NextResponse.json({ error: 'OCP cluster not found' }, { status: 404 });
    }
    secret = decryptClusterSecret(existing);
  }

  if (!secret) {
    return NextResponse.json(
      { error: authType === 'token' ? 'token is required' : 'password is required' },
      { status: 400 }
    );
  }

  try {
    const result = await testRawClusterConnection({
      consoleUrl,
      apiUrl,
      authType,
      username,
      secret,
      insecureTls,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to test OCP cluster connection');
  }
}
