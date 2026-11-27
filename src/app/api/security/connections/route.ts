import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import {
  createSecurityConnection,
  listSecurityConnections,
} from '@/lib/security/security-manager';
import {
  handleSecurityApiError,
  validateCreateSecurityBody,
} from '@/lib/security/api-helpers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(listSecurityConnections());
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to list security connections');
  }
}

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

  const validation = validateCreateSecurityBody(body);
  if (!validation.valid || !validation.data) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const created = createSecurityConnection(validation.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to create security connection');
  }
}
