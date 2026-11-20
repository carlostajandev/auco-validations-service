import { Logger } from '@nestjs/common';
import { EnrichmentPort } from '../../domain/ports/enrichment.port';
import { ExchangeRateSnapshot } from '../../domain/validation.entity';

export interface CachedEnrichmentOptions {
  ttlMs: number;
  maxStaleMs: number; // cuánto aguanta una tasa vieja si el proveedor está caído
  now?: () => number;
}

// La tasa se publica una vez al día; llamar al proveedor en cada POST solo suma
// latencia y nos expone a un 429. Una sola consulta en vuelo aunque lleguen muchas
// peticiones, y si el proveedor cae se usa la última buena (con su fetchedAt real).
export class CachedEnrichmentAdapter extends EnrichmentPort {
  private readonly logger = new Logger(CachedEnrichmentAdapter.name);
  private cached: { value: ExchangeRateSnapshot; at: number } | null = null;
  private inFlight: Promise<ExchangeRateSnapshot> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly inner: EnrichmentPort,
    private readonly options: CachedEnrichmentOptions,
  ) {
    super();
    this.now = options.now ?? Date.now;
  }

  async fetchSnapshot(): Promise<ExchangeRateSnapshot> {
    if (this.cached && this.age() < this.options.ttlMs) {
      return this.cached.value;
    }

    try {
      return await this.refresh();
    } catch (error) {
      if (this.cached && this.age() < this.options.maxStaleMs) {
        this.logger.warn(
          `Provider failed, serving rate cached ${Math.round(this.age() / 1000)}s ago`,
        );
        return this.cached.value;
      }
      throw error;
    }
  }

  private refresh(): Promise<ExchangeRateSnapshot> {
    this.inFlight ??= this.inner
      .fetchSnapshot()
      .then((value) => {
        this.cached = { value, at: this.now() };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private age(): number {
    return this.cached ? this.now() - this.cached.at : Infinity;
  }
}
