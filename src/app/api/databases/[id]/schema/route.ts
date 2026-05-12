import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * GET /api/databases/[id]/schema — List all databases on the server
 *
 * Returns the list of databases available on the connected database server.
 * Handles "Access denied" errors gracefully — if a database listing partially
 * fails, it still returns accessible databases.
 *
 * Requirements: 4.1, 4.4
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  try {
    // Verify the connection exists
    const db = getDb();
    const row = db.prepare(
      'SELECT id FROM database_connections WHERE id = ?'
    ).get(id) as { id: string } | undefined;

    if (!row) {
      return NextResponse.json(
        { error: 'Database connection not found' },
        { status: 404 }
      );
    }

    // Ensure connection is active (auto-connect if needed)
    const dbManager = getDatabaseManager();
    let connection = dbManager.getConnection(id);
    if (!connection || connection.status !== 'connected') {
      await dbManager.connect(id);
    }

    // Get list of databases
    const queryExecutor = getQueryExecutor();
    const databases = await queryExecutor.getDatabases(id);

    return NextResponse.json({ databases });
  } catch (error: any) {
    // Handle "Access denied" gracefully
    const message = error?.message || '';
    if (message.toLowerCase().includes('access denied')) {
      return NextResponse.json(
        { databases: [], error: 'Access denied: insufficient privileges to list databases' },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to retrieve databases' },
      { status: 500 }
    );
  }
}
