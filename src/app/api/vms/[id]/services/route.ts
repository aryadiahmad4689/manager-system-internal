import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getServiceDetector } from '@/lib/services/service-detector';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';

/**
 * Validates a VM ID — must be non-empty alphanumeric characters.
 */
function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

/**
 * GET /api/vms/:id/services — Detect and return running services on a VM
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
    const detector = getServiceDetector();
    const result = await detector.detectServices(id);
    return NextResponse.json(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshErrorInfo = handleSSHError(err);

    return NextResponse.json(
      {
        error: sshErrorInfo.message || 'Failed to detect running services',
        details: err.message,
      },
      { status: 500 }
    );
  }
}
