import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { listSecurityProjects } from '@/lib/security/security-client';
import { handleSecurityApiError } from '@/lib/security/api-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get('q') || '';

  try {
    const projects = await listSecurityProjects(params.id, query);
    return NextResponse.json({ projects });
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to list security projects');
  }
}
