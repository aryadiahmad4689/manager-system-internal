import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { encrypt } from '@/lib/crypto/credential-store';

/**
 * Default ports for each supported database type.
 */
const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  postgresql: 5432,
  mariadb: 3306,
};

const VALID_DB_TYPES = ['mysql', 'postgresql', 'mariadb'];

/**
 * Row shape from the database_connections table joined with vms.
 */
interface DatabaseConnectionRow {
  id: string;
  vm_id: string;
  vm_label: string;
  db_type: string;
  host: string;
  port: number;
  db_username: string;
  label: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/databases — List all database connections
 * Returns connections with VM label and status info. Never returns password.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        dc.id,
        dc.vm_id,
        v.label as vm_label,
        dc.db_type,
        dc.host,
        dc.port,
        dc.db_username,
        dc.label,
        dc.created_at,
        dc.updated_at
      FROM database_connections dc
      LEFT JOIN vms v ON dc.vm_id = v.id
      ORDER BY dc.created_at DESC
    `).all() as DatabaseConnectionRow[];

    const connections = rows.map((row) => ({
      id: row.id,
      vmId: row.vm_id,
      vmLabel: row.vm_label || null,
      dbType: row.db_type,
      host: row.host,
      port: row.port,
      username: row.db_username,
      label: row.label,
      status: 'disconnected',
      createdAt: row.created_at,
    }));

    return NextResponse.json(connections);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve database connections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/databases — Register a new database connection
 * Validates required fields, encrypts password, saves to database.
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
  const validation = validateCreateBody(body);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.message },
      { status: 400 }
    );
  }

  const { dbType, host, port, username, password, label } = validation.data!;

  try {
    const db = getDb();

    // Encrypt the password
    const encrypted = encrypt(password);

    // Insert the connection
    const id = require('crypto').randomBytes(16).toString('hex');
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

    db.prepare(`
      INSERT INTO database_connections (id, vm_id, db_type, host, port, db_username, encrypted_password, encryption_iv, encryption_auth_tag, label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      null,
      dbType,
      host,
      port,
      username,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      label || null,
      now,
      now
    );

    const connection = {
      id,
      dbType,
      host,
      port,
      username,
      label: label || null,
      status: 'disconnected',
      createdAt: now,
    };

    return NextResponse.json(connection, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create database connection' },
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
    dbType: string;
    host: string;
    port: number;
    username: string;
    password: string;
    label?: string;
  };
}

/**
 * Validates the POST /api/databases request body.
 */
function validateCreateBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body must be a JSON object' };
  }

  const { dbType, host, port, username, password, label } = body as Record<string, unknown>;

  if (!dbType || typeof dbType !== 'string' || !VALID_DB_TYPES.includes(dbType.trim().toLowerCase())) {
    return { valid: false, message: 'dbType is required and must be one of: mysql, postgresql, mariadb' };
  }

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { valid: false, message: 'username is required and must be a non-empty string' };
  }

  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return { valid: false, message: 'password is required and must be a non-empty string' };
  }

  // Validate host (optional, defaults to 'localhost')
  let validatedHost = 'localhost';
  if (host !== undefined && host !== null) {
    if (typeof host !== 'string' || host.trim().length === 0) {
      return { valid: false, message: 'host must be a non-empty string if provided' };
    }
    validatedHost = sanitize(host as string);
  }

  // Validate port (optional, defaults based on dbType)
  const normalizedDbType = (dbType as string).trim().toLowerCase();
  let validatedPort = DEFAULT_PORTS[normalizedDbType];
  if (port !== undefined && port !== null) {
    const portNum = typeof port === 'string' ? Number(port) : port;
    if (typeof portNum !== 'number' || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, message: 'port must be an integer between 1 and 65535' };
    }
    validatedPort = portNum;
  }

  // Validate label (optional)
  let validatedLabel: string | undefined;
  if (label !== undefined && label !== null) {
    if (typeof label !== 'string') {
      return { valid: false, message: 'label must be a string if provided' };
    }
    validatedLabel = sanitize(label);
  }

  return {
    valid: true,
    data: {
      dbType: normalizedDbType,
      host: validatedHost,
      port: validatedPort,
      username: sanitize(username as string),
      password: password as string,
      label: validatedLabel,
    },
  };
}
