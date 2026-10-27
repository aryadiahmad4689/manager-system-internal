import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';

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

  const { port, path: reqPath } = body;

  if (!port || !/^\d+$/.test(String(port))) {
    return NextResponse.json({ error: 'Valid numeric port is required' }, { status: 400 });
  }

  const portNum = parseInt(String(port), 10);
  if (portNum < 1 || portNum > 65535) {
    return NextResponse.json({ error: 'Port must be between 1 and 65535' }, { status: 400 });
  }

  const path = (reqPath && typeof reqPath === 'string' && reqPath.startsWith('/')) ? reqPath : '/';

  try {
    const sshManager = getSSHManager();
    // Test HTTP curl response code & total time
    const curlCmd = `curl -s -o /dev/null -w "%{http_code}|%{time_total}" --connect-timeout 3 "http://127.0.0.1:${portNum}${path}" 2>/dev/null || echo "000|0"`;
    const output = await sshManager.executeCommand(id, curlCmd);

    const parts = output.trim().split('|');
    const httpCode = parseInt(parts[0], 10) || 0;
    const timeTotalSeconds = parseFloat(parts[1]) || 0;
    const responseTimeMs = Math.round(timeTotalSeconds * 1000);

    const reachable = httpCode > 0;
    let statusText = `${httpCode} Response`;

    if (httpCode === 200) statusText = '200 OK';
    else if (httpCode === 404) statusText = '404 Not Found';
    else if (httpCode === 401 || httpCode === 403) statusText = `${httpCode} Unauthorized`;
    else if (httpCode >= 500) statusText = `${httpCode} Server Error`;
    else if (httpCode === 0) statusText = 'Connection Refused / Non-HTTP';

    return NextResponse.json({
      port: portNum,
      reachable,
      httpCode,
      responseTimeMs,
      status: statusText,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshError = handleSSHError(err);
    return NextResponse.json(
      { error: sshError.message || `Failed to test port ${portNum}`, details: err.message },
      { status: 500 }
    );
  }
}
