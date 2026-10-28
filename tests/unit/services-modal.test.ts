import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { RunningService } from '@/lib/services/service-detector';

describe('ServicesModal Component & Logic', () => {
  const modalPath = resolve(__dirname, '../../src/components/ServicesModal.tsx');
  const modalContent = readFileSync(modalPath, 'utf-8');

  const pagePath = resolve(__dirname, '../../src/app/(dashboard)/page.tsx');
  const pageContent = readFileSync(pagePath, 'utf-8');

  describe('Component Structure', () => {
    it('should be a client component', () => {
      expect(modalContent).toContain("'use client'");
    });

    it('should export default ServicesModal component', () => {
      expect(modalContent).toMatch(/export default function ServicesModal/);
    });

    it('should import RunningService and ServiceScanResult types', () => {
      expect(modalContent).toContain("import type { RunningService, ServiceScanResult } from '@/lib/services/service-detector'");
    });

    it('should have state for search, filter, copiedPath, and expanded details', () => {
      expect(modalContent).toContain('searchQuery');
      expect(modalContent).toContain('activeFilter');
      expect(modalContent).toContain('copiedPath');
      expect(modalContent).toContain('expandedId');
    });

    it('should provide one-click copy buttons for paths', () => {
      expect(modalContent).toContain('navigator.clipboard.writeText');
      expect(modalContent).toContain('Salin');
      expect(modalContent).toContain('Tersalin');
    });

    it('should provide terminal integration button when onOpenTerminal is passed', () => {
      expect(modalContent).toContain('onOpenTerminal');
      expect(modalContent).toContain('Terminal');
    });
  });

  describe('Dashboard Page Integration', () => {
    it('should dynamically import ServicesModal', () => {
      expect(pageContent).toContain("import('@/components/ServicesModal')");
    });

    it('should manage servicesVm state', () => {
      expect(pageContent).toContain('servicesVm');
      expect(pageContent).toContain('setServicesVm');
    });

    it('should include Services button on VMCard', () => {
      expect(pageContent).toContain('onServices');
      expect(pageContent).toContain('Services');
      expect(pageContent).toContain('aria-label={`Services for ${vm.label}`}');
    });

    it('should render ServicesModal when servicesVm is set', () => {
      expect(pageContent).toContain('<ServicesModal');
      expect(pageContent).toContain('vmId={servicesVm.id}');
      expect(pageContent).toContain('onClose={handleCloseServices}');
    });

    it('should forward command from onOpenTerminal to handleConnect', () => {
      expect(pageContent).toContain('handleConnect(servicesVm, cmd)');
    });
  });

  describe('Service Filtering & Stats Logic', () => {
    const mockServices: RunningService[] = [
      {
        id: 'listen-8080',
        name: 'beedle-epay',
        type: 'listening',
        status: 'running',
        pid: 1420,
        user: 'ubuntu',
        ports: ['8080'],
        workingDir: '/home/ubuntu/apps/beedle-epay',
        execPath: '/home/ubuntu/apps/beedle-epay/bin/app',
        unitFile: '/etc/systemd/system/beedle.service',
        description: 'E-Pay Microservice',
      },
      {
        id: 'systemd-cron.service',
        name: 'cron.service',
        type: 'systemd',
        status: 'active',
        pid: 500,
        user: 'root',
        ports: [],
        workingDir: '/var/spool/cron',
        execPath: '/usr/sbin/cron',
        unitFile: '/lib/systemd/system/cron.service',
        description: 'Regular background daemon',
      },
      {
        id: 'worker-999',
        name: 'worker.py',
        type: 'worker',
        status: 'running',
        pid: 999,
        user: 'app',
        ports: [],
        workingDir: '/opt/worker',
        execPath: '/usr/bin/python3',
      },
      {
        id: 'web-html',
        name: 'html (Web/PHP)',
        type: 'web',
        status: 'active',
        ports: ['80', '443'],
        workingDir: '/var/www/html',
        description: 'Web Application / DocumentRoot',
      },
    ];

    function filterServices(services: RunningService[], filter: string, query: string) {
      return services.filter((s) => {
        if (filter !== 'all' && s.type !== filter) return false;
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.ports.some((p) => p.includes(q) || `:${p}`.includes(q)) ||
          s.workingDir?.toLowerCase().includes(q) ||
          s.execPath?.toLowerCase().includes(q) ||
          s.unitFile?.toLowerCase().includes(q) ||
          s.user?.toLowerCase().includes(q) ||
          (s.pid ? String(s.pid).includes(q) : false) ||
          s.description?.toLowerCase().includes(q)
        );
      });
    }

    it('should correctly count services by type including web', () => {
      const total = mockServices.length;
      const listening = mockServices.filter((s) => s.type === 'listening').length;
      const systemd = mockServices.filter((s) => s.type === 'systemd').length;
      const workers = mockServices.filter((s) => s.type === 'worker').length;
      const web = mockServices.filter((s) => s.type === 'web').length;

      expect(total).toBe(4);
      expect(listening).toBe(1);
      expect(systemd).toBe(1);
      expect(workers).toBe(1);
      expect(web).toBe(1);
    });

    it('should filter by active tab including web', () => {
      expect(filterServices(mockServices, 'all', '').length).toBe(4);
      expect(filterServices(mockServices, 'listening', '').length).toBe(1);
      expect(filterServices(mockServices, 'systemd', '').length).toBe(1);
      expect(filterServices(mockServices, 'worker', '').length).toBe(1);
      expect(filterServices(mockServices, 'web', '').length).toBe(1);
    });

    it('should search by name, port, or working directory', () => {
      expect(filterServices(mockServices, 'all', 'beedle').length).toBe(1);
      expect(filterServices(mockServices, 'all', ':8080').length).toBe(1);
      expect(filterServices(mockServices, 'all', '/var/www/html').length).toBe(1);
      expect(filterServices(mockServices, 'all', '/var/spool').length).toBe(1);
      expect(filterServices(mockServices, 'all', 'cron').length).toBe(1);
      expect(filterServices(mockServices, 'all', 'nonexistent').length).toBe(0);
    });
  });
});
