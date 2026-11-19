export interface RetryOptions {
  /** Reintentos adicionales al primer intento (2 = hasta 3 intentos en total). */
  retries: number;
  /** Espera base en ms; se duplica en cada reintento (backoff exponencial). */
  baseDelayMs: number;
  /** Decide si el error vale la pena reintentarlo (p. ej. un 400 no). */
  shouldRetry?: (error: unknown) => boolean;
  /** Inyectable para que las pruebas no tengan que esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta `fn` con reintentos y backoff exponencial con "jitter"
 * (un poco de azar en la espera para que muchos clientes no reintenten
 * todos al mismo tiempo y saturen al proveedor que ya está fallando).
 */
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
