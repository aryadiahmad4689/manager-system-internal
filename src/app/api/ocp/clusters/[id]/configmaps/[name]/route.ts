import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getConfigMap, updateConfigMap } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';

/**
 * GET /api/ocp/clusters/[id]/configmaps/[name]?namespace=<ns>
 * Fetches the latest ConfigMap data and metadata.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; name: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const namespace = request.nextUrl.searchParams.get('namespace') || '';
  if (!namespace.trim()) {
    return NextResponse.json(
      { error: 'namespace query parameter is required' },
      { status: 400 }
    );
  }

  try {
    const configMap = await getConfigMap(params.id, namespace.trim(), params.name);
    return NextResponse.json(configMap);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to fetch ConfigMap');
  }
}

/**
 * PUT /api/ocp/clusters/[id]/configmaps/[name]
 * Updates an existing ConfigMap's `data` key-value entries.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; name: string } }
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

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 }
    );
  }

  const raw = body as Record<string, unknown>;
  const namespace = typeof raw.namespace === 'string' ? raw.namespace.trim() : '';
  const data = raw.data;

  if (!namespace) {
    return NextResponse.json({ error: 'namespace is required' }, { status: 400 });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json(
      { error: 'data must be a key-value object of strings' },
      { status: 400 }
    );
  }

  try {
    const updated = await updateConfigMap(
      params.id,
      namespace,
      params.name,
      data as Record<string, string>
    );
    return NextResponse.json(updated);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to update ConfigMap');
  }
}
