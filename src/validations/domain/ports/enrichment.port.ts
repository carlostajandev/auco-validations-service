import { ExchangeRateSnapshot } from '../validation.entity';

export abstract class EnrichmentPort {
  /** Lanza EnrichmentUnavailableError si el proveedor no responde bien. */
  abstract fetchSnapshot(): Promise<ExchangeRateSnapshot>;
}
