import { getSSHManager } from '../ssh/ssh-manager';

export interface RunningService {
  id: string;
  name: string;
  type: 'listening' | 'systemd' | 'worker' | 'docker';
  status: string;
  pid?: number;
  user?: string;
  ports: string[];
  workingDir?: string;
  execPath?: string;
  unitFile?: string;
  description?: string;
  cmdline?: string;
  image?: string; // for docker
}

export interface ServiceScanResult {
  vmId: string;
  scannedAt: string;
  services: RunningService[];
}

export interface ServiceDetector {
  detectServices(vmId: string): Promise<ServiceScanResult>;
}

/**
 * Script executed on the remote VM to gather running services information.
 */
export const SERVICE_SCAN_SCRIPT = `
echo "===NET_START==="
if command -v ss >/dev/null 2>&1; then
  ss -tulpnH 2>/dev/null
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulpn 2>/dev/null
fi
echo "===NET_END==="

echo "===PID_DETAILS_START==="
pids=$(ss -tulpnH 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
for p in $pids; do
  if [ -d "/proc/$p" ]; then
    cwd=$(readlink -f /proc/$p/cwd 2>/dev/null)
    exe=$(readlink -f /proc/$p/exe 2>/dev/null)
    user=$(ps -o user= -p $p 2>/dev/null | tr -d ' ')
    cmd=$(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | head -c 500)
    echo "$p|$user|$cwd|$exe|$cmd"
  fi
done
echo "===PID_DETAILS_END==="

echo "===SYSTEMD_START==="
if command -v systemctl >/dev/null 2>&1; then
  units=$(systemctl list-units --type=service --state=running --no-pager --no-legend --plain 2>/dev/null | awk '{print $1}')
  if [ -n "$units" ]; then
    systemctl show $units --property=Id,Description,ExecStart,WorkingDirectory,FragmentPath,MainPID,ActiveState 2>/dev/null
  fi
fi
echo "===SYSTEMD_END==="

echo "===WORKERS_START==="
ps -eo pid,user,args --no-headers 2>/dev/null | grep -E '(/var/www|/home/|/opt/|node |python |php |go |java )' | grep -v 'grep' | head -n 40 | while IFS= read -r line; do
  p=$(echo "$line" | awk '{print $1}')
  if [ -n "$p" ] && [ -d "/proc/$p" ]; then
    cwd=$(readlink -f /proc/$p/cwd 2>/dev/null)
    exe=$(readlink -f /proc/$p/exe 2>/dev/null)
    user=$(ps -o user= -p $p 2>/dev/null | tr -d ' ')
    cmd=$(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | head -c 500)
    echo "$p|$user|$cwd|$exe|$cmd"
  fi
done
echo "===WORKERS_END==="

echo "===DOCKER_START==="
if command -v docker >/dev/null 2>&1; then
  docker ps --no-trunc --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>/dev/null
fi
echo "===DOCKER_END==="
`.trim();

interface PidDetail {
  pid: number;
  user: string;
  cwd: string;
  exe: string;
  cmdline: string;
}

/**
 * Extracts content between marker delimiters.
 */
function extractSection(output: string, startMarker: string, endMarker: string): string {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker);
  if (start === -1 || end === -1 || start >= end) {
    return '';
  }
  return output.slice(start + startMarker.length, end).trim();
}

/**
 * Parses pipe-delimited PID details output.
 */
export function parsePidDetails(raw: string): Map<number, PidDetail> {
  const map = new Map<number, PidDetail>();
  if (!raw) return map;

  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length >= 5) {
      const pid = parseInt(parts[0], 10);
      if (!isNaN(pid)) {
        map.set(pid, {
          pid,
          user: parts[1],
          cwd: parts[2],
          exe: parts[3],
          cmdline: parts.slice(4).join('|'),
        });
      }
    }
  }
  return map;
}

/**
 * Parses `ss -tulpnH` output lines to identify listening ports and processes.
 */
export function parseListeningSockets(
  rawNet: string,
  pidDetails: Map<number, PidDetail>
): RunningService[] {
  const services: RunningService[] = [];
  if (!rawNet) return services;

  const lines = rawNet.split('\n');
  const seenPidPorts = new Map<number, { ports: Set<string>; names: Set<string> }>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Extract port from local address column (usually 4th or 5th column, e.g. 0.0.0.0:80 or :::8080 or [::]:3306 or *:22)
    // Example: tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))
    const portMatch = trimmed.match(/:(\d+)\s+/);
    const port = portMatch ? portMatch[1] : null;

    // Extract users:(("process_name",pid=123,fd=...))
    const usersMatch = trimmed.match(/users:\(\((.*?)\)\)/);
    if (usersMatch) {
      const userEntries = usersMatch[1].split('),(');
      for (const entry of userEntries) {
        const nameMatch = entry.match(/^"([^"]+)"/);
        const pidMatch = entry.match(/pid=(\d+)/);

        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          const name = nameMatch ? nameMatch[1] : 'unknown';

          if (!seenPidPorts.has(pid)) {
            seenPidPorts.set(pid, { ports: new Set(), names: new Set() });
          }
          const item = seenPidPorts.get(pid)!;
          if (port) item.ports.add(port);
          item.names.add(name);
        }
      }
    } else if (port) {
      // Netstat fallback e.g. tcp 0 0 0.0.0.0:80 0.0.0.0:* LISTEN 1234/nginx
      const netstatPidMatch = trimmed.match(/(\d+)\/([^\s]+)$/);
      if (netstatPidMatch) {
        const pid = parseInt(netstatPidMatch[1], 10);
        const name = netstatPidMatch[2];
        if (!seenPidPorts.has(pid)) {
          seenPidPorts.set(pid, { ports: new Set(), names: new Set() });
        }
        const item = seenPidPorts.get(pid)!;
        item.ports.add(port);
        item.names.add(name);
      }
    }
  }

  // Convert to RunningService array
  for (const [pid, info] of seenPidPorts.entries()) {
    const detail = pidDetails.get(pid);
    const primaryName = Array.from(info.names)[0] || 'service';
    const sortedPorts = Array.from(info.ports).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    services.push({
      id: `listen-${pid}`,
      name: primaryName,
      type: 'listening',
      status: 'running',
      pid,
      user: detail?.user || undefined,
      ports: sortedPorts,
      workingDir: detail?.cwd || undefined,
      execPath: detail?.exe || undefined,
      cmdline: detail?.cmdline || undefined,
    });
  }

  return services;
}

/**
 * Parses systemctl show property blocks.
 */
export function parseSystemdUnits(
  rawSystemd: string,
  pidDetails: Map<number, PidDetail>
): RunningService[] {
  const services: RunningService[] = [];
  if (!rawSystemd) return services;

  // Blocks are separated by double newlines or Id= lines
  const lines = rawSystemd.split('\n');
  let currentUnit: Record<string, string> = {};

  const pushCurrent = () => {
    if (currentUnit.Id && (currentUnit.ActiveState === 'active' || !currentUnit.ActiveState)) {
      const pid = currentUnit.MainPID ? parseInt(currentUnit.MainPID, 10) : undefined;
      const validPid = pid && pid > 0 ? pid : undefined;
      const detail = validPid ? pidDetails.get(validPid) : undefined;

      // Extract binary path from ExecStart: { path=/usr/sbin/nginx ; argv[]=/usr/sbin/nginx ... }
      let execPath: string | undefined;
      if (currentUnit.ExecStart) {
        const execMatch = currentUnit.ExecStart.match(/path=([^;\s]+)/);
        if (execMatch) {
          execPath = execMatch[1];
        }
      }

      services.push({
        id: `systemd-${currentUnit.Id}`,
        name: currentUnit.Id,
        type: 'systemd',
        status: currentUnit.ActiveState || 'active',
        pid: validPid,
        user: detail?.user || undefined,
        ports: [],
        workingDir: (currentUnit.WorkingDirectory && currentUnit.WorkingDirectory !== '') 
          ? currentUnit.WorkingDirectory 
          : detail?.cwd || undefined,
        execPath: execPath || detail?.exe || undefined,
        unitFile: currentUnit.FragmentPath || undefined,
        description: currentUnit.Description || undefined,
        cmdline: detail?.cmdline || undefined,
      });
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentUnit.Id) {
        pushCurrent();
        currentUnit = {};
      }
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);

      if (key === 'Id' && currentUnit.Id) {
        pushCurrent();
        currentUnit = {};
      }
      currentUnit[key] = val;
    }
  }

  if (currentUnit.Id) {
    pushCurrent();
  }

  return services;
}

/**
 * Parses Docker ps output.
 */
export function parseDockerContainers(rawDocker: string): RunningService[] {
  const services: RunningService[] = [];
  if (!rawDocker) return services;

  const lines = rawDocker.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length >= 4) {
      const [id, name, image, status, portsRaw] = parts;
      const ports: string[] = [];
      if (portsRaw) {
        // e.g. 0.0.0.0:8080->80/tcp, :::8080->80/tcp
        const portMatches = portsRaw.matchAll(/:(\d+)->/g);
        for (const m of portMatches) {
          if (!ports.includes(m[1])) {
            ports.push(m[1]);
          }
        }
      }

      services.push({
        id: `docker-${id}`,
        name: name || id,
        type: 'docker',
        status: status || 'running',
        ports,
        image: image || undefined,
        description: `Docker Image: ${image}`,
      });
    }
  }
  return services;
}

/**
 * Parses worker processes that are not listening on network ports.
 */
export function parseWorkers(
  rawWorkers: string,
  existingPids: Set<number>
): RunningService[] {
  const services: RunningService[] = [];
  if (!rawWorkers) return services;

  const lines = rawWorkers.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length >= 5) {
      const pid = parseInt(parts[0], 10);
      if (isNaN(pid) || existingPids.has(pid)) continue;

      const user = parts[1];
      const cwd = parts[2];
      const exe = parts[3];
      const cmdline = parts.slice(4).join('|');

      // Determine a friendly name from cmdline or exe
      let name = exe ? exe.split('/').pop() || 'worker' : 'worker';
      if (cmdline) {
        const cmdParts = cmdline.trim().split(/\s+/);
        if (cmdParts.length > 1 && (name === 'node' || name === 'python' || name === 'php')) {
          name = `${name} ${cmdParts[1].split('/').pop()}`;
        }
      }

      services.push({
        id: `worker-${pid}`,
        name,
        type: 'worker',
        status: 'running',
        pid,
        user: user || undefined,
        ports: [],
        workingDir: cwd || undefined,
        execPath: exe || undefined,
        cmdline: cmdline || undefined,
      });
    }
  }

  return services;
}

/**
 * Merges and deduplicates services across listening, systemd, docker, and workers.
 */
export function mergeServices(
  listening: RunningService[],
  systemd: RunningService[],
  workers: RunningService[],
  docker: RunningService[]
): RunningService[] {
  const merged: RunningService[] = [];
  const handledPids = new Set<number>();
  const handledNames = new Set<string>();

  // 1. Process listening services first (highest user interest because of ports & web apps)
  for (const listen of listening) {
    if (listen.pid) handledPids.add(listen.pid);
    handledNames.add(listen.name.toLowerCase());

    // Check if this listening service matches a systemd unit by PID or name
    const matchingSystemd = systemd.find(
      (s) => (listen.pid && s.pid === listen.pid) || 
             s.name.toLowerCase().startsWith(listen.name.toLowerCase() + '.')
    );

    if (matchingSystemd) {
      listen.unitFile = matchingSystemd.unitFile;
      listen.description = matchingSystemd.description;
      if (!listen.workingDir && matchingSystemd.workingDir) {
        listen.workingDir = matchingSystemd.workingDir;
      }
      if (!listen.execPath && matchingSystemd.execPath) {
        listen.execPath = matchingSystemd.execPath;
      }
    }

    merged.push(listen);
  }

  // 2. Process systemd services (add non-listening ones)
  for (const sys of systemd) {
    if (sys.pid && handledPids.has(sys.pid)) {
      continue;
    }
    const cleanName = sys.name.replace(/\.service$/, '').toLowerCase();
    if (handledNames.has(cleanName)) {
      continue;
    }

    if (sys.pid) handledPids.add(sys.pid);
    merged.push(sys);
  }

  // 3. Process workers (non-listening background processes)
  for (const worker of workers) {
    if (worker.pid && !handledPids.has(worker.pid)) {
      handledPids.add(worker.pid);
      merged.push(worker);
    }
  }

  // 4. Process Docker containers
  for (const doc of docker) {
    merged.push(doc);
  }

  return merged;
}

export class ServiceDetectorImpl implements ServiceDetector {
  private sshManager: { executeCommand(vmId: string, command: string): Promise<string> };

  constructor(sshManager?: { executeCommand(vmId: string, command: string): Promise<string> }) {
    this.sshManager = sshManager || getSSHManager();
  }

  async detectServices(vmId: string): Promise<ServiceScanResult> {
    const rawOutput = await this.sshManager.executeCommand(vmId, SERVICE_SCAN_SCRIPT);

    const netSection = extractSection(rawOutput, '===NET_START===', '===NET_END===');
    const pidSection = extractSection(rawOutput, '===PID_DETAILS_START===', '===PID_DETAILS_END===');
    const systemdSection = extractSection(rawOutput, '===SYSTEMD_START===', '===SYSTEMD_END===');
    const workersSection = extractSection(rawOutput, '===WORKERS_START===', '===WORKERS_END===');
    const dockerSection = extractSection(rawOutput, '===DOCKER_START===', '===DOCKER_END===');

    const pidDetails = parsePidDetails(pidSection);
    const listening = parseListeningSockets(netSection, pidDetails);
    const systemd = parseSystemdUnits(systemdSection, pidDetails);
    const docker = parseDockerContainers(dockerSection);

    const existingPids = new Set<number>();
    for (const l of listening) if (l.pid) existingPids.add(l.pid);
    for (const s of systemd) if (s.pid) existingPids.add(s.pid);

    const workers = parseWorkers(workersSection, existingPids);

    const services = mergeServices(listening, systemd, workers, docker);

    return {
      vmId,
      scannedAt: new Date().toISOString(),
      services,
    };
  }
}

let serviceDetectorInstance: ServiceDetector | null = null;

export function getServiceDetector(): ServiceDetector {
  if (!serviceDetectorInstance) {
    serviceDetectorInstance = new ServiceDetectorImpl();
  }
  return serviceDetectorInstance;
}

export function createServiceDetector(
  sshManager?: { executeCommand(vmId: string, command: string): Promise<string> }
): ServiceDetectorImpl {
  return new ServiceDetectorImpl(sshManager);
}
