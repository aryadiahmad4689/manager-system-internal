import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto/credential-store';

/**
 * GET /api/ai/settings — Get current AI settings (without exposing full API key)
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();

  // Ensure table exists
  db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    provider TEXT NOT NULL DEFAULT 'openai',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    api_key_iv TEXT NOT NULL DEFAULT '',
    api_key_auth_tag TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const row = db.prepare('SELECT * FROM ai_settings WHERE id = ?').get('default') as any;

  if (!row || !row.api_key_encrypted) {
    return NextResponse.json({
      configured: false,
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyHint: '',
    });
  }

  // Decrypt to show hint (last 4 chars)
  let apiKeyHint = '';
  try {
    const fullKey = decrypt({
      ciphertext: row.api_key_encrypted,
      iv: row.api_key_iv,
      authTag: row.api_key_auth_tag,
    });
    apiKeyHint = '••••' + fullKey.slice(-4);
  } catch {
    apiKeyHint = '(invalid)';
  }

  return NextResponse.json({
    configured: true,
    provider: row.provider,
    model: row.model,
    apiKeyHint,
  });
}

/**
 * POST /api/ai/settings — Save AI settings
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { provider, apiKey, model } = body;

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return NextResponse.json({ error: 'Valid API key is required' }, { status: 400 });
  }

  const db = getDb();

  // Ensure table exists
  db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    provider TEXT NOT NULL DEFAULT 'openai',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    api_key_iv TEXT NOT NULL DEFAULT '',
    api_key_auth_tag TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const encrypted = encrypt(apiKey.trim());

  const existing = db.prepare('SELECT id FROM ai_settings WHERE id = ?').get('default');

  if (existing) {
    db.prepare(`UPDATE ai_settings SET provider = ?, api_key_encrypted = ?, api_key_iv = ?, api_key_auth_tag = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(provider || 'openai', encrypted.ciphertext, encrypted.iv, encrypted.authTag, model || 'gpt-4o-mini', 'default');
  } else {
    db.prepare(`INSERT INTO ai_settings (id, provider, api_key_encrypted, api_key_iv, api_key_auth_tag, model) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('default', provider || 'openai', encrypted.ciphertext, encrypted.iv, encrypted.authTag, model || 'gpt-4o-mini');
  }

  return NextResponse.json({ success: true });
}
