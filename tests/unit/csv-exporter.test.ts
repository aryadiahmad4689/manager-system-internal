import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CSVExporterImpl, createCSVExporter } from '@/lib/db/csv-exporter';

describe('CSVExporter', () => {
  let exporter: CSVExporterImpl;

  beforeEach(() => {
    exporter = createCSVExporter();
  });

  describe('export', () => {
    it('should generate CSV with headers and rows', () => {
      const result = exporter.export({
        columns: ['id', 'name', 'email'],
        rows: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[0]).toBe('id,name,email');
      expect(lines[1]).toBe('1,Alice,alice@example.com');
      expect(lines[2]).toBe('2,Bob,bob@example.com');
    });

    it('should use CRLF line endings per RFC 4180', () => {
      const result = exporter.export({
        columns: ['id'],
        rows: [{ id: 1 }],
        database: 'testdb',
      });

      expect(result).toContain('\r\n');
      // Should not have bare LF without CR
      expect(result.replace(/\r\n/g, '')).not.toContain('\n');
    });

    it('should end with a trailing CRLF', () => {
      const result = exporter.export({
        columns: ['id'],
        rows: [{ id: 1 }],
        database: 'testdb',
      });

      expect(result.endsWith('\r\n')).toBe(true);
    });

    it('should escape fields containing commas', () => {
      const result = exporter.export({
        columns: ['name', 'address'],
        rows: [
          { name: 'Alice', address: '123 Main St, Apt 4' },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[1]).toBe('Alice,"123 Main St, Apt 4"');
    });

    it('should escape fields containing double quotes by doubling them', () => {
      const result = exporter.export({
        columns: ['name', 'quote'],
        rows: [
          { name: 'Alice', quote: 'She said "hello"' },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[1]).toBe('Alice,"She said ""hello"""');
    });

    it('should escape fields containing newlines', () => {
      const result = exporter.export({
        columns: ['name', 'bio'],
        rows: [
          { name: 'Alice', bio: 'Line 1\nLine 2' },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      // The field with newline should be quoted
      expect(lines[1]).toBe('Alice,"Line 1\nLine 2"');
    });

    it('should escape fields containing carriage returns', () => {
      const result = exporter.export({
        columns: ['name', 'note'],
        rows: [
          { name: 'Bob', note: 'Line 1\r\nLine 2' },
        ],
        database: 'testdb',
      });

      // The field with CR should be quoted
      expect(result).toContain('"Line 1\r\nLine 2"');
    });

    it('should escape header fields containing special characters', () => {
      const result = exporter.export({
        columns: ['user,name', 'age'],
        rows: [{ 'user,name': 'Alice', age: 30 }],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[0]).toBe('"user,name",age');
    });

    it('should handle empty result set', () => {
      const result = exporter.export({
        columns: ['id', 'name'],
        rows: [],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[0]).toBe('id,name');
      // Only header + trailing CRLF
      expect(lines).toEqual(['id,name', '']);
    });

    it('should handle null values as empty strings', () => {
      const result = exporter.export({
        columns: ['id', 'name', 'email'],
        rows: [
          { id: 1, name: null, email: 'test@test.com' },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[1]).toBe('1,,test@test.com');
    });

    it('should handle undefined values as empty strings', () => {
      const result = exporter.export({
        columns: ['id', 'name', 'email'],
        rows: [
          { id: 1, email: 'test@test.com' },  // name is undefined
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[1]).toBe('1,,test@test.com');
    });

    it('should convert non-string values to strings', () => {
      const result = exporter.export({
        columns: ['id', 'active', 'score'],
        rows: [
          { id: 1, active: true, score: 3.14 },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[1]).toBe('1,true,3.14');
    });

    it('should handle combined special characters in a single field', () => {
      const result = exporter.export({
        columns: ['data'],
        rows: [
          { data: 'has "quotes", commas,\nand newlines' },
        ],
        database: 'testdb',
      });

      const lines = result.split('\r\n');
      expect(lines[1]).toBe('"has ""quotes"", commas,\nand newlines"');
    });
  });

  describe('getFilename', () => {
    it('should generate filename in correct format', () => {
      const filename = exporter.getFilename('mydb');

      expect(filename).toMatch(/^query_result_mydb_\d{8}_\d{6}\.csv$/);
    });

    it('should include the database name in the filename', () => {
      const filename = exporter.getFilename('production_db');

      expect(filename).toContain('production_db');
      expect(filename.startsWith('query_result_production_db_')).toBe(true);
    });

    it('should end with .csv extension', () => {
      const filename = exporter.getFilename('testdb');

      expect(filename.endsWith('.csv')).toBe(true);
    });

    it('should include a valid timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15T10:30:45'));

      const filename = exporter.getFilename('mydb');

      expect(filename).toBe('query_result_mydb_20240315_103045.csv');

      vi.useRealTimers();
    });
  });
});
