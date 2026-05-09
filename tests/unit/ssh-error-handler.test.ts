import { describe, it, expect, vi } from 'vitest';
import {
  classifySSHError,
  handleSSHError,
  getRetryDelay,
  withSSHRetry,
  SSHErrorType,
  SSHErrorInfo,
  RetryConfig,
} from '@/lib/ssh/ssh-error-handler';

describe('SSH Error Handler', () => {
  describe('classifySSHError', () => {
    it('should classify timeout errors', () => {
      expect(classifySSHError(new Error('Connection timeout for VM: vm-1'))).toBe('timeout');
      expect(classifySSHError(new Error('Timed out while waiting for handshake'))).toBe('timeout');
      expect(classifySSHError(new Error('connect ETIMEDOUT 192.168.1.1:22'))).toBe('timeout');
    });

    it('should classify authentication failures', () => {
      expect(classifySSHError(new Error('All configured authentication methods failed'))).toBe('auth_failed');
      expect(classifySSHError(new Error('Authentication failed'))).toBe('auth_failed');
      expect(classifySSHError(new Error('Permission denied (publickey,password)'))).toBe('auth_failed');
    });

    it('should classify host unreachable errors', () => {
      expect(classifySSHError(new Error('connect EHOSTUNREACH 10.0.0.1:22'))).toBe('host_unreachable');
      expect(classifySSHError(new Error('connect ENETUNREACH 10.0.0.1:22'))).toBe('host_unreachable');
      expect(classifySSHError(new Error('getaddrinfo ENOTFOUND invalid-host'))).toBe('host_unreachable');
      expect(classifySSHError(new Error('Host not found'))).toBe('host_unreachable');
    });

    it('should classify connection refused errors', () => {
      expect(classifySSHError(new Error('connect ECONNREFUSED 192.168.1.1:22'))).toBe('connection_refused');
      expect(classifySSHError(new Error('Connection refused'))).toBe('connection_refused');
    });

    it('should classify unknown errors', () => {
      expect(classifySSHError(new Error('Something unexpected happened'))).toBe('unknown');
      expect(classifySSHError(new Error(''))).toBe('unknown');
    });
  });

  describe('handleSSHError', () => {
    it('should return user-friendly message for timeout', () => {
      const result = handleSSHError(new Error('Connection timeout'));

      expect(result.type).toBe('timeout');
      expect(result.message).toBe('Koneksi ke VM timeout. Periksa apakah VM aktif.');
      expect(result.action).toBe('retry');
      expect(result.retryable).toBe(true);
    });

    it('should return user-friendly message for auth failure', () => {
      const result = handleSSHError(new Error('Authentication failed'));

      expect(result.type).toBe('auth_failed');
      expect(result.message).toBe('Autentikasi gagal. Periksa kredensial VM.');
      expect(result.action).toBe('edit_vm');
      expect(result.retryable).toBe(false);
    });

    it('should return user-friendly message for host unreachable', () => {
      const result = handleSSHError(new Error('connect EHOSTUNREACH'));

      expect(result.type).toBe('host_unreachable');
      expect(result.message).toBe('VM tidak dapat dijangkau. Periksa alamat IP.');
      expect(result.action).toBe('retry');
      expect(result.retryable).toBe(true);
    });

    it('should return user-friendly message for connection refused', () => {
      const result = handleSSHError(new Error('connect ECONNREFUSED'));

      expect(result.type).toBe('connection_refused');
      expect(result.message).toBe('Koneksi ditolak. Periksa port SSH.');
      expect(result.action).toBe('edit_vm');
      expect(result.retryable).toBe(false);
    });

    it('should return generic message for unknown errors', () => {
      const result = handleSSHError(new Error('some internal error at /usr/lib/node'));

      expect(result.type).toBe('unknown');
      expect(result.message).toBe('Terjadi kesalahan koneksi. Silakan coba lagi.');
      expect(result.action).toBe('none');
      expect(result.retryable).toBe(false);
    });

    it('should never expose internal system details in messages', () => {
      const internalErrors = [
        new Error('ECONNREFUSED at /home/user/.ssh/config line 42'),
        new Error('Timeout connecting via /var/run/ssh-agent.sock'),
        new Error('Authentication failed: key at /root/.ssh/id_rsa invalid'),
        new Error('getaddrinfo ENOTFOUND at dns.resolve (/usr/lib/node/dns.js:123)'),
      ];

      for (const error of internalErrors) {
        const result = handleSSHError(error);
        expect(result.message).not.toMatch(/\//); // No file paths
        expect(result.message).not.toMatch(/\.js/); // No JS file references
        expect(result.message).not.toMatch(/line \d+/); // No line numbers
        expect(result.message).not.toMatch(/node_modules/); // No node_modules
        expect(result.message).not.toMatch(/Error:/); // No raw error prefixes
      }
    });
  });

  describe('getRetryDelay', () => {
    it('should calculate exponential backoff delays', () => {
      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, backoffMultiplier: 2 };

      expect(getRetryDelay(0, config)).toBe(1000); // 1s
      expect(getRetryDelay(1, config)).toBe(2000); // 2s
      expect(getRetryDelay(2, config)).toBe(4000); // 4s
    });

    it('should use default config when none provided', () => {
      expect(getRetryDelay(0)).toBe(1000);
      expect(getRetryDelay(1)).toBe(2000);
      expect(getRetryDelay(2)).toBe(4000);
    });

    it('should support custom base delay and multiplier', () => {
      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 500, backoffMultiplier: 3 };

      expect(getRetryDelay(0, config)).toBe(500);
      expect(getRetryDelay(1, config)).toBe(1500);
      expect(getRetryDelay(2, config)).toBe(4500);
    });
  });

  describe('withSSHRetry', () => {
    it('should return result on first successful attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await withSSHRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry retryable errors up to maxRetries', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValue('success');

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 10, backoffMultiplier: 2 };

      const result = await withSSHRetry(operation, config);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('should throw immediately for non-retryable errors (auth_failed)', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Authentication failed'));

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, backoffMultiplier: 2 };

      await expect(withSSHRetry(operation, config)).rejects.toThrow('Authentication failed');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw immediately for non-retryable errors (connection_refused)', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, backoffMultiplier: 2 };

      await expect(withSSHRetry(operation, config)).rejects.toThrow('connect ECONNREFUSED');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after all retries are exhausted for retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 10, backoffMultiplier: 2 };

      await expect(withSSHRetry(operation, config)).rejects.toThrow('Connection timeout');
      expect(operation).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('should succeed on retry after initial failure', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('connect EHOSTUNREACH'))
        .mockResolvedValue('connected');

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 10, backoffMultiplier: 2 };

      const result = await withSSHRetry(operation, config);

      expect(result).toBe('connected');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle non-Error thrown values', async () => {
      const operation = vi.fn().mockRejectedValue('string error');

      await expect(withSSHRetry(operation)).rejects.toThrow('string error');
    });
  });
});
