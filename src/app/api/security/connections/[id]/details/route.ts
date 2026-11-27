import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getSecurityProjectDetails } from '@/lib/security/security-client';
import { handleSecurityApiError } from '@/lib/security/api-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId =
    request.nextUrl.searchParams.get('projectId') ||
    request.nextUrl.searchParams.get('projectKey') ||
    '';
  const projectName =
    request.nextUrl.searchParams.get('projectName') || undefined;

  if (!projectId.trim()) {
    return NextResponse.json(
      { error: 'projectId or projectKey query parameter is required' },
      { status: 400 }
    );
  }

  try {
    const details = await getSecurityProjectDetails(
      params.id,
      projectId.trim(),
      projectName
    );
    return NextResponse.json(details);
  } catch (error) {
    return handleSecurityApiError(error, 'Failed to load project security details');
  }
}
