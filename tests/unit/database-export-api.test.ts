import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock next-auth before importing routes
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: vi.fn(),
}));

// Mock auth config
vi.mock('@/lib/auth/auth.config', () => ({
  authOptions: {},
}));

// Mock the CSV exporter
vi.mock('@/lib/db/csv-exporter', () => ({
  getCSVExporter: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getCSVExporter } from '@/lib/db/csv-exporter';
import { POST } from '@/app/api/databases/[id]/export/route';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetCSVExporter = vi.mocked(getCSVExporter);

function createRequest(body: any): Request {
  return new Request('http://localhost/api/databases/conn-1/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createInvalidRequest(): Request {
  return new Request('http://localhost/api/databases/conn-1/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
}

function createMockCSVExporter() {
  return {
    export: vi.fn().mockReturnValue('id,name\r\n1,Alice\r\n2,Bob\r\n'),
    getFilename: vi.fn().mockReturnValue('query_result_mydb_20240101_120000.csv'),
  };
}

describe('POST /api/databases/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest({
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Alice' }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 400 when request body is invalid JSON', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createInvalidRequest();
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
  });

  it('should return 400 when columns are missing', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createRequest({
      rows: [{ id: 1 }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Columns are required and must be a non-empty array');
  });

  it('should return 400 when columns is an empty array', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createRequest({
      columns: [],
      rows: [{ id: 1 }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Columns are required and must be a non-empty array');
  });

  it('should return 400 when rows are missing', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });

    const request = createRequest({
      columns: ['id', 'name'],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Rows are required and must be an array');
  });

  it('should generate CSV and return as downloadable file', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockExporter = createMockCSVExporter();
    mockGetCSVExporter.mockReturnValue(mockExporter as any);

    const request = createRequest({
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });

    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe('id,name\r\n1,Alice\r\n2,Bob\r\n');

    expect(mockExporter.export).toHaveBeenCalledWith({
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      database: 'mydb',
    });
  });

  it('should set correct Content-Type header', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockExporter = createMockCSVExporter();
    mockGetCSVExporter.mockReturnValue(mockExporter as any);

    const request = createRequest({
      columns: ['id'],
      rows: [{ id: 1 }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  });

  it('should set correct Content-Disposition header with filename', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockExporter = createMockCSVExporter();
    mockGetCSVExporter.mockReturnValue(mockExporter as any);

    const request = createRequest({
      columns: ['id'],
      rows: [{ id: 1 }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="query_result_mydb_20240101_120000.csv"'
    );
    expect(mockExporter.getFilename).toHaveBeenCalledWith('mydb');
  });

  it('should use "unknown" as database name when database is not provided', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockExporter = createMockCSVExporter();
    mockGetCSVExporter.mockReturnValue(mockExporter as any);

    const request = createRequest({
      columns: ['id'],
      rows: [{ id: 1 }],
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });

    expect(response.status).toBe(200);
    expect(mockExporter.export).toHaveBeenCalledWith({
      columns: ['id'],
      rows: [{ id: 1 }],
      database: 'unknown',
    });
    expect(mockExporter.getFilename).toHaveBeenCalledWith('unknown');
  });

  it('should handle empty rows array', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockExporter = {
      export: vi.fn().mockReturnValue('id,name\r\n'),
      getFilename: vi.fn().mockReturnValue('query_result_mydb_20240101_120000.csv'),
    };
    mockGetCSVExporter.mockReturnValue(mockExporter as any);

    const request = createRequest({
      columns: ['id', 'name'],
      rows: [],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });

    expect(response.status).toBe(200);
    expect(mockExporter.export).toHaveBeenCalledWith({
      columns: ['id', 'name'],
      rows: [],
      database: 'mydb',
    });
  });

  it('should return 500 when CSV export throws an error', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'admin' } });
    const mockExporter = {
      export: vi.fn().mockImplementation(() => {
        throw new Error('Export processing failed');
      }),
      getFilename: vi.fn(),
    };
    mockGetCSVExporter.mockReturnValue(mockExporter as any);

    const request = createRequest({
      columns: ['id'],
      rows: [{ id: 1 }],
      database: 'mydb',
    });
    const response = await POST(request as any, { params: { id: 'conn-1' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Export processing failed');
  });
});
