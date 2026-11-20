import { ApiProperty } from '@nestjs/swagger';
import {
  EnrichmentStatus,
  ExchangeRateSnapshot,
  Validation,
} from '../../../domain/validation.entity';

export class CreatedValidationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

class ExchangeRateSnapshotResponse implements ExchangeRateSnapshot {
  @ApiProperty({ example: 'open.er-api.com' })
  provider!: string;
  @ApiProperty({ example: 'USD' })
  baseCurrency!: string;
  @ApiProperty({ example: { COP: 4012.5, EUR: 0.91 } })
  rates!: Record<string, number>;
  @ApiProperty()
  providerUpdatedAt!: string;
  @ApiProperty()
  fetchedAt!: string;
}

export class ValidationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty()
  documentNumber!: string;
  @ApiProperty({ enum: EnrichmentStatus })
  enrichmentStatus!: EnrichmentStatus;
  @ApiProperty({ type: ExchangeRateSnapshotResponse, nullable: true })
  enrichment!: ExchangeRateSnapshotResponse | null;
  @ApiProperty()
  createdAt!: string;

  static fromDomain(validation: Validation): ValidationResponse {
    const p = validation.toPrimitives();
    return {
      id: p.id,
      name: p.name,
      documentNumber: p.documentNumber,
      enrichmentStatus: p.enrichmentStatus,
      enrichment: p.enrichment,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
