import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getLogReader } from '@/lib/logs/log-reader';

/**
 * Validates a VM ID — must be non-empty hex characters only.
 */
function isValidVmId(id: string): boolean {
  return /^[a-f0-9]+$/i.test(id);
}

/**
 * GET /api/vms/:id/projects — List projects on a VM
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  if (!id || !isValidVmId(id)) {
    return NextResponse.json(
      { error: 'Invalid VM id format' },
      { status: 400 }
    );
  }

  try {
    const logReader = getLogReader();
    const projects = await logReader.listProjects(id);
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve projects' },
      { status: 500 }
    );
  }
}
