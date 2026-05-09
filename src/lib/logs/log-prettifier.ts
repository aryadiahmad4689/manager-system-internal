/**
 * Log Prettifier — formats and colorizes terminal output.
 * Detects JSON and adds indentation + syntax highlighting via ANSI codes.
 * Also colorizes common log levels.
 */

// ANSI color codes
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[91m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  blue: '\x1b[94m',
  magenta: '\x1b[95m',
  cyan: '\x1b[96m',
  gray: '\x1b[90m',
};

// Strip all ANSI escape codes from a string
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Colorize a parsed JSON object for terminal display.
 */
function colorizeJson(obj: any, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);

  if (obj === null) return `${C.dim}null${C.reset}`;
  if (typeof obj === 'boolean') return `${C.magenta}${obj}${C.reset}`;
  if (typeof obj === 'number') return `${C.yellow}${obj}${C.reset}`;
  if (typeof obj === 'string') {
    // Truncate very long strings
    const display = obj.length > 200 ? obj.slice(0, 200) + '...' : obj;
    return `${C.green}"${display}"${C.reset}`;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map((item) => `${pad1}${colorizeJson(item, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    const entries = keys.map((key) => {
      const val = colorizeJson(obj[key], indent + 1);
      return `${pad1}${C.cyan}"${key}"${C.reset}: ${val}`;
    });
    return `{\n${entries.join(',\n')}\n${pad}}`;
  }

  return String(obj);
}

/**
 * Try to parse a line as JSON (after stripping ANSI codes).
 * Returns formatted + colorized string if successful, null otherwise.
 */
function tryFormatJson(line: string): string | null {
  const clean = stripAnsi(line).trim();
  if (!clean) return null;

  // Must start with { or [
  if (!clean.startsWith('{') && !clean.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(clean);
    return colorizeJson(parsed);
  } catch {
    return null;
  }
}

/**
 * Colorize log level keywords in a line (only if not JSON).
 */
function colorizeLine(line: string): string {
  // Don't modify lines that already have ANSI codes (like grep --color output)
  // Just add level colorization on top
  let result = line;

  // Colorize log levels (case insensitive, word boundary)
  result = result.replace(/\b(ERROR|FATAL|PANIC|CRITICAL)\b/gi, `${C.red}${C.bold}$1${C.reset}`);
  result = result.replace(/\b(WARN|WARNING)\b/gi, `${C.yellow}$1${C.reset}`);
  result = result.replace(/\b(INFO)\b/gi, `${C.green}$1${C.reset}`);
  result = result.replace(/\b(DEBUG|TRACE)\b/gi, `${C.gray}$1${C.reset}`);

  return result;
}

/**
 * Prettify terminal output data.
 * - If a line is valid JSON → format with indentation and colors
 * - Otherwise → colorize log levels
 */
export function prettifyOutput(data: string): string {
  // Split by newlines but preserve them
  const lines = data.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      result.push(line);
      continue;
    }

    // Try to format as JSON
    const formatted = tryFormatJson(line);
    if (formatted) {
      result.push(formatted);
    } else {
      // Colorize log levels
      result.push(colorizeLine(line));
    }
  }

  return result.join('\n');
}
