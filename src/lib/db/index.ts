import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let dbInstance: Database.Database | null = null;

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'dashboard.db');

/**
 * Returns a singleton database connection.
 * Creates the database file and runs migrations on first call.
 */
export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const resolvedPath = dbPath ?? process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;

  // Ensure the directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  dbInstance = db;
  return dbInstance;
}

/**
 * Runs the schema migration against the database.
 * Uses IF NOT EXISTS so it's safe to run multiple times.
 */
export function runMigrations(db: Database.Database): void {
  // Try multiple paths to find schema.sql (handles both dev and compiled contexts)
  const possiblePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'lib', 'db', 'schema.sql'),
  ];

  let schema: string | null = null;
  for (const schemaPath of possiblePaths) {
    if (fs.existsSync(schemaPath)) {
      schema = fs.readFileSync(schemaPath, 'utf-8');
      break;
    }
  }

  if (!schema) {
    console.warn('[DB] schema.sql not found, skipping migrations. Searched:', possiblePaths);
    return;
  }

  db.exec(schema);
}

/**
 * Closes the database connection and resets the singleton.
 * Useful for testing and graceful shutdown.
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Creates a fresh database connection without using the singleton.
 * Useful for testing with isolated databases.
 */
export function createDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Try multiple paths to find schema.sql
  const possiblePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'lib', 'db', 'schema.sql'),
  ];

  for (const schemaPath of possiblePaths) {
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      db.exec(schema);
      break;
    }
  }

  return db;
}
