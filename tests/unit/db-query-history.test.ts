import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  truncateQuery,
  formatTimestamp,
  formatAbsoluteDate,
  getStatusClasses,
} from '@/components/db/query-history-utils';
import type { QueryHistoryEntry } from '@/components/db/query-history-utils';

describe('query-history-utils', () => {
  describe('truncateQuery', () => {
    it('should return the query unchanged if shorter than maxLength', () => {
      const query = 'SELECT * FROM users';
      expect(truncateQuery(query)).toBe('SELECT * FROM users');
    });

    it('should truncate and add ellipsis when query exceeds maxLength', () => {
      const query = 'SELECT id, name, email, created_at, updated_at, status, role FROM users WHERE status = "active" AND role = "admin"';
      const result = truncateQuery(query, 80);
      expect(result.length).toBe(81); // 80 chars + ellipsis character
      expect(result.endsWith('…')).toBe(true);
    });

    it('should collapse multiple whitespace characters into single spaces', () => {
      const query = 'SELECT *\n  FROM users\n  WHERE id = 1';
      expect(truncateQuery(query)).toBe('SELECT * FROM users WHERE id = 1');
    });

    it('should collapse tabs and multiple spaces', () => {
      const query = 'SELECT\t\t*   FROM    users';
      expect(truncateQuery(query)).toBe('SELECT * FROM users');
    });

    it('should trim leading and trailing whitespace', () => {
      const query = '  SELECT * FROM users  ';
      expect(truncateQuery(query)).toBe('SELECT * FROM users');
    });

    it('should handle empty string', () => {
      expect(truncateQuery('')).toBe('');
    });

    it('should respect custom maxLength parameter', () => {
      const query = 'SELECT * FROM users WHERE id = 1';
      const result = truncateQuery(query, 10);
      expect(result).toBe('SELECT * F…');
    });

    it('should handle query exactly at maxLength', () => {
      const query = '12345';
      expect(truncateQuery(query, 5)).toBe('12345');
    });
  });

  describe('formatTimestamp', () => {
    it('should return "just now" for timestamps less than 1 minute ago', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-15T10:29:45Z'; // 15 seconds ago
      expect(formatTimestamp(executedAt, now)).toBe('just now');
    });

    it('should return minutes ago for timestamps less than 1 hour ago', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-15T10:15:00Z'; // 15 minutes ago
      expect(formatTimestamp(executedAt, now)).toBe('15m ago');
    });

    it('should return hours ago for timestamps less than 24 hours ago', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-15T07:30:00Z'; // 3 hours ago
      expect(formatTimestamp(executedAt, now)).toBe('3h ago');
    });

    it('should return absolute date for timestamps older than 24 hours', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-13T10:30:00Z'; // 2 days ago
      const result = formatTimestamp(executedAt, now);
      // Should be in YYYY-MM-DD HH:mm format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('should return absolute date for future timestamps', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-16T10:30:00Z'; // 1 day in the future
      const result = formatTimestamp(executedAt, now);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('should handle exactly 1 minute ago', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-15T10:29:00Z'; // exactly 1 minute ago
      expect(formatTimestamp(executedAt, now)).toBe('1m ago');
    });

    it('should handle exactly 1 hour ago', () => {
      const now = new Date('2024-03-15T10:30:00Z');
      const executedAt = '2024-03-15T09:30:00Z'; // exactly 1 hour ago
      expect(formatTimestamp(executedAt, now)).toBe('1h ago');
    });
  });

  describe('formatAbsoluteDate', () => {
    it('should format date as YYYY-MM-DD HH:mm', () => {
      const date = new Date(2024, 2, 15, 10, 30); // March 15, 2024 10:30
      expect(formatAbsoluteDate(date)).toBe('2024-03-15 10:30');
    });

    it('should zero-pad single digit months and days', () => {
      const date = new Date(2024, 0, 5, 9, 5); // Jan 5, 2024 09:05
      expect(formatAbsoluteDate(date)).toBe('2024-01-05 09:05');
    });

    it('should handle midnight', () => {
      const date = new Date(2024, 11, 31, 0, 0); // Dec 31, 2024 00:00
      expect(formatAbsoluteDate(date)).toBe('2024-12-31 00:00');
    });
  });

  describe('getStatusClasses', () => {
    it('should return green dot class for success status', () => {
      const result = getStatusClasses('success');
      expect(result.dotClass).toBe('bg-green-500');
      expect(result.label).toBe('Success');
    });

    it('should return red dot class for error status', () => {
      const result = getStatusClasses('error');
      expect(result.dotClass).toBe('bg-red-500');
      expect(result.label).toBe('Error');
    });
  });
});
