import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { encrypt } from '@/lib/crypto/credential-store';
import { getDatabaseManager } from '@/lib/db/database-manager';

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
 * GET /api/databases/[id] — Get a single database connection by ID
 * Returns connection details without password.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const row = db.prepare(`
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
      WHERE dc.id = ?
    `).get(params.id) as DatabaseConnectionRow | undefined;

    if (!row) {
      return NextResponse.json(
        { error: 'Database connection not found' },
        { status: 404 }
      );
    }

    const connection = {
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
      updatedAt: row.updated_at,
    };

    return NextResponse.json(connection);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve database connection' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/databases/[id] — Update a database connection
 * Accepts partial updates. Re-encrypts password if provided.
 * Closes active connection if connection config changes.
 */
export async function PUT(
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
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 }
    );
  }

  const updates = body as Record<string, unknown>;

  // Validate the connection exists
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM database_connections WHERE id = ?'
  ).get(params.id) as Record<string, any> | undefined;

  if (!existing) {
    return NextResponse.json(
      { error: 'Database connection not found' },
      { status: 404 }
    );
  }

  // Validate fields if provided
  const validation = validateUpdateBody(updates);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.message },
      { status: 400 }
    );
  }

  try {
    // Build update fields
    const setClauses: string[] = [];
    const values: any[] = [];

    // Track if connection config changed (requires disconnect)
    let configChanged = false;

    if (updates.dbType !== undefined) {
      const dbType = (updates.dbType as string).trim().toLowerCase();
      setClauses.push('db_type = ?');
      values.push(dbType);
      configChanged = true;
    }

    if (updates.host !== undefined) {
      const host = sanitize(updates.host as string);
      setClauses.push('host = ?');
      values.push(host);
      configChanged = true;
    }

    if (updates.port !== undefined) {
      const port = typeof updates.port === 'string' ? Number(updates.port) : updates.port;
      setClauses.push('port = ?');
      values.push(port);
      configChanged = true;
    }

    if (updates.username !== undefined) {
      const username = sanitize(updates.username as string);
      setClauses.push('db_username = ?');
      values.push(username);
      configChanged = true;
    }

    if (updates.password !== undefined) {
      const encrypted = encrypt(updates.password as string);
      setClauses.push('encrypted_password = ?');
      setClauses.push('encryption_iv = ?');
      setClauses.push('encryption_auth_tag = ?');
      values.push(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
      configChanged = true;
    }

    if (updates.label !== undefined) {
      const label = updates.label === null ? null : sanitize(updates.label as string);
      setClauses.push('label = ?');
      values.push(label);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Close active connection if config changed
    if (configChanged) {
      try {
        const dbManager = getDatabaseManager();
        await dbManager.disconnect(params.id);
      } catch {
        // Ignore disconnect errors — connection may not be active
      }
    }

    // Update the record
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(params.id);

    db.prepare(`
      UPDATE database_connections
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).run(...values);

    // Fetch updated record
    const updatedRow = db.prepare(`
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
      WHERE dc.id = ?
    `).get(params.id) as DatabaseConnectionRow;

    const connection = {
      id: updatedRow.id,
      vmId: updatedRow.vm_id,
      vmLabel: updatedRow.vm_label || null,
      dbType: updatedRow.db_type,
      host: updatedRow.host,
      port: updatedRow.port,
      username: updatedRow.db_username,
      label: updatedRow.label,
      status: 'disconnected',
      createdAt: updatedRow.created_at,
      updatedAt: updatedRow.updated_at,
    };

    return NextResponse.json(connection);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update database connection' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/databases/[id] — Delete a database connection
 * Closes active connection/tunnel first, then deletes the record.
 * CASCADE constraint handles query_history cleanup.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();

    // Verify the connection exists
    const existing = db.prepare(
      'SELECT id FROM database_connections WHERE id = ?'
    ).get(params.id) as { id: string } | undefined;

    if (!existing) {
      return NextResponse.json(
        { error: 'Database connection not found' },
        { status: 404 }
      );
    }

    // Close active connection and tunnel first
    try {
      const dbManager = getDatabaseManager();
      await dbManager.disconnect(params.id);
    } catch {
      // Ignore disconnect errors — connection may not be active
    }

    // Delete the connection record (CASCADE will handle query_history)
    db.prepare('DELETE FROM database_connections WHERE id = ?').run(params.id);

    return NextResponse.json({ message: 'Database connection deleted' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete database connection' },
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

interface UpdateValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validates the PUT /api/databases/[id] request body.
 * Only validates fields that are present (partial update).
 */
function validateUpdateBody(body: Record<string, unknown>): UpdateValidationResult {
  if (body.dbType !== undefined) {
    if (typeof body.dbType !== 'string' || !VALID_DB_TYPES.includes(body.dbType.trim().toLowerCase())) {
      return { valid: false, message: 'dbType must be one of: mysql, postgresql, mariadb' };
    }
  }

  if (body.host !== undefined) {
    if (typeof body.host !== 'string' || body.host.trim().length === 0) {
      return { valid: false, message: 'host must be a non-empty string if provided' };
    }
  }

  if (body.port !== undefined) {
    const portNum = typeof body.port === 'string' ? Number(body.port) : body.port;
    if (typeof portNum !== 'number' || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, message: 'port must be an integer between 1 and 65535' };
    }
  }

  if (body.username !== undefined) {
    if (typeof body.username !== 'string' || body.username.trim().length === 0) {
      return { valid: false, message: 'username must be a non-empty string if provided' };
    }
  }

  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.trim().length === 0) {
      return { valid: false, message: 'password must be a non-empty string if provided' };
    }
  }

  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== 'string') {
      return { valid: false, message: 'label must be a string or null if provided' };
    }
  }

  return { valid: true };
}
