import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { performResourceAction } from '@/lib/ocp/ocp-client';
import { handleOcpApiError } from '@/lib/ocp/api-helpers';
import type { OcpActionPayload } from '@/lib/ocp/types';

function parseActionPayload(body: unknown): {
  valid: boolean;
  error?: string;
  payload?: OcpActionPayload;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const raw = body as Record<string, unknown>;
  const action = raw.action;
  const namespace = typeof raw.namespace === 'string' ? raw.namespace.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';

  if (!namespace || !name) {
    return { valid: false, error: 'namespace and name are required' };
  }

  if (action === 'delete-pod') {
    return {
      valid: true,
      payload: { action: 'delete-pod', namespace, name },
    };
  }

  const kind = raw.kind;
  if (kind !== 'Deployment' && kind !== 'DeploymentConfig') {
    return { valid: false, error: 'kind must be Deployment or DeploymentConfig' };
  }

  if (action === 'restart') {
    return {
      valid: true,
      payload: { action: 'restart', namespace, kind, name },
    };
  }

  if (action === 'scale') {
    const replicas = Number(raw.replicas);
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 50) {
      return {
        valid: false,
        error: 'replicas must be an integer between 0 and 50',
      };
    }
    return {
      valid: true,
      payload: { action: 'scale', namespace, kind, name, replicas },
    };
  }

  return {
    valid: false,
    error: 'action must be one of: scale, restart, delete-pod',
  };
}

/**
 * POST /api/ocp/clusters/[id]/actions — Execute scale, rollout restart, or pod delete.
 */
export async function POST(
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

  const parsed = parseActionPayload(body);
  if (!parsed.valid || !parsed.payload) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await performResourceAction(params.id, parsed.payload);
    return NextResponse.json(result);
  } catch (error) {
    return handleOcpApiError(error, 'Failed to execute OCP action');
  }
}
