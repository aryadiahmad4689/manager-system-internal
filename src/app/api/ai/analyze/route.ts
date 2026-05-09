import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import https from 'https';
import { authOptions } from '@/lib/auth/auth.config';
import { getDb } from '@/lib/db';
import { decrypt } from '@/lib/crypto/credential-store';

/**
 * Makes an HTTPS POST request using Node.js native https module.
 * More reliable than Next.js patched fetch for external API calls.
 */
function httpsPost(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 500, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 500, data: { error: { message: data } } });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * POST /api/ai/analyze — Send log text to ChatGPT for analysis
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { logText, prompt } = body;

  if (!logText || typeof logText !== 'string' || logText.trim().length === 0) {
    return NextResponse.json({ error: 'Log text is required' }, { status: 400 });
  }

  // Get AI settings
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_settings WHERE id = ?').get('default') as any;

  if (!row || !row.api_key_encrypted) {
    return NextResponse.json(
      { error: 'AI belum dikonfigurasi. Silakan tambahkan API key di menu AI Settings.' },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = decrypt({
      ciphertext: row.api_key_encrypted,
      iv: row.api_key_iv,
      authTag: row.api_key_auth_tag,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 });
  }

  const model = row.model || 'gpt-4o-mini';

  // Build the prompt
  const systemPrompt = `Kamu adalah seorang DevOps engineer dan log analyst yang ahli. Tugasmu adalah menganalisis log yang diberikan user dan memberikan insight yang berguna. Jawab dalam bahasa Indonesia.

Berikan analisis yang mencakup:
1. Ringkasan masalah yang ditemukan
2. Root cause analysis (jika memungkinkan)
3. Rekomendasi solusi
4. Severity level (Critical/High/Medium/Low/Info)

Format jawaban dengan markdown yang rapi.`;

  const userPrompt = prompt
    ? `${prompt}\n\n--- LOG ---\n${logText.slice(0, 8000)}`
    : `Analisis log berikut dan berikan insight:\n\n--- LOG ---\n${logText.slice(0, 8000)}`;

  try {
    const requestBody = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    });

    const { status, data } = await httpsPost(
      'https://api.openai.com/v1/chat/completions',
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      requestBody
    );

    if (status !== 200) {
      const errMsg = data?.error?.message || `OpenAI API error: ${status}`;
      return NextResponse.json({ error: errMsg }, { status });
    }

    const analysis = data.choices?.[0]?.message?.content || 'No response from AI';

    return NextResponse.json({
      analysis,
      model,
      tokensUsed: data.usage?.total_tokens || 0,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to call OpenAI: ${error}` }, { status: 500 });
  }
}
