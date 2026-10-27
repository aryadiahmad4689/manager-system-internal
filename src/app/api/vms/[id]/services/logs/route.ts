import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!id || !isValidVmId(id)) {
    return NextResponse.json({ error: 'Invalid VM id format' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const unit = searchParams.get('unit');
  const linesParam = searchParams.get('lines');
  const lines = Math.min(500, Math.max(10, parseInt(linesParam || '100', 10) || 100));

  if (!unit || typeof unit !== 'string') {
    return NextResponse.json({ error: 'unit parameter is required' }, { status: 400 });
  }

  // Validate unit name
  if (!/^[a-zA-Z0-9_.@-]+$/.test(unit)) {
    return NextResponse.json({ error: 'Invalid unit name format' }, { status: 400 });
  }

  try {
    const sshManager = getSSHManager();
    const command = `sudo journalctl -u "${unit}" -n ${lines} --no-pager 2>&1 || journalctl -u "${unit}" -n ${lines} --no-pager 2>&1`;
    const output = await sshManager.executeCommand(id, command);

    return NextResponse.json({
      unit,
      lines,
      logs: output,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshError = handleSSHError(err);
    return NextResponse.json(
      { error: sshError.message || `Failed to fetch logs for ${unit}`, details: err.message },
      { status: 500 }
    );
  }
}
