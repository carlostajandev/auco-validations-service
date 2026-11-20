import { ExchangeRateSnapshot } from '../validation.entity';

export abstract class EnrichmentPort {
  // lanza EnrichmentUnavailableError si el proveedor falla
  abstract fetchSnapshot(): Promise<ExchangeRateSnapshot>;
}
