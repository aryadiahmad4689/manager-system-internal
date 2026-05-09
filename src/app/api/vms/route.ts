import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { listVMs, addVM } from '@/lib/vm/vm-manager';

/**
 * GET /api/vms — List all VMs
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const vms = await listVMs();
    return NextResponse.json(vms);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve VM list' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/vms — Add a new VM
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate request body
  const validation = validateAddVMBody(body);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.message },
      { status: 400 }
    );
  }

  const { label, host, port, username, password } = validation.data!;

  try {
    const vm = await addVM({
      label: sanitize(label),
      host: sanitize(host),
      port,
      username: sanitize(username),
      encryptedPassword: password, // addVM handles encryption internally
    });

    return NextResponse.json(vm, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to add VM' },
      { status: 500 }
    );
  }
}

/**
 * Sanitizes a string input by trimming whitespace and removing control characters.
 */
function sanitize(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.trim().replace(/[\x00-\x1f\x7f]/g, '');
}

interface ValidationResult {
  valid: boolean;
  message?: string;
  data?: {
    label: string;
    host: string;
    port: number;
    username: string;
    password: string;
  };
}

/**
 * Validates the POST /api/vms request body.
 */
function validateAddVMBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body must be a JSON object' };
  }

  const { label, host, port, username, password } = body as Record<string, unknown>;

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return { valid: false, message: 'label is required and must be a non-empty string' };
  }

  if (!host || typeof host !== 'string' || host.trim().length === 0) {
    return { valid: false, message: 'host is required and must be a non-empty string' };
  }

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { valid: false, message: 'username is required and must be a non-empty string' };
  }

  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return { valid: false, message: 'password is required and must be a non-empty string' };
  }

  // Port validation: optional, defaults to 22, must be 1-65535
  let validatedPort = 22;
  if (port !== undefined && port !== null) {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { valid: false, message: 'port must be an integer between 1 and 65535' };
    }
    validatedPort = port;
  }

  return {
    valid: true,
    data: {
      label: label as string,
      host: host as string,
      port: validatedPort,
      username: username as string,
      password: password as string,
    },
  };
}
