import { describe, it, expect } from 'vitest';
import {
  deriveCxScaEndpoints,
  normalizeSecurityBaseUrl,
} from '@/lib/security/security-urls';

describe('Security URLs', () => {
  it('normalizes pasted SonarQube login URLs to clean origin', () => {
    expect(
      normalizeSecurityBaseUrl(
        'sonarqube',
        'https://sonarqube-enterprise.bri.co.id/sessions/new?return_to=%2F'
      )
    ).toBe('https://sonarqube-enterprise.bri.co.id');
  });

  it('normalizes pasted Checkmarx SAST auth & webclient URLs to clean origin', () => {
    expect(
      normalizeSecurityBaseUrl(
        'cxsast',
        'https://sast.bri.co.id/CxRestAPI/auth/#/login?ReturnUrl=%2FCxRestAPI%2Fauth%2Fidentity'
      )
    ).toBe('https://sast.bri.co.id');

    expect(
      normalizeSecurityBaseUrl(
        'cxsast',
        'https://sast.bri.co.id/CxWebClient/Projects.aspx'
      )
    ).toBe('https://sast.bri.co.id');
  });

  it('derives EU and US Checkmarx SCA identity and API endpoints', () => {
    expect(deriveCxScaEndpoints('https://eu.sca.checkmarx.net/')).toEqual({
      portalUrl: 'https://eu.sca.checkmarx.net',
      identityUrl: 'https://eu.platform.checkmarx.net',
      apiUrl: 'https://eu.api-sca.checkmarx.net',
    });

    expect(deriveCxScaEndpoints('https://sca.checkmarx.net/')).toEqual({
      portalUrl: 'https://sca.checkmarx.net',
      identityUrl: 'https://platform.checkmarx.net',
      apiUrl: 'https://api-sca.checkmarx.net',
    });
  });

  it('rejects non-HTTP(S) URLs', () => {
    expect(() =>
      normalizeSecurityBaseUrl('sonarqube', 'ftp://sonarqube.local')
    ).toThrow('https:// or http://');
  });
});
