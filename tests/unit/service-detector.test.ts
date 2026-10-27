import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePidDetails,
  parseListeningSockets,
  parseSystemdUnits,
  parseDockerContainers,
  parseWorkers,
  mergeServices,
  ServiceDetectorImpl,
  createServiceDetector,
  RunningService,
} from '@/lib/services/service-detector';

describe('Service Detector', () => {
  describe('parsePidDetails', () => {
    it('should parse PID details pipe-separated output correctly', () => {
      const raw = `
1234|www-data|/var/www/html|/usr/sbin/nginx|nginx: master process
5678|mysql|/var/lib/mysql|/usr/sbin/mysqld|mysqld --daemonize
invalid|user|/cwd|/exe|cmd
`;
      const map = parsePidDetails(raw);
      expect(map.size).toBe(2);

      const nginx = map.get(1234);
      expect(nginx).toBeDefined();
      expect(nginx?.user).toBe('www-data');
      expect(nginx?.cwd).toBe('/var/www/html');
      expect(nginx?.exe).toBe('/usr/sbin/nginx');
      expect(nginx?.cmdline).toBe('nginx: master process');

      const mysql = map.get(5678);
      expect(mysql?.user).toBe('mysql');
      expect(mysql?.cwd).toBe('/var/lib/mysql');
    });

    it('should return empty map for empty input', () => {
      expect(parsePidDetails('').size).toBe(0);
    });
  });

  describe('parseListeningSockets', () => {
    it('should parse ss format with users and pids', () => {
      const rawSs = `
tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6),("nginx",pid=1235,fd=6))
tcp LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=1234,fd=7))
tcp LISTEN 0 128 127.0.0.1:3306 0.0.0.0:* users:(("mysqld",pid=5678,fd=21))
`;
      const pidDetails = parsePidDetails(`
1234|www-data|/var/www/html|/usr/sbin/nginx|nginx: master
5678|mysql|/var/lib/mysql|/usr/sbin/mysqld|mysqld
`);

      const services = parseListeningSockets(rawSs, pidDetails);
      expect(services.length).toBe(3); // pid 1234, pid 1235, pid 5678

      const nginxMaster = services.find((s) => s.pid === 1234);
      expect(nginxMaster).toBeDefined();
      expect(nginxMaster?.name).toBe('nginx');
      expect(nginxMaster?.ports).toEqual(['80', '443']);
      expect(nginxMaster?.workingDir).toBe('/var/www/html');
      expect(nginxMaster?.execPath).toBe('/usr/sbin/nginx');

      const mysqlService = services.find((s) => s.pid === 5678);
      expect(mysqlService?.ports).toEqual(['3306']);
    });

    it('should parse netstat fallback format', () => {
      const rawNetstat = `
tcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN 9999/node
`;
      const pidDetails = parsePidDetails(`
9999|nodeuser|/opt/myapp|/usr/local/bin/node|node server.js
`);

      const services = parseListeningSockets(rawNetstat, pidDetails);
      expect(services.length).toBe(1);
      expect(services[0].name).toBe('node');
      expect(services[0].ports).toEqual(['8080']);
      expect(services[0].workingDir).toBe('/opt/myapp');
    });

    it('should handle empty input', () => {
      const services = parseListeningSockets('', new Map());
      expect(services).toEqual([]);
    });
  });

  describe('parseSystemdUnits', () => {
    it('should parse systemctl show property blocks', () => {
      const rawSystemd = `
Id=nginx.service
Description=A high performance web server
ExecStart={ path=/usr/sbin/nginx ; argv[]=/usr/sbin/nginx -g daemon on; }
WorkingDirectory=/var/www/html
FragmentPath=/lib/systemd/system/nginx.service
MainPID=1234
ActiveState=active

Id=redis.service
Description=Advanced key-value store
ExecStart={ path=/usr/bin/redis-server ; argv[]=/usr/bin/redis-server /etc/redis/redis.conf }
WorkingDirectory=
FragmentPath=/lib/systemd/system/redis.service
MainPID=4321
ActiveState=active
`;
      const pidDetails = parsePidDetails(`
4321|redis|/var/lib/redis|/usr/bin/redis-server|redis-server
`);

      const services = parseSystemdUnits(rawSystemd, pidDetails);
      expect(services.length).toBe(2);

      const nginx = services.find((s) => s.name === 'nginx.service');
      expect(nginx).toBeDefined();
      expect(nginx?.description).toBe('A high performance web server');
      expect(nginx?.execPath).toBe('/usr/sbin/nginx');
      expect(nginx?.workingDir).toBe('/var/www/html');
      expect(nginx?.unitFile).toBe('/lib/systemd/system/nginx.service');

      const redis = services.find((s) => s.name === 'redis.service');
      expect(redis?.workingDir).toBe('/var/lib/redis'); // from pidDetails fallback
    });

    it('should ignore inactive systemd units', () => {
      const raw = `
Id=stopped.service
ActiveState=inactive
MainPID=0
`;
      const services = parseSystemdUnits(raw, new Map());
      expect(services.length).toBe(0);
    });
  });

  describe('parseDockerContainers', () => {
    it('should parse docker ps pipe-delimited format', () => {
      const raw = `
abc123456789|my-redis|redis:7-alpine|Up 2 hours|0.0.0.0:6379->6379/tcp, :::6379->6379/tcp
def987654321|web-api|golang:1.22|Up 5 days|0.0.0.0:8000->80/tcp
`;
      const containers = parseDockerContainers(raw);
      expect(containers.length).toBe(2);
      expect(containers[0].name).toBe('my-redis');
      expect(containers[0].type).toBe('docker');
      expect(containers[0].ports).toEqual(['6379']);
      expect(containers[0].image).toBe('redis:7-alpine');

      expect(containers[1].ports).toEqual(['8000']);
    });
  });

  describe('parseWorkers', () => {
    it('should parse background workers and skip existing PIDs', () => {
      const raw = `
7777|appuser|/home/user/apps/beedle-epay|/home/user/apps/beedle-epay/worker|/home/user/apps/beedle-epay/worker --queue
8888|www-data|/var/www/html|/usr/bin/php|php artisan queue:work
`;
      const existingPids = new Set<number>([7777]); // 7777 is already listening or in systemd

      const workers = parseWorkers(raw, existingPids);
      expect(workers.length).toBe(1);
      expect(workers[0].pid).toBe(8888);
      expect(workers[0].name).toContain('php');
      expect(workers[0].workingDir).toBe('/var/www/html');
    });
  });

  describe('mergeServices', () => {
    it('should merge listening and systemd services with matched info', () => {
      const listening: RunningService[] = [
        {
          id: 'listen-1234',
          name: 'nginx',
          type: 'listening',
          status: 'running',
          pid: 1234,
          ports: ['80', '443'],
          workingDir: '/var/www/html',
        },
      ];

      const systemd: RunningService[] = [
        {
          id: 'systemd-nginx.service',
          name: 'nginx.service',
          type: 'systemd',
          status: 'active',
          pid: 1234,
          ports: [],
          unitFile: '/lib/systemd/system/nginx.service',
          description: 'Nginx Web Server',
        },
        {
          id: 'systemd-cron.service',
          name: 'cron.service',
          type: 'systemd',
          status: 'active',
          pid: 999,
          ports: [],
          unitFile: '/lib/systemd/system/cron.service',
        },
      ];

      const merged = mergeServices(listening, systemd, [], []);
      expect(merged.length).toBe(2);

      const mergedNginx = merged.find((s) => s.name === 'nginx');
      expect(mergedNginx).toBeDefined();
      expect(mergedNginx?.ports).toEqual(['80', '443']);
      expect(mergedNginx?.unitFile).toBe('/lib/systemd/system/nginx.service');
      expect(mergedNginx?.description).toBe('Nginx Web Server');

      const mergedCron = merged.find((s) => s.name === 'cron.service');
      expect(mergedCron).toBeDefined();
    });
  });

  describe('ServiceDetectorImpl', () => {
    it('should execute command and return aggregated services result', async () => {
      const mockExecute = vi.fn().mockResolvedValue(`
===NET_START===
tcp LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("beedle",pid=123,fd=4))
===NET_END===
===PID_DETAILS_START===
123|ubuntu|/home/ubuntu/apps/beedle-epay|/home/ubuntu/apps/beedle-epay/bin/app|/bin/app --port 8080
===PID_DETAILS_END===
===SYSTEMD_START===
Id=beedle.service
Description=Beedle E-Pay Backend
ExecStart={ path=/home/ubuntu/apps/beedle-epay/bin/app }
WorkingDirectory=/home/ubuntu/apps/beedle-epay
FragmentPath=/etc/systemd/system/beedle.service
MainPID=123
ActiveState=active
===SYSTEMD_END===
===WORKERS_START===
===WORKERS_END===
===DOCKER_START===
===DOCKER_END===
`);

      const detector = createServiceDetector({ executeCommand: mockExecute });
      const result = await detector.detectServices('vm-test-1');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(result.vmId).toBe('vm-test-1');
      expect(result.services.length).toBe(1);

      const service = result.services[0];
      expect(service.name).toBe('beedle');
      expect(service.ports).toEqual(['8080']);
      expect(service.workingDir).toBe('/home/ubuntu/apps/beedle-epay');
      expect(service.execPath).toBe('/home/ubuntu/apps/beedle-epay/bin/app');
      expect(service.unitFile).toBe('/etc/systemd/system/beedle.service');
      expect(service.description).toBe('Beedle E-Pay Backend');
      expect(result.scannedAt).toBeDefined();
    });
  });
});
