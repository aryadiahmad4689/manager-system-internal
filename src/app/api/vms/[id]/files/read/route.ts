import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';
import { getCredential } from '@/lib/crypto/credential-store';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

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
  const filePath = searchParams.get('path');

  if (!filePath || typeof filePath !== 'string') {
    return NextResponse.json({ error: 'path parameter is required' }, { status: 400 });
  }

  try {
    const sshManager = getSSHManager();

    // Retrieve VM credential for sudo password support
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

    // Check file size first (using sudo if necessary)
    const sizeCmd = `${sudoWrap(`stat -c %s "${filePath}" 2>/dev/null`)} || stat -c %s "${filePath}" 2>/dev/null || wc -c < "${filePath}" 2>/dev/null || echo "0"`;
    const sizeOutput = await sshManager.executeCommand(id, sizeCmd);
    const size = parseInt(sizeOutput.trim(), 10) || 0;

    if (size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File terlalu besar (${Math.round(size / 1024)} KB). Maksimal ukuran file untuk diedit adalah 2 MB.` },
        { status: 413 }
      );
    }

    // Read content with sudo wrapper
    const readCmd = `${sudoWrap(`cat "${filePath}" 2>/dev/null`)}`;
    const content = await sshManager.executeCommand(id, readCmd);

    const filename = filePath.split('/').pop() || filePath;

    return NextResponse.json({
      path: filePath,
      filename,
      content,
      size,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    if (err.message.includes('Command failed')) {
      const isPermission = /permission denied|password is required|incorrect password/i.test(err.message);
      const userMessage = isPermission
        ? `Gagal membaca file: Akses ditolak (Permission Denied). Diperlukan hak akses sudo / root.`
        : `Gagal membaca file: ${err.message}`;

      return NextResponse.json(
        { error: userMessage, details: err.message },
        { status: 500 }
      );
    }

    const sshError = handleSSHError(err);
    return NextResponse.json(
      { error: sshError.message || `Failed to read file ${filePath}`, details: err.message },
      { status: 500 }
    );
  }
}
