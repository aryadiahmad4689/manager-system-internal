import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { listWorkloads } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';

/**
 * GET /api/ocp/clusters/[id]/resources?namespace=<ns>
 * Returns Pods, Deployments, DeploymentConfigs, Services, and Routes in a namespace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const namespace = request.nextUrl.searchParams.get('namespace') || '';
  if (!namespace.trim()) {
    return NextResponse.json({ error: 'namespace query parameter is required' }, { status: 400 });
  }

  try {
    const workloads = await listWorkloads(params.id, namespace.trim());
    return NextResponse.json(workloads);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to load OCP resources');
  }
}
