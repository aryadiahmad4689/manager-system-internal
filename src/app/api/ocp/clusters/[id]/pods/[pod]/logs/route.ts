import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getPodLogs } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';

/**
 * GET /api/ocp/clusters/[id]/pods/[pod]/logs?namespace=<ns>&container=<c>&tailLines=200
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; pod: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const namespace = request.nextUrl.searchParams.get('namespace') || '';
  const container = request.nextUrl.searchParams.get('container') || undefined;
  const tailLinesRaw = request.nextUrl.searchParams.get('tailLines');
  const tailLines = tailLinesRaw ? Number(tailLinesRaw) : 200;

  if (!namespace.trim()) {
    return NextResponse.json({ error: 'namespace query parameter is required' }, { status: 400 });
  }

  try {
    const logs = await getPodLogs(
      params.id,
      namespace.trim(),
      params.pod,
      container,
      Number.isFinite(tailLines) ? tailLines : 200
    );
    return NextResponse.json({ logs });
  } catch (error) {
    return handleOcpApiError(error, 'Failed to retrieve pod logs');
  }
}
