import { ExchangeRateAdapter } from '../../src/validations/infrastructure/enrichment/exchange-rate.adapter';
import { EnrichmentUnavailableError } from '../../src/validations/domain/errors';

const okBody = {
  result: 'success',
  base_code: 'USD',
  time_last_update_utc: 'Thu, 19 Nov 2026 00:00:01 +0000',
  rates: { USD: 1, COP: 4012.5, EUR: 0.91, JPY: 150 },
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('ExchangeRateAdapter', () => {
  const options = {
    baseUrl: 'https://open.er-api.com/v6',
    baseCurrency: 'USD',
    targetCurrencies: ['COP', 'EUR'],
    timeoutMs: 50,
    maxRetries: 2,
    retryBaseDelayMs: 1,
  };

  it('devuelve solo las monedas configuradas', async () => {
    const http = jest.fn().mockResolvedValue(jsonResponse(200, okBody));
    const adapter = new ExchangeRateAdapter(options, http);

    const snapshot = await adapter.fetchSnapshot();

    expect(snapshot.rates).toEqual({ COP: 4012.5, EUR: 0.91 });
    expect(snapshot.baseCurrency).toBe('USD');
    expect(http).toHaveBeenCalledWith(
      'https://open.er-api.com/v6/latest/USD',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reintenta ante un 503 y se recupera', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    const adapter = new ExchangeRateAdapter(options, http);

    await expect(adapter.fetchSnapshot()).resolves.toBeDefined();
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un 404 (error permanente)', async () => {
    const http = jest.fn().mockResolvedValue(jsonResponse(404, {}));
    const adapter = new ExchangeRateAdapter(options, http);

    await expect(adapter.fetchSnapshot()).rejects.toBeInstanceOf(
      EnrichmentUnavailableError,
    );
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('corta por timeout y lo reporta como EnrichmentUnavailableError', async () => {
    // proveedor que nunca responde
    const http = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason as Error),
          );
        }),
    );
    const adapter = new ExchangeRateAdapter(
      { ...options, maxRetries: 0 },
      http as unknown as typeof fetch,
    );

    await expect(adapter.fetchSnapshot()).rejects.toThrow(/timeout/);
  });

  it('rechaza una respuesta con forma inesperada', async () => {
    const http = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        result: 'error',
        'error-type': 'unsupported-code',
      }),
    );
    const adapter = new ExchangeRateAdapter(options, http);

    await expect(adapter.fetchSnapshot()).rejects.toThrow(/unsupported-code/);
    expect(http).toHaveBeenCalledTimes(1);
  });
});
