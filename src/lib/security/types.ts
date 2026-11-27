export type SecurityProvider = 'sonarqube' | 'cxsast' | 'cxsca';

export type SecurityAuthType = 'password' | 'token';

export interface SecurityConnectionPublic {
  id: string;
  provider: SecurityProvider;
  label: string;
  baseUrl: string;
  authType: SecurityAuthType;
  tenantAccount: string | null;
  username: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  insecureTls: boolean;
  hasCachedToken: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecurityConnectionInput {
  provider: SecurityProvider;
  label: string;
  baseUrl: string;
  authType: SecurityAuthType;
  tenantAccount?: string;
  username?: string;
  clientId?: string;
  clientSecret?: string;
  secret: string;
  insecureTls?: boolean;
}

export interface UpdateSecurityConnectionInput {
  label?: string;
  baseUrl?: string;
  authType?: SecurityAuthType;
  tenantAccount?: string | null;
  username?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  secret?: string;
  insecureTls?: boolean;
}

export interface SecurityTestResult {
  connected: boolean;
  provider: SecurityProvider;
  authType: SecurityAuthType;
  version?: string | null;
  username?: string | null;
  projectCount?: number;
  error?: string;
}

export interface SecurityMetricBadge {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

export interface SecurityProjectSummary {
  id: string;
  key: string;
  name: string;
  lastScanDate: string | null;
  statusLabel: string | null;
  statusTone?: 'success' | 'warning' | 'danger' | 'neutral';
  metrics?: SecurityMetricBadge[];
  portalUrl?: string;
}

export interface SecurityScanHistoryItem {
  id: string;
  status: string;
  date: string | null;
  branch?: string | null;
  loc?: number | null;
  riskScore?: number | null;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
  infoCount?: number;
}

export interface SecurityFinding {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  location: string;
  status?: string;
  description?: string;
  recommendation?: string;
}

export interface SecurityProjectDetails {
  provider: SecurityProvider;
  projectId: string;
  projectKey: string;
  projectName: string;
  portalUrl?: string;
  qualityGateStatus?: string | null;
  metrics: SecurityMetricBadge[];
  scans: SecurityScanHistoryItem[];
  findings: SecurityFinding[];
  notes?: string[];
}
