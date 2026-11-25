import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { testSavedClusterConnection } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';

/**
 * POST /api/ocp/clusters/[id]/test — Test saved OCP cluster connectivity & auth.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await testSavedClusterConnection(params.id);
    return NextResponse.json(result);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to test OCP cluster connection');
  }
}
