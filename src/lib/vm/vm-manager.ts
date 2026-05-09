import crypto from 'crypto';
import net from 'net';
import { getDb } from '../db/index';
import { encrypt } from '../crypto/credential-store';

/**
 * VM configuration stored in the database.
 */
export interface VMConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  encryptedPassword: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * VM status tracking.
 */
export interface VMStatus {
  vmId: string;
  status: 'online' | 'offline' | 'unreachable';
  lastChecked: Date;
  failCount: number;
}

/**
 * Input for adding a new VM (without auto-generated fields).
 */
export type AddVMInput = Omit<VMConfig, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Interface for VM management operations.
 */
export interface VMManager {
  listVMs(): Promise<VMConfig[]>;
  addVM(config: AddVMInput): Promise<VMConfig>;
  getVMStatus(id: string): Promise<VMStatus>;
  checkAllStatuses(): Promise<VMStatus[]>;
}

/**
 * Raw row shape from the vm_status table.
 */
interface VMStatusRow {
  vm_id: string;
  status: string;
  last_checked: string | null;
  fail_count: number;
}

/**
 * Attempts a TCP connection to the given host:port with a timeout.
 * Returns true if the connection succeeds, false otherwise.
 * Extracted as a separate function so it can be mocked in tests.
 */
export function checkVMConnectivity(host: string, port: number, timeoutMs: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      cleanup();
      resolve(true);
    });

    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    socket.on('error', () => {
      cleanup();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Raw row shape from the vms table.
 */
interface VMRow {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  encrypted_password: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  created_at: string;
  updated_at: string;
}

/**
 * Converts a database row to a VMConfig object.
 */
function rowToVMConfig(row: VMRow): VMConfig {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    username: row.username,
    encryptedPassword: row.encrypted_password,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Lists all VMs from the database.
 */
export async function listVMs(): Promise<VMConfig[]> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM vms ORDER BY created_at DESC').all() as VMRow[];
  return rows.map(rowToVMConfig);
}

/**
 * Adds a new VM to the database.
 * Encrypts the password using the credential store before storing.
 * Also creates an initial vm_status record with status 'offline'.
 */
export async function addVM(config: AddVMInput): Promise<VMConfig> {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');

  // Encrypt the password
  const encrypted = encrypt(config.encryptedPassword);

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // Insert the VM record
  db.prepare(
    `INSERT INTO vms (id, label, host, port, username, encrypted_password, encryption_iv, encryption_auth_tag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    config.label,
    config.host,
    config.port,
    config.username,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.authTag,
    now,
    now
  );

  // Create initial vm_status record
  db.prepare(
    `INSERT INTO vm_status (vm_id, status, last_checked, fail_count)
     VALUES (?, 'offline', NULL, 0)`
  ).run(id);

  return {
    id,
    label: config.label,
    host: config.host,
    port: config.port,
    username: config.username,
    encryptedPassword: encrypted.ciphertext,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

/**
 * Gets the current status of a VM from the database.
 */
export async function getVMStatus(id: string): Promise<VMStatus> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM vm_status WHERE vm_id = ?').get(id) as VMStatusRow | undefined;

  if (!row) {
    throw new Error(`VM status not found for id: ${id}`);
  }

  return {
    vmId: row.vm_id,
    status: row.status as VMStatus['status'],
    lastChecked: row.last_checked ? new Date(row.last_checked) : new Date(0),
    failCount: row.fail_count,
  };
}

/**
 * Checks connectivity for all VMs and updates their statuses.
 * Uses the provided connectivity checker function (defaults to checkVMConnectivity).
 * This parameter allows dependency injection for testing.
 */
export async function checkAllStatuses(
  connectivityChecker: (host: string, port: number) => Promise<boolean> = checkVMConnectivity
): Promise<VMStatus[]> {
  const db = getDb();
  const vms = db.prepare('SELECT id, host, port FROM vms').all() as { id: string; host: string; port: number }[];

  const results: VMStatus[] = [];

  for (const vm of vms) {
    const isOnline = await connectivityChecker(vm.host, vm.port);
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

    // Get current status row
    const currentRow = db.prepare('SELECT * FROM vm_status WHERE vm_id = ?').get(vm.id) as VMStatusRow | undefined;
    const currentFailCount = currentRow?.fail_count ?? 0;

    let newStatus: VMStatus['status'];
    let newFailCount: number;

    if (isOnline) {
      newStatus = 'online';
      newFailCount = 0;
    } else {
      newFailCount = currentFailCount + 1;
      newStatus = newFailCount >= 3 ? 'unreachable' : 'offline';
    }

    // Upsert the status record
    db.prepare(
      `INSERT INTO vm_status (vm_id, status, last_checked, fail_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(vm_id) DO UPDATE SET status = ?, last_checked = ?, fail_count = ?`
    ).run(vm.id, newStatus, now, newFailCount, newStatus, now, newFailCount);

    results.push({
      vmId: vm.id,
      status: newStatus,
      lastChecked: new Date(now),
      failCount: newFailCount,
    });
  }

  return results;
}

/**
 * Creates a VMManager instance with all operations.
 */
export function createVMManager(): VMManager {
  return {
    listVMs,
    addVM,
    getVMStatus,
    checkAllStatuses: () => checkAllStatuses(),
  };
}
