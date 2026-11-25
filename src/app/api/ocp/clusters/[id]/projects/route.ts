import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { listProjects } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';

/**
 * GET /api/ocp/clusters/[id]/projects — List OpenShift projects / namespaces.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const projects = await listProjects(params.id);
    return NextResponse.json({ projects });
  } catch (error) {
    return handleOcpApiError(error, 'Failed to list OCP projects');
  }
}
