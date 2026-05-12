import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests for task 13.1: Wire connection form submission to API.
 * Verifies that the database page correctly wires form submission,
 * edit, and delete actions to the appropriate API endpoints.
 */

describe('DatabaseManagementPage - API wiring (task 13.1)', () => {
  const pagePath = resolve(__dirname, '../../src/app/(dashboard)/databases/page.tsx');
  const pageContent = readFileSync(pagePath, 'utf-8');

  describe('Load connections on mount', () => {
    it('should use useEffect to load data on mount', () => {
      expect(pageContent).toContain('useEffect');
      expect(pageContent).toContain('fetchConnections()');
    });

    it('should fetch connections from GET /api/databases', () => {
      expect(pageContent).toContain("fetch('/api/databases')");
    });

    it('should have a fetchConnections function', () => {
      expect(pageContent).toContain('const fetchConnections = useCallback(async ()');
    });

    it('should set loading state while fetching connections', () => {
      expect(pageContent).toContain('setIsLoadingConnections(true)');
      expect(pageContent).toContain('setIsLoadingConnections(false)');
    });
  });

  describe('VM selection removed', () => {
    it('should not fetch VMs since VM is not related to database connections', () => {
      expect(pageContent).not.toContain("const fetchVMs = useCallback(async ()");
    });
  });

  describe('Create connection', () => {
    it('should POST to /api/databases for new connections', () => {
      expect(pageContent).toContain("const url = isEdit ? `/api/databases/${editConnectionId}` : '/api/databases'");
    });

    it('should use POST method for create', () => {
      expect(pageContent).toContain("const method = isEdit ? 'PUT' : 'POST'");
    });

    it('should send form data as JSON body', () => {
      expect(pageContent).toContain("headers: { 'Content-Type': 'application/json' }");
      expect(pageContent).toContain('body: JSON.stringify(body)');
    });

    it('should refresh connections list after successful create', () => {
      expect(pageContent).toContain('await fetchConnections()');
    });

    it('should close the form on success', () => {
      expect(pageContent).toContain('setShowConnectionForm(false)');
      expect(pageContent).toContain('setEditConnectionId(null)');
    });
  });

  describe('Edit connection', () => {
    it('should PUT to /api/databases/[id] when editConnectionId is set', () => {
      expect(pageContent).toContain('`/api/databases/${editConnectionId}`');
    });

    it('should only include password if provided', () => {
      expect(pageContent).toContain('if (data.password)');
      expect(pageContent).toContain('body.password = data.password');
    });
  });

  describe('Delete connection', () => {
    it('should call DELETE /api/databases/[id]', () => {
      expect(pageContent).toContain("`/api/databases/${id}`");
      expect(pageContent).toContain("method: 'DELETE'");
    });

    it('should remove connection from local state on success', () => {
      expect(pageContent).toContain("setConnections((prev) => prev.filter((c) => c.id !== id))");
    });

    it('should clear active connection if deleted connection was active', () => {
      expect(pageContent).toContain('if (activeConnectionId === id)');
      expect(pageContent).toContain('setActiveConnectionId(null)');
    });
  });

  describe('Error handling', () => {
    it('should have an apiError state', () => {
      expect(pageContent).toContain('const [apiError, setApiError] = useState<string | null>(null)');
    });

    it('should display error messages from API responses', () => {
      expect(pageContent).toContain('apiError &&');
      expect(pageContent).toContain('{apiError}');
    });

    it('should have a dismiss button for errors', () => {
      expect(pageContent).toContain("onClick={() => setApiError(null)}");
      expect(pageContent).toContain('aria-label="Dismiss error"');
    });

    it('should handle non-ok responses and extract error messages', () => {
      expect(pageContent).toContain('if (!res.ok)');
      expect(pageContent).toContain('throw new Error(data.error');
    });

    it('should catch errors in delete handler', () => {
      expect(pageContent).toContain("setApiError(err.message || 'Failed to delete connection')");
    });

    it('should catch errors in form submit handler', () => {
      expect(pageContent).toContain("setApiError(err.message || 'Failed to save connection')");
    });
  });
});
