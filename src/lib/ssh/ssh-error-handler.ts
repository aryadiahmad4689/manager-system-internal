/**
 * SSH Error Handler
 *
 * Maps SSH connection errors to user-friendly messages (in Indonesian)
 * and provides retry logic with exponential backoff for retryable errors.
 *
 * Security: Never exposes internal system details (paths, stack traces, etc.)
 * in user-facing error messages.
 */

/**
 * Classified SSH error types.
 */
export type SSHErrorType =
  | 'timeout'
  | 'auth_failed'
  | 'host_unreachable'
  | 'connection_refused'
  | 'unknown';

/**
 * Recommended action for the UI to take when an error occurs.
 */
export type SSHErrorAction = 'retry' | 'edit_vm' | 'none';

/**
 * A structured, user-safe SSH error with classification and action guidance.
 */
export interface SSHErrorInfo {
  type: SSHErrorType;
  message: string;
  action: SSHErrorAction;
  retryable: boolean;
}

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Maps SSH error types to user-facing messages and actions.
 * Messages are in Indonesian as per design specification.
 */
const ERROR_MAP: Record<SSHErrorType, { message: string; action: SSHErrorAction; retryable: boolean }> = {
  timeout: {
    message: 'Koneksi ke VM timeout. Periksa apakah VM aktif.',
    action: 'retry',
    retryable: true,
  },
  auth_failed: {
    message: 'Autentikasi gagal. Periksa kredensial VM.',
    action: 'edit_vm',
    retryable: false,
  },
  host_unreachable: {
    message: 'VM tidak dapat dijangkau. Periksa alamat IP.',
    action: 'retry',
    retryable: true,
  },
  connection_refused: {
    message: 'Koneksi ditolak. Periksa port SSH.',
    action: 'edit_vm',
    retryable: false,
  },
  unknown: {
    message: 'Terjadi kesalahan koneksi. Silakan coba lagi.',
    action: 'none',
    retryable: false,
  },
};

/**
 * Classifies a raw SSH error into a known SSHErrorType.
 *
 * Inspects the error message and common ssh2 error properties
 * to determine the category of failure.
 */
export function classifySSHError(error: Error): SSHErrorType {
  const msg = error.message.toLowerCase();

  // Timeout errors
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout')
  ) {
    return 'timeout';
  }

  // Authentication failures
  if (
    msg.includes('authentication') ||
    msg.includes('auth') ||
    msg.includes('all configured authentication methods failed') ||
    msg.includes('permission denied')
  ) {
    return 'auth_failed';
  }

  // Host unreachable
  if (
    msg.includes('unreachable') ||
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('enotfound') ||
    msg.includes('getaddrinfo') ||
    msg.includes('host not found')
  ) {
    return 'host_unreachable';
  }

  // Connection refused
  if (
    msg.includes('econnrefused') ||
    msg.includes('connection refused') ||
    msg.includes('refused')
  ) {
    return 'connection_refused';
  }

  return 'unknown';
}

/**
 * Maps an SSH error to a user-safe SSHErrorInfo object.
 *
 * The returned message never contains internal system details
 * such as file paths, stack traces, or raw error messages.
 */
export function handleSSHError(error: Error): SSHErrorInfo {
  const type = classifySSHError(error);
  const mapping = ERROR_MAP[type];

  return {
    type,
    message: mapping.message,
    action: mapping.action,
    retryable: mapping.retryable,
  };
}

/**
 * Calculates the delay for a given retry attempt using exponential backoff.
 *
 * @param attempt - The retry attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function getRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  return config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
}

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async operation with retry logic using exponential backoff.
 *
 * Only retries for errors classified as retryable (timeout, host_unreachable).
 * Non-retryable errors (auth_failed, connection_refused) are thrown immediately.
 *
 * @param operation - The async function to execute
 * @param config - Optional retry configuration (defaults: max 3 retries, 1s base delay, 2x multiplier)
 * @returns The result of the operation if successful
 * @throws SSHErrorInfo-wrapped error if all retries are exhausted or error is non-retryable
 */
export async function withSSHRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      const errorInfo = handleSSHError(error);

      // Don't retry non-retryable errors
      if (!errorInfo.retryable) {
        throw error;
      }

      // Don't delay after the last attempt
      if (attempt < config.maxRetries) {
        const retryDelay = getRetryDelay(attempt, config);
        await delay(retryDelay);
      }
    }
  }

  // All retries exhausted
  throw lastError!;
}
