import { describe, it, expect } from 'vitest';
import {
  deriveApiUrlFromConsoleUrl,
  formatK8sAge,
  normalizeHttpUrl,
  parseOAuthTokenFromLocation,
  sanitizeOcpInput,
  validateConfigMapKey,
  validateK8sName,
} from '@/lib/ocp/ocp-urls';

describe('OCP URL & Name Helpers', () => {
  describe('sanitizeOcpInput', () => {
    it('trims whitespace and strips control characters', () => {
      expect(sanitizeOcpInput('  brimo\x00\n\t ')).toBe('brimo');
    });
  });

  describe('normalizeHttpUrl', () => {
    it('normalizes trailing slashes on https URLs', () => {
      expect(
        normalizeHttpUrl('https://console-openshift-console.apps.ocp-new-dev.bri.co.id///')
      ).toBe('https://console-openshift-console.apps.ocp-new-dev.bri.co.id');
    });

    it('rejects empty or non-HTTP(S) schemes', () => {
      expect(() => normalizeHttpUrl('')).toThrow('URL is required');
      expect(() => normalizeHttpUrl('not-a-url')).toThrow('Invalid URL format');
      expect(() => normalizeHttpUrl('ftp://example.com')).toThrow('https:// or http://');
    });
  });

  describe('deriveApiUrlFromConsoleUrl', () => {
    it('derives OpenShift 4 API URL from console-openshift-console.apps URL', () => {
      expect(
        deriveApiUrlFromConsoleUrl(
          'https://console-openshift-console.apps.ocp-new-dev.bri.co.id/'
        )
      ).toBe('https://api.ocp-new-dev.bri.co.id:6443');
    });

    it('derives API URL from console.apps URL', () => {
      expect(
        deriveApiUrlFromConsoleUrl('https://console.apps.prod.example.com')
      ).toBe('https://api.prod.example.com:6443');
    });

    it('preserves explicit port on api.* URL', () => {
      expect(deriveApiUrlFromConsoleUrl('https://api.cluster.local:8443')).toBe(
        'https://api.cluster.local:8443'
      );
    });
  });

  describe('validateK8sName', () => {
    it('accepts valid namespace, pod, and container names', () => {
      expect(validateK8sName('brimo-dev')).toBe(true);
      expect(validateK8sName('brimo-api-7f8b9c6d4-x2k9p')).toBe(true);
      expect(validateK8sName('app.v1')).toBe(true);
    });

    it('rejects path traversal and special characters', () => {
      expect(validateK8sName('')).toBe(false);
      expect(validateK8sName('../kube-system')).toBe(false);
      expect(validateK8sName('ns/pods')).toBe(false);
      expect(validateK8sName('pod?tailLines=1')).toBe(false);
      expect(validateK8sName('a'.repeat(254))).toBe(false);
    });
  });

  describe('validateConfigMapKey', () => {
    it('accepts valid configmap keys and rejects invalid ones', () => {
      expect(validateConfigMapKey('application.yaml')).toBe(true);
      expect(validateConfigMapKey('APP_ENV-1')).toBe(true);
      expect(validateConfigMapKey('')).toBe(false);
      expect(validateConfigMapKey('bad key')).toBe(false);
      expect(validateConfigMapKey('bad/key')).toBe(false);
    });
  });

  describe('parseOAuthTokenFromLocation', () => {
    it('extracts access_token and expires_in from hash fragment', () => {
      const parsed = parseOAuthTokenFromLocation(
        'https://oauth-openshift.apps.ocp.bri.co.id/oauth/token/implicit#access_token=sha256~abc123&expires_in=86400&token_type=Bearer'
      );
      expect(parsed).toEqual({
        accessToken: 'sha256~abc123',
        expiresIn: 86400,
        tokenType: 'Bearer',
      });
    });

    it('returns null when access_token is absent', () => {
      expect(parseOAuthTokenFromLocation('https://sso.bri.co.id/login')).toBeNull();
      expect(parseOAuthTokenFromLocation('')).toBeNull();
    });
  });

  describe('formatK8sAge', () => {
    it('formats recent and older timestamps cleanly', () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatK8sAge(fiveMinsAgo)).toBe('5m');
      expect(formatK8sAge(undefined)).toBe('-');
    });
  });
});
