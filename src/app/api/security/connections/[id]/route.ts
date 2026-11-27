import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import {
  deleteSecurityConnection,
  getSecurityConnectionPublic,
  updateSecurityConnection,
} from '@/lib/security/security-manager';
import {
  handleSecurityApiError,
  validateUpdateSecurityBody,
} from '@/lib/security/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conn = getSecurityConnectionPublic(params.id);
  if (!conn) {
    return NextResponse.json(
      { error: 'Security connection not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(conn);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = getSecurityConnectionPublic(params.id);
  if (!existing) {
    return NextResponse.json(
      { error: 'Security connection not found' },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateUpdateSecurityBody(existing.provider, body);
  if (!validation.valid || !validation.data) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const updated = updateSecurityConnection(params.id, validation.data);
    return NextResponse.json(updated);
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to update security connection');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deleted = deleteSecurityConnection(params.id);
  if (!deleted) {
    return NextResponse.json(
      { error: 'Security connection not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ message: 'Security connection deleted' });
}
