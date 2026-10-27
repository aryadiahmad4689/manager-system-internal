import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';
import { getCredential } from '@/lib/crypto/credential-store';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

const ALLOWED_ACTIONS = ['restart', 'stop', 'start', 'status'] as const;
type ServiceAction = (typeof ALLOWED_ACTIONS)[number];

export async function POST(
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { serviceName, action } = body;

  if (!serviceName || typeof serviceName !== 'string') {
    return NextResponse.json({ error: 'serviceName is required' }, { status: 400 });
  }

  // Validate service name: only allow safe characters (alphanumeric, dots, dashes, underscores, @)
  if (!/^[a-zA-Z0-9_.@-]+$/.test(serviceName)) {
    return NextResponse.json({ error: 'Invalid service name format' }, { status: 400 });
  }

  if (!action || !ALLOWED_ACTIONS.includes(action as ServiceAction)) {
    return NextResponse.json(
      { error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const sshManager = getSSHManager();

    let password = '';
    try {
      password = await getCredential(id);
    } catch {
      // ignore
    }
    const b64Pass = password ? Buffer.from(password, 'utf-8').toString('base64') : '';

    const sudoWrap = (cmd: string) => {
      if (b64Pass) {
        return `(echo "${b64Pass}" | base64 -d | sudo -S -p '' ${cmd}) || (sudo ${cmd}) || (${cmd})`;
      }
      return `(sudo ${cmd}) || (${cmd})`;
    };

    let command = '';
    if (action === 'status') {
      command = `systemctl status "${serviceName}" --no-pager 2>&1 || true`;
    } else {
      command = `${sudoWrap(`systemctl ${action} "${serviceName}" 2>&1`)}`;
    }

    const output = await sshManager.executeCommand(id, command);

    return NextResponse.json({
      success: true,
      serviceName,
      action,
      output: output.trim(),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    if (err.message.includes('Command failed')) {
      const isPermission = /permission denied|password is required|incorrect password/i.test(err.message);
      const userMessage = isPermission
        ? `Gagal menjalankan ${action} pada ${serviceName}: Akses ditolak. Diperlukan hak akses sudo / root.`
        : `Gagal menjalankan ${action} pada ${serviceName}: ${err.message}`;

      return NextResponse.json(
        { error: userMessage, details: err.message },
        { status: 500 }
      );
    }

    const sshError = handleSSHError(err);
    return NextResponse.json(
      { error: sshError.message || `Failed to execute ${action} on ${serviceName}`, details: err.message },
      { status: 500 }
    );
  }
}
