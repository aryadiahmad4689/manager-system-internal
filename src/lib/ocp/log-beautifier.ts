export type LogSeverity = 'error' | 'warn' | 'info' | 'debug' | 'default';

export interface BeautifiedJsonLine {
  kind: 'json';
  raw: string;
  prefix: string;
  formattedJson: string;
  level: LogSeverity;
  tags: string[];
}

export interface PlainTextLogLine {
  kind: 'text';
  raw: string;
  text: string;
  level: LogSeverity;
}

export type ParsedBeautifyLogLine = BeautifiedJsonLine | PlainTextLogLine;

function stripAnsiCodes(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Recursively expands string values that contain JSON objects or arrays
 * (e.g. `"trace":"[]"` or stringified payloads), up to `maxDepth`.
 */
export function expandNestedJsonStrings(
  value: unknown,
  depth = 0,
  maxDepth = 5
): unknown {
  if (depth >= maxDepth || value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return expandNestedJsonStrings(parsed, depth + 1, maxDepth);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandNestedJsonStrings(item, depth + 1, maxDepth));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = expandNestedJsonStrings(obj[key], depth + 1, maxDepth);
    }
    return out;
  }

  return value;
}

function detectSeverityFromText(text: string): LogSeverity {
  if (/\b(error|fatal|panic|critical|err)\b/i.test(text)) return 'error';
  if (/\b(warn|warning)\b/i.test(text)) return 'warn';
  if (/\b(info)\b/i.test(text)) return 'info';
  if (/\b(debug|trace)\b/i.test(text)) return 'debug';
  return 'default';
}

function extractSummaryFromJson(parsed: unknown): {
  level: LogSeverity;
  tags: string[];
} {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { level: 'default', tags: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const rawLevel =
    typeof obj.level === 'string'
      ? obj.level
      : typeof obj.severity === 'string'
      ? obj.severity
      : '';

  const level = rawLevel ? detectSeverityFromText(rawLevel) : 'default';
  const tags: string[] = [];

  for (const field of ['http_type', 'msg', 'trx_type', 'response_code']) {
    const val = obj[field];
    if (typeof val === 'string' && val.trim()) {
      tags.push(val.trim());
    }
  }

  return { level, tags: tags.slice(0, 4) };
}

function tryParseJsonCandidate(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Parses a single log line (including Kubernetes `<RFC3339-timestamp> {...}` lines)
 * into either a formatted JSON block or a plain text line.
 */
export function parseLogLineForBeautify(rawLine: string): ParsedBeautifyLogLine {
  const clean = stripAnsiCodes(rawLine);
  const trimmed = clean.trim();

  if (!trimmed) {
    return { kind: 'text', raw: rawLine, text: clean, level: 'default' };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = tryParseJsonCandidate(trimmed);
    if (parsed !== undefined) {
      const expanded = expandNestedJsonStrings(parsed);
      const { level, tags } = extractSummaryFromJson(expanded);
      return {
        kind: 'json',
        raw: rawLine,
        prefix: '',
        formattedJson: JSON.stringify(expanded, null, 2),
        level,
        tags,
      };
    }
  }

  const braceIdx = trimmed.indexOf('{');
  const bracketIdx = trimmed.indexOf('[');
  const candidates = [braceIdx, bracketIdx].filter((idx) => idx > 0);

  if (candidates.length > 0) {
    const jsonStart = Math.min(...candidates);
    const jsonPart = trimmed.slice(jsonStart);
    const parsed = tryParseJsonCandidate(jsonPart);
    if (parsed !== undefined) {
      const prefix = trimmed.slice(0, jsonStart).trim();
      const expanded = expandNestedJsonStrings(parsed);
      const summary = extractSummaryFromJson(expanded);
      const level =
        summary.level !== 'default'
          ? summary.level
          : detectSeverityFromText(prefix);

      return {
        kind: 'json',
        raw: rawLine,
        prefix,
        formattedJson: JSON.stringify(expanded, null, 2),
        level,
        tags: summary.tags,
      };
    }
  }

  return {
    kind: 'text',
    raw: rawLine,
    text: clean,
    level: detectSeverityFromText(trimmed),
  };
}

/**
 * Formats an array of log lines for clipboard copying based on beautify mode.
 */
export function formatLogsForCopy(lines: string[], beautify: boolean): string {
  if (!beautify) {
    return lines.join('\n');
  }

  return lines
    .map((line) => {
      const parsed = parseLogLineForBeautify(line);
      if (parsed.kind === 'json') {
        return parsed.prefix
          ? `${parsed.prefix}\n${parsed.formattedJson}`
          : parsed.formattedJson;
      }
      return parsed.text;
    })
    .join('\n');
}
