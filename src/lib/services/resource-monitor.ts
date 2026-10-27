import { getSSHManager } from '../ssh/ssh-manager';

export interface VMResources {
  cpuPercent: number;
  loadAvg: [number, number, number];
  ram: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    percent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    percent: number;
    mount: string;
  };
  uptime: string;
}

export const RESOURCE_SCAN_SCRIPT = `
echo "===UPTIME_START==="
uptime -p 2>/dev/null || uptime 2>/dev/null
echo "===UPTIME_END==="

echo "===RAM_START==="
free -b 2>/dev/null || free -m 2>/dev/null
echo "===RAM_END==="

echo "===DISK_START==="
df -B1 / 2>/dev/null || df -k / 2>/dev/null
echo "===DISK_END==="

echo "===CPU_START==="
top -bn1 2>/dev/null | grep -i "Cpu" | head -n 1
cat /proc/loadavg 2>/dev/null
echo "===CPU_END==="
`.trim();

function extractSection(output: string, startMarker: string, endMarker: string): string {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker);
  if (start === -1 || end === -1 || start >= end) {
    return '';
  }
  return output.slice(start + startMarker.length, end).trim();
}

export function parseUptime(raw: string): string {
  if (!raw) return 'Unknown';
  // uptime -p outputs e.g. "up 42 days, 3 hours"
  if (raw.startsWith('up ')) {
    return raw;
  }
  // fallback full uptime output: "16:44:00 up 42 days, 3:10, 2 users, load average..."
  const match = raw.match(/up\s+([^,]+(?:,\s*[^,]+)?)/i);
  return match ? `up ${match[1].trim()}` : raw.split(',')[0].trim();
}

export function parseRam(raw: string): VMResources['ram'] {
  const defaultRam = { totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0 };
  if (!raw) return defaultRam;

  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('mem:')) {
      const parts = line.replace(/mem:/i, '').trim().split(/\s+/).map(Number);
      // Format: total used free shared buff/cache available
      if (parts.length >= 2) {
        const total = parts[0] || 0;
        let used = parts[1] || 0;
        let free = parts[2] || 0;

        // If available is present (column 6), use total - available as more accurate used
        if (parts.length >= 6 && parts[5] > 0) {
          free = parts[5];
          used = total - free;
        }

        const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0;
        return {
          totalBytes: total,
          usedBytes: used,
          freeBytes: free,
          percent,
        };
      }
    }
  }
  return defaultRam;
}

export function parseDisk(raw: string): VMResources['disk'] {
  const defaultDisk = { totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0, mount: '/' };
  if (!raw) return defaultDisk;

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    // Filesystem 1B-blocks Used Available Use% Mounted_on
    if (parts.length >= 6) {
      const total = parseInt(parts[1], 10) || 0;
      const used = parseInt(parts[2], 10) || 0;
      const free = parseInt(parts[3], 10) || 0;
      const percentStr = parts[4].replace('%', '');
      const percent = parseInt(percentStr, 10) || (total > 0 ? Math.round((used / total) * 100) : 0);
      const mount = parts[5] || '/';

      if (mount === '/' || i === 1) {
        return {
          totalBytes: total,
          usedBytes: used,
          freeBytes: free,
          percent,
          mount,
        };
      }
    }
  }
  return defaultDisk;
}

export function parseCpu(raw: string): { cpuPercent: number; loadAvg: [number, number, number] } {
  let cpuPercent = 0;
  let loadAvg: [number, number, number] = [0, 0, 0];
  if (!raw) return { cpuPercent, loadAvg };

  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Parse %Cpu(s): 4.2 us, 1.8 sy, 0.0 ni, 93.8 id, ...
    if (trimmed.toLowerCase().includes('cpu') && trimmed.includes('id')) {
      const idMatch = trimmed.match(/([\d.,]+)\s*id/i);
      if (idMatch) {
        const idle = parseFloat(idMatch[1].replace(',', '.'));
        if (!isNaN(idle)) {
          cpuPercent = Math.min(100, Math.max(0, Math.round((100 - idle) * 10) / 10));
        }
      }
    }

    // Parse loadavg line e.g. 0.15 0.20 0.18 1/245 4956
    const loadMatch = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (loadMatch) {
      loadAvg = [
        parseFloat(loadMatch[1]) || 0,
        parseFloat(loadMatch[2]) || 0,
        parseFloat(loadMatch[3]) || 0,
      ];
      // Fallback cpu estimate if top didn't match
      if (cpuPercent === 0 && loadAvg[0] > 0) {
        cpuPercent = Math.min(100, Math.round(loadAvg[0] * 25));
      }
    }
  }

  return { cpuPercent, loadAvg };
}

export class ResourceMonitor {
  private sshManager: { executeCommand(vmId: string, command: string): Promise<string> };

  constructor(sshManager?: { executeCommand(vmId: string, command: string): Promise<string> }) {
    this.sshManager = sshManager || getSSHManager();
  }

  async getResources(vmId: string): Promise<VMResources> {
    const raw = await this.sshManager.executeCommand(vmId, RESOURCE_SCAN_SCRIPT);

    const uptimeSection = extractSection(raw, '===UPTIME_START===', '===UPTIME_END===');
    const ramSection = extractSection(raw, '===RAM_START===', '===RAM_END===');
    const diskSection = extractSection(raw, '===DISK_START===', '===DISK_END===');
    const cpuSection = extractSection(raw, '===CPU_START===', '===CPU_END===');

    const uptime = parseUptime(uptimeSection);
    const ram = parseRam(ramSection);
    const disk = parseDisk(diskSection);
    const { cpuPercent, loadAvg } = parseCpu(cpuSection);

    return {
      cpuPercent,
      loadAvg,
      ram,
      disk,
      uptime,
    };
  }
}

let monitorInstance: ResourceMonitor | null = null;

export function getResourceMonitor(): ResourceMonitor {
  if (!monitorInstance) {
    monitorInstance = new ResourceMonitor();
  }
  return monitorInstance;
}
