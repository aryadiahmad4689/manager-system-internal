import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * GET /api/databases/[id]/schema/[db] — List tables in a database
 *
 * Returns the list of tables in the specified database.
 * Handles "Access denied" errors gracefully per database.
 *
 * Requirements: 4.2, 4.4
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; db: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, db: database } = params;

  try {
    // Verify the connection exists
    const localDb = getDb();
    const row = localDb.prepare(
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

    // Get list of tables
    const queryExecutor = getQueryExecutor();
    const tables = await queryExecutor.getTables(id, database);

    return NextResponse.json({ database, tables });
  } catch (error: any) {
    // Handle "Access denied" gracefully
    const message = error?.message || '';
    if (message.toLowerCase().includes('access denied')) {
      return NextResponse.json(
        { database, tables: [], error: `Access denied: insufficient privileges to access database '${database}'` },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to retrieve tables' },
      { status: 500 }
    );
  }
}
