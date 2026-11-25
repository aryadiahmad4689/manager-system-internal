import { describe, it, expect } from 'vitest';
import {
  expandNestedJsonStrings,
  formatLogsForCopy,
  parseLogLineForBeautify,
} from '@/lib/ocp/log-beautifier';

describe('OCP Log Beautifier', () => {
  it('parses Kubernetes timestamp-prefixed JSON log lines and expands nested JSON strings', () => {
    const sample =
      '2026-11-25T03:28:14.974571110Z {"level":"info","http_type":"REQUEST","msg":"REQUEST","trx_type":"UpdateProductVoucherGame","trace":"[]","response_code":"00"}';

    const parsed = parseLogLineForBeautify(sample);
    expect(parsed.kind).toBe('json');
    if (parsed.kind === 'json') {
      expect(parsed.prefix).toBe('2026-11-25T03:28:14.974571110Z');
      expect(parsed.level).toBe('info');
      expect(parsed.tags).toEqual([
        'REQUEST',
        'REQUEST',
        'UpdateProductVoucherGame',
        '00',
      ]);
      const obj = JSON.parse(parsed.formattedJson);
      expect(obj.trace).toEqual([]);
      expect(obj.response_code).toBe('00');
    }
  });

  it('expands deeply nested JSON strings without altering numeric strings', () => {
    const expanded = expandNestedJsonStrings({
      code: '00',
      payload: '{"ok":true,"items":"[1,2]"}',
    }) as Record<string, unknown>;

    expect(expanded.code).toBe('00');
    expect(expanded.payload).toEqual({ ok: true, items: [1, 2] });
  });

  it('falls back to plain text line when content is not valid JSON', () => {
    const parsed = parseLogLineForBeautify('2026-11-25T03:28:14Z ERROR failed to dial tcp');
    expect(parsed.kind).toBe('text');
    expect(parsed.level).toBe('error');
  });

  it('formats logs cleanly when beautify copy is enabled', () => {
    const lines = [
      '2026-11-25T03:28:14Z {"a":1}',
      'plain startup line',
    ];
    const rawCopy = formatLogsForCopy(lines, false);
    expect(rawCopy).toBe(lines.join('\n'));

    const prettyCopy = formatLogsForCopy(lines, true);
    expect(prettyCopy).toContain('2026-11-25T03:28:14Z\n{\n  "a": 1\n}');
    expect(prettyCopy).toContain('plain startup line');
  });
});
