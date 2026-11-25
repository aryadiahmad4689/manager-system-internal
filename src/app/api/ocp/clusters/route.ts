import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { createOcpCluster, listOcpClusters } from '@/lib/ocp/ocp-manager';
import {
  handleOcpApiError,
  validateClusterCreatePayload,
} from '@/lib/ocp/api-helpers';

/**
 * GET /api/ocp/clusters — List registered OCP clusters (without secrets/tokens).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clusters = listOcpClusters();
    return NextResponse.json(clusters);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to list OCP clusters');
  }
}

/**
 * POST /api/ocp/clusters — Register a new OCP cluster with encrypted secret.
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

  const validation = validateClusterCreatePayload(body);
  if (!validation.valid || !validation.data) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const created = createOcpCluster(validation.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleOcpApiError(error, 'Failed to create OCP cluster');
  }
}
