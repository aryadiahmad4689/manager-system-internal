import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import {
  deleteOcpCluster,
  getOcpClusterPublic,
  updateOcpCluster,
} from '@/lib/ocp/ocp-manager';
import {
  handleOcpApiError,
  validateClusterUpdatePayload,
} from '@/lib/ocp/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cluster = getOcpClusterPublic(params.id);
  if (!cluster) {
    return NextResponse.json({ error: 'OCP cluster not found' }, { status: 404 });
  }

  return NextResponse.json(cluster);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const validation = validateClusterUpdatePayload(body);
  if (!validation.valid || !validation.data) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const updated = updateOcpCluster(params.id, validation.data);
    if (!updated) {
      return NextResponse.json({ error: 'OCP cluster not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to update OCP cluster');
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

  const deleted = deleteOcpCluster(params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'OCP cluster not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'OCP cluster deleted' });
}
