import http from 'http';
import https from 'https';

export class HttpClientError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'HttpClientError';
    this.statusCode = statusCode;
  }
}

export interface NativeHttpResponse<T = Record<string, unknown>> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: T | null;
}

export interface NativeHttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  insecureTls?: boolean;
  timeoutMs?: number;
}

/**
 * Performs an HTTP/HTTPS request using Node.js native transport modules.
 * Supports internal/self-signed corporate certificates via `insecureTls`.
 */
export function nativeHttpRequest<T = Record<string, unknown>>(
  targetUrl: string,
  options: NativeHttpRequestOptions = {}
): Promise<NativeHttpResponse<T>> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new HttpClientError(`Invalid URL: ${targetUrl}`, 400));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const method = options.method || 'GET';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (options.body !== undefined && !headers['Content-Length']) {
      headers['Content-Length'] = String(Buffer.byteLength(options.body));
    }

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      ...(isHttps ? { rejectUnauthorized: !options.insecureTls } : {}),
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: T | null = null;
        try {
          json = text ? (JSON.parse(text) as T) : null;
        } catch {
          json = null;
        }
        resolve({
          status: res.statusCode || 500,
          headers: res.headers as Record<string, string | string[] | undefined>,
          text,
          json,
        });
      });
    });

    req.on('error', (err) => {
      reject(
        new HttpClientError(
          `Network error connecting to ${parsed.host}: ${err.message}`,
          502
        )
      );
    });

    req.setTimeout(options.timeoutMs ?? 20000, () => {
      req.destroy();
      reject(
        new HttpClientError(
          `Request timeout connecting to ${parsed.host}`,
          504
        )
      );
    });

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
