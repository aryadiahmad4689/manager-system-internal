import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getResourceDescribe } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';
import type { OcpDescribeKind } from '@/lib/ocp/types';

const VALID_KINDS: OcpDescribeKind[] = [
  'Pod',
  'Deployment',
  'DeploymentConfig',
  'Service',
  'Route',
  'ConfigMap',
];

/**
 * GET /api/ocp/clusters/[id]/describe?namespace=<ns>&kind=<kind>&name=<name>
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
  const kind = request.nextUrl.searchParams.get('kind') as OcpDescribeKind;
  const name = request.nextUrl.searchParams.get('name') || '';

  if (!namespace.trim() || !name.trim()) {
    return NextResponse.json(
      { error: 'namespace and name query parameters are required' },
      { status: 400 }
    );
  }

  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const details = await getResourceDescribe(
      params.id,
      namespace.trim(),
      kind,
      name.trim()
    );
    return NextResponse.json(details);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to describe OCP resource');
  }
}
