import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseUptime,
  parseRam,
  parseDisk,
  parseCpu,
  ResourceMonitor,
} from '@/lib/services/resource-monitor';

describe('Resource Monitor', () => {
  describe('parseUptime', () => {
    it('should parse uptime -p format', () => {
      expect(parseUptime('up 42 days, 3 hours, 10 minutes')).toBe('up 42 days, 3 hours, 10 minutes');
    });

    it('should parse traditional uptime output', () => {
      const raw = ' 16:44:00 up 10 days,  3:10,  2 users,  load average: 0.12, 0.08, 0.05';
      expect(parseUptime(raw)).toContain('up 10 days');
    });

    it('should return Unknown for empty input', () => {
      expect(parseUptime('')).toBe('Unknown');
    });
  });

  describe('parseRam', () => {
    it('should parse free -b output with available bytes', () => {
      const raw = `
               total        used        free      shared  buff/cache   available
Mem:     8241238016  3245123000  2100000000   100000000  2896115016  4996115016
Swap:    2147483648           0  2147483648
`;
      const ram = parseRam(raw);
      expect(ram.totalBytes).toBe(8241238016);
      expect(ram.freeBytes).toBe(4996115016); // available
      expect(ram.usedBytes).toBe(8241238016 - 4996115016);
      expect(ram.percent).toBeGreaterThan(0);
      expect(ram.percent).toBeLessThan(100);
    });

    it('should handle empty input', () => {
      const ram = parseRam('');
      expect(ram.totalBytes).toBe(0);
      expect(ram.percent).toBe(0);
    });
  });

  describe('parseDisk', () => {
    it('should parse df output for root filesystem', () => {
      const raw = `
Filesystem     1B-blocks        Used   Available Use% Mounted on
/dev/sda1    52000000000 32000000000 20000000000  62% /
tmpfs         4000000000           0  4000000000   0% /dev/shm
`;
      const disk = parseDisk(raw);
      expect(disk.totalBytes).toBe(52000000000);
      expect(disk.usedBytes).toBe(32000000000);
      expect(disk.freeBytes).toBe(20000000000);
      expect(disk.percent).toBe(62);
      expect(disk.mount).toBe('/');
    });

    it('should handle empty input', () => {
      const disk = parseDisk('');
      expect(disk.totalBytes).toBe(0);
      expect(disk.percent).toBe(0);
    });
  });

  describe('parseCpu', () => {
    it('should parse %Cpu(s) line from top', () => {
      const raw = `
%Cpu(s):  4.2 us,  1.8 sy,  0.0 ni, 93.8 id,  0.1 wa,  0.0 hi,  0.1 si,  0.0 st
0.15 0.20 0.18 1/245 4956
`;
      const { cpuPercent, loadAvg } = parseCpu(raw);
      expect(cpuPercent).toBe(6.2); // 100 - 93.8
      expect(loadAvg).toEqual([0.15, 0.2, 0.18]);
    });

    it('should fallback to loadavg estimate if top not present', () => {
      const raw = '0.50 0.40 0.30 2/250 1234';
      const { cpuPercent, loadAvg } = parseCpu(raw);
      expect(loadAvg).toEqual([0.5, 0.4, 0.3]);
      expect(cpuPercent).toBeGreaterThan(0);
    });
  });

  describe('ResourceMonitor class', () => {
    it('should execute command and return aggregated resources', async () => {
      const mockExecute = vi.fn().mockResolvedValue(`
===UPTIME_START===
up 5 days, 12 hours
===UPTIME_END===
===RAM_START===
Mem: 8000000000 4000000000 2000000000 0 2000000000 4000000000
===RAM_END===
===DISK_START===
Filesystem 1B-blocks Used Available Use% Mounted on
/dev/sda1 100000000000 40000000000 60000000000 40% /
===DISK_END===
===CPU_START===
%Cpu(s): 10.0 us, 5.0 sy, 0.0 ni, 85.0 id, 0.0 wa
0.25 0.30 0.35 1/100 123
===CPU_END===
`);
      const monitor = new ResourceMonitor({ executeCommand: mockExecute });
      const res = await monitor.getResources('vm-1');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(res.uptime).toBe('up 5 days, 12 hours');
      expect(res.cpuPercent).toBe(15);
      expect(res.ram.percent).toBe(50);
      expect(res.disk.percent).toBe(40);
      expect(res.loadAvg).toEqual([0.25, 0.3, 0.35]);
    });
  });
});
