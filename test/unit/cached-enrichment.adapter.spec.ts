import { CachedEnrichmentAdapter } from '../../src/validations/infrastructure/enrichment/cached-enrichment.adapter';
import { EnrichmentPort } from '../../src/validations/domain/ports/enrichment.port';
import { EnrichmentUnavailableError } from '../../src/validations/domain/errors';
import { ExchangeRateSnapshot } from '../../src/validations/domain/validation.entity';

const snapshot = (cop: number): ExchangeRateSnapshot => ({
  provider: 'open.er-api.com',
  baseCurrency: 'USD',
  rates: { COP: cop },
  providerUpdatedAt: '2026-11-20T00:00:00.000Z',
  fetchedAt: '2026-11-20T10:00:00.000Z',
});

describe('CachedEnrichmentAdapter', () => {
  let clock: number;
  let inner: jest.Mocked<EnrichmentPort>;
  let cache: CachedEnrichmentAdapter;

  beforeEach(() => {
    clock = 0;
    inner = { fetchSnapshot: jest.fn() };
    cache = new CachedEnrichmentAdapter(inner, {
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => clock,
    });
  });

  it('reutiliza la tasa mientras está fresca', async () => {
    inner.fetchSnapshot.mockResolvedValue(snapshot(4000));

    await cache.fetchSnapshot();
    clock = 59_000;
    await cache.fetchSnapshot();

    expect(inner.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('vuelve a consultar cuando vence el TTL', async () => {
    inner.fetchSnapshot
      .mockResolvedValueOnce(snapshot(4000))
      .mockResolvedValueOnce(snapshot(4100));

    await cache.fetchSnapshot();
    clock = 61_000;

    await expect(cache.fetchSnapshot()).resolves.toEqual(snapshot(4100));
    expect(inner.fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('100 peticiones simultáneas sin caché hacen una sola llamada al proveedor', async () => {
    inner.fetchSnapshot.mockResolvedValue(snapshot(4000));

    await Promise.all(Array.from({ length: 100 }, () => cache.fetchSnapshot()));

    expect(inner.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('si el proveedor cae, sirve la última tasa buena dentro de maxStale', async () => {
    inner.fetchSnapshot
      .mockResolvedValueOnce(snapshot(4000))
      .mockRejectedValueOnce(new EnrichmentUnavailableError('down'));

    await cache.fetchSnapshot();
    clock = 120_000;

    await expect(cache.fetchSnapshot()).resolves.toEqual(snapshot(4000));
  });

  it('propaga el error si no hay tasa o es demasiado vieja', async () => {
    inner.fetchSnapshot.mockRejectedValue(
      new EnrichmentUnavailableError('down'),
    );

    await expect(cache.fetchSnapshot()).rejects.toBeInstanceOf(
      EnrichmentUnavailableError,
    );
  });

  it('no guarda en caché un fallo: el siguiente intento vuelve a consultar', async () => {
    inner.fetchSnapshot
      .mockRejectedValueOnce(new EnrichmentUnavailableError('down'))
      .mockResolvedValueOnce(snapshot(4000));

    await expect(cache.fetchSnapshot()).rejects.toThrow();
    await expect(cache.fetchSnapshot()).resolves.toEqual(snapshot(4000));
  });
});
