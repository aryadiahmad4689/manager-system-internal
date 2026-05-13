import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Since the database page is a client component with JSX that requires
 * a browser/jsdom environment to render, we verify its structure and
 * the layout navigation update through file content analysis.
 * The component rendering is tested via integration tests.
 */

describe('DatabaseManagementPage - module structure', () => {
  const pagePath = resolve(__dirname, '../../src/app/(dashboard)/databases/page.tsx');
  const pageContent = readFileSync(pagePath, 'utf-8');

  it('should be a client component', () => {
    expect(pageContent).toContain("'use client'");
  });

  it('should export a default function component', () => {
    expect(pageContent).toMatch(/export default function DatabaseManagementPage/);
  });

  it('should import ConnectionList component', () => {
    expect(pageContent).toContain("import ConnectionList from '@/components/db/ConnectionList'");
  });

  it('should import ConnectionTreeView for database explorer', () => {
    expect(pageContent).toContain('ConnectionTreeView');
  });

  it('should import SQLEditor via dynamic import', () => {
    expect(pageContent).toContain("import('@/components/db/SQLEditor')");
  });

  it('should import TableTabs component', () => {
    expect(pageContent).toContain("import TableTabs from '@/components/db/TableTabs'");
  });

  it('should import QueryHistory component', () => {
    expect(pageContent).toContain("import QueryHistory from '@/components/db/QueryHistory'");
  });

  it('should import ConnectionForm component', () => {
    expect(pageContent).toContain("import ConnectionForm from '@/components/db/ConnectionForm'");
  });

  it('should have loading state for connections', () => {
    expect(pageContent).toContain('isLoadingConnections');
  });

  it('should have loading state for query execution via tabs', () => {
    expect(pageContent).toContain('isLoading: true');
  });

  it('should have loading state for history', () => {
    expect(pageContent).toContain('isLoadingHistory');
  });

  it('should manage active connection state', () => {
    expect(pageContent).toContain('activeConnectionId');
  });

  it('should fetch schema after connecting', () => {
    expect(pageContent).toContain('/schema');
  });

  it('should set minimum width for desktop layout (1024px)', () => {
    expect(pageContent).toContain('min-w-[1024px]');
  });

  it('should have dark mode classes', () => {
    expect(pageContent).toContain('dark:bg-gray-800');
    expect(pageContent).toContain('dark:text-gray-100');
  });

  it('should have sidebar with 300px width', () => {
    expect(pageContent).toContain('w-[300px]');
  });
});

describe('DashboardLayout - navigation', () => {
  const layoutPath = resolve(__dirname, '../../src/app/(dashboard)/layout.tsx');
  const layoutContent = readFileSync(layoutPath, 'utf-8');

  it('should be a client component', () => {
    expect(layoutContent).toContain("'use client'");
  });

  it('should have a link to Virtual Machines page', () => {
    expect(layoutContent).toContain('href="/"');
    expect(layoutContent).toContain('Virtual Machines');
  });

  it('should have a link to Database Management page', () => {
    expect(layoutContent).toContain('href="/databases"');
    expect(layoutContent).toContain('Database Management');
  });

  it('should use usePathname for active state detection', () => {
    expect(layoutContent).toContain('usePathname');
  });

  it('should highlight active navigation item', () => {
    expect(layoutContent).toContain('isVMPage');
    expect(layoutContent).toContain('isDatabasePage');
  });

  it('should support dark mode in navigation', () => {
    expect(layoutContent).toContain('dark:bg-gray-700');
    expect(layoutContent).toContain('dark:text-gray-100');
  });
});
