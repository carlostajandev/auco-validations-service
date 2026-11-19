import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EnrichmentPort } from '../../domain/ports/enrichment.port';
import { ExchangeRateSnapshot } from '../../domain/validation.entity';
import { EnrichmentUnavailableError } from '../../domain/errors';
import { withRetry } from '../../../common/resilience/retry';

export const EXCHANGE_RATE_OPTIONS = Symbol('EXCHANGE_RATE_OPTIONS');
/** Permite cambiar el cliente HTTP en pruebas sin tocar la red real. */
export const HTTP_FETCH = Symbol('HTTP_FETCH');

export interface ExchangeRateOptions {
  baseUrl: string;
  baseCurrency: string;
  targetCurrencies: string[];
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs?: number;
}

/** Error que sí vale la pena reintentar: red caída, timeout, 5xx o 429. */
class TransientError extends Error {}

interface OpenErApiResponse {
  result: 'success' | 'error';
  base_code?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
  'error-type'?: string;
}

/**
 * Adaptador hacia open.er-api.com (gratis y sin API key).
 * Guarda una "foto" de la tasa de cambio en el momento de la validación:
 * contexto útil para auditoría ("¿cuál era el contexto cuando se validó?").
 */
@Injectable()
export class ExchangeRateAdapter extends EnrichmentPort {
  private readonly logger = new Logger(ExchangeRateAdapter.name);
  private readonly http: typeof fetch;
  static readonly PROVIDER = 'open.er-api.com';

  constructor(
    @Inject(EXCHANGE_RATE_OPTIONS)
    private readonly options: ExchangeRateOptions,
    @Optional() @Inject(HTTP_FETCH) http?: typeof fetch,
  ) {
    super();
    this.http = http ?? ((input, init) => fetch(input, init));
  }

  async fetchSnapshot(): Promise<ExchangeRateSnapshot> {
    try {
      return await withRetry(() => this.requestOnce(), {
        retries: this.options.maxRetries,
        baseDelayMs: this.options.retryBaseDelayMs ?? 200,
        shouldRetry: (error) => error instanceof TransientError,
        onRetry: (error, attempt, delayMs) =>
          this.logger.warn(
            `Attempt ${attempt} failed (${(error as Error).message}); retrying in ${delayMs}ms`,
          ),
      });
    } catch (error) {
      throw new EnrichmentUnavailableError((error as Error).message, error);
    }
  }

  private async requestOnce(): Promise<ExchangeRateSnapshot> {
    const url = `${this.options.baseUrl}/latest/${this.options.baseCurrency}`;

    let response: Response;
    try {
      response = await this.http(url, {
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      const isTimeout = (error as Error).name === 'TimeoutError';
      throw new TransientError(
        isTimeout
          ? `timeout after ${this.options.timeoutMs}ms`
          : `network error: ${(error as Error).message}`,
      );
    }

    if (response.status >= 500 || response.status === 429) {
      throw new TransientError(`provider responded ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`provider responded ${response.status}`);
    }

    const body = (await response.json()) as OpenErApiResponse;
    return this.toSnapshot(body);
  }

  /** Nunca confiar ciegamente en una API externa: validar la forma de la respuesta. */
  private toSnapshot(body: OpenErApiResponse): ExchangeRateSnapshot {
    if (body.result !== 'success' || !body.rates || !body.base_code) {
      throw new Error(
        `unexpected provider payload (${body['error-type'] ?? 'missing fields'})`,
      );
    }

    const rates: Record<string, number> = {};
    for (const currency of this.options.targetCurrencies) {
      const rate = body.rates[currency];
      if (typeof rate === 'number') rates[currency] = rate;
    }

    return {
      provider: ExchangeRateAdapter.PROVIDER,
      baseCurrency: body.base_code,
      rates,
      providerUpdatedAt: body.time_last_update_utc
        ? new Date(body.time_last_update_utc).toISOString()
        : new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  }
}
