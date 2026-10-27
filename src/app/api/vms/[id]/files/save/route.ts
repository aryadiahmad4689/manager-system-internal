import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';
import { getCredential } from '@/lib/crypto/credential-store';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

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

  const { path: filePath, content, createBackup = true } = body;

  if (!filePath || typeof filePath !== 'string') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  if (content === undefined || typeof content !== 'string') {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const sshManager = getSSHManager();
  const tempFile = `/tmp/.pvm_save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Retrieve VM credential to pass to sudo -S if sudo requires a password
  let password = '';
  try {
    password = await getCredential(id);
  } catch {
    // ignore if credential store not populated in mock/test
  }
  // Include trailing newline so sudo -S reads complete password without waiting/failing
  const b64Pass = password ? Buffer.from(password + '\n', 'utf-8').toString('base64') : '';

  try {
    let backupPath: string | undefined;
    if (createBackup) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 14);
      backupPath = `${filePath}.bak-${timestamp}`;
    }

    // Base64 encode content to safely transfer through SSH without shell escaping issues
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');

    const parts: string[] = [];

    // Step 1: Pre-authenticate sudo timestamp if password exists
    if (b64Pass) {
      parts.push(`(echo "${b64Pass}" | base64 -d | sudo -S -p '' -v 2>/dev/null || sudo -v 2>/dev/null || true)`);
    } else {
      parts.push(`(sudo -v 2>/dev/null || true)`);
    }

    // Step 2: Write decoded content to temporary file in /tmp (current user can always write to /tmp)
    parts.push(`echo "${base64Content}" | base64 -d > "${tempFile}"`);

    // Step 3: Create backup using sudo if requested and source file exists
    // Using \cp -f -p to bypass any interactive alias like alias cp='cp -i'
    if (createBackup && backupPath) {
      parts.push(`if [ -f "${filePath}" ]; then (sudo \\cp -f -p "${filePath}" "${backupPath}" 2>/dev/null || \\cp -f -p "${filePath}" "${backupPath}" 2>/dev/null || true); fi`);
    }

    // Step 4: Overwrite target destination file with sudo
    // Using \cp -f to force overwrite existing file without interactive prompts
    // Fallback to sudo tee < tempFile in case cp is restricted
    const copyCmd = b64Pass
      ? `(echo "${b64Pass}" | base64 -d | sudo -S -p '' \\cp -f "${tempFile}" "${filePath}") || (sudo \\cp -f "${tempFile}" "${filePath}") || (\\cp -f "${tempFile}" "${filePath}") || (sudo tee "${filePath}" < "${tempFile}" >/dev/null)`
      : `(sudo \\cp -f "${tempFile}" "${filePath}") || (\\cp -f "${tempFile}" "${filePath}") || (sudo tee "${filePath}" < "${tempFile}" >/dev/null)`;
    parts.push(`(${copyCmd})`);

    // Step 5: If editing a systemd unit file, run daemon-reload with sudo
    if (filePath.endsWith('.service')) {
      parts.push(`(sudo systemctl daemon-reload 2>/dev/null || true)`);
    }

    const fullScript = parts.join(' && ');
    await sshManager.executeCommand(id, fullScript);

    return NextResponse.json({
      success: true,
      path: filePath,
      backupPath,
      isSystemdUnit: filePath.endsWith('.service'),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // If command failed on VM (e.g. exit code 1 with permission denied)
    if (err.message.includes('Command failed')) {
      const isPermission = /permission denied|password is required|incorrect password/i.test(err.message);
      const userMessage = isPermission
        ? `Gagal menyimpan file: Akses ditolak (Permission Denied). Penyimpanan memerlukan hak akses sudo / root.`
        : `Gagal menyimpan file: ${err.message}`;

      return NextResponse.json(
        { error: userMessage, details: err.message },
        { status: 500 }
      );
    }

    const sshError = handleSSHError(err);
    return NextResponse.json(
      { error: sshError.message || `Failed to save file ${filePath}`, details: err.message },
      { status: 500 }
    );
  } finally {
    // Clean up temporary file without masking any write failures
    const cleanupScript = `rm -f "${tempFile}" 2>/dev/null || (sudo rm -f "${tempFile}" 2>/dev/null) || true`;
    await sshManager.executeCommand(id, cleanupScript).catch(() => {});
  }
}
