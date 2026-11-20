export interface RetryOptions {
  retries: number; // 2 = hasta 3 intentos
  baseDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>; // para no esperar en los tests
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Backoff exponencial + jitter, para no reintentar todos a la vez contra un proveedor que ya está mal.
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { retries, baseDelayMs, shouldRetry = () => true, onRetry } = options;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      const attemptsLeft = attempt <= retries;
      if (!attemptsLeft || !shouldRetry(error)) {
        throw error;
      }
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const delayMs = exponential + Math.floor(Math.random() * baseDelayMs);
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}
