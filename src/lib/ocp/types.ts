export type OcpAuthType = 'oauth_password' | 'token';

export interface OcpClusterPublic {
  id: string;
  label: string;
  consoleUrl: string;
  apiUrl: string;
  authType: OcpAuthType;
  username: string | null;
  defaultNamespace: string | null;
  insecureTls: boolean;
  hasCachedToken: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOcpClusterInput {
  label: string;
  consoleUrl: string;
  apiUrl?: string;
  authType: OcpAuthType;
  username?: string;
  secret: string;
  defaultNamespace?: string;
  insecureTls?: boolean;
}

export interface UpdateOcpClusterInput {
  label?: string;
  consoleUrl?: string;
  apiUrl?: string;
  authType?: OcpAuthType;
  username?: string | null;
  secret?: string;
  defaultNamespace?: string | null;
  insecureTls?: boolean;
}

export interface OcpTestResult {
  connected: boolean;
  username?: string | null;
  serverVersion?: string | null;
  authType: OcpAuthType;
  projectCount?: number;
  error?: string;
}

export interface OcpProject {
  name: string;
  displayName?: string;
  status: string;
  createdAt?: string;
}

export interface OcpPod {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  readyCount: number;
  totalCount: number;
  restarts: number;
  podIP: string | null;
  nodeName: string | null;
  containers: string[];
  age: string;
  createdAt?: string;
}

export interface OcpDeployment {
  name: string;
  namespace: string;
  kind: 'Deployment' | 'DeploymentConfig';
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  images: string[];
  age: string;
  createdAt?: string;
}

export interface OcpService {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string | null;
  ports: string[];
  age: string;
}

export interface OcpRoute {
  name: string;
  namespace: string;
  host: string;
  path: string;
  tls: boolean;
  targetService: string;
  targetPort: string;
  url: string;
  age: string;
}

export interface OcpConfigMap {
  name: string;
  namespace: string;
  data: Record<string, string>;
  binaryKeys: string[];
  keyCount: number;
  immutable: boolean;
  age: string;
  createdAt?: string;
}

export interface OcpWorkloadsResponse {
  namespace: string;
  pods: OcpPod[];
  deployments: OcpDeployment[];
  services: OcpService[];
  routes: OcpRoute[];
  configMaps: OcpConfigMap[];
  warnings?: string[];
}

export interface OcpEvent {
  type: string;
  reason: string;
  message: string;
  count: number;
  lastTimestamp: string;
  source: string;
}

export type OcpDescribeKind =
  | 'Pod'
  | 'Deployment'
  | 'DeploymentConfig'
  | 'Service'
  | 'Route'
  | 'ConfigMap';

export interface OcpDescribeResponse {
  kind: OcpDescribeKind;
  name: string;
  namespace: string;
  resource: Record<string, unknown>;
  events: OcpEvent[];
}

export type OcpActionPayload =
  | {
      action: 'scale';
      namespace: string;
      kind: 'Deployment' | 'DeploymentConfig';
      name: string;
      replicas: number;
    }
  | {
      action: 'restart';
      namespace: string;
      kind: 'Deployment' | 'DeploymentConfig';
      name: string;
    }
  | {
      action: 'delete-pod';
      namespace: string;
      name: string;
    };
