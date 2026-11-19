import { randomUUID } from 'node:crypto';

export enum EnrichmentStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** Foto de la tasa de cambio en el momento exacto de la validación. */
export interface ExchangeRateSnapshot {
  provider: string;
  baseCurrency: string;
  rates: Record<string, number>;
  providerUpdatedAt: string;
  fetchedAt: string;
}

export interface ValidationProps {
  id: string;
  name: string;
  documentNumber: string;
  enrichmentStatus: EnrichmentStatus;
  enrichment: ExchangeRateSnapshot | null;
  createdAt: Date;
}

/**
 * Entidad de dominio. No sabe nada de MongoDB, DynamoDB ni HTTP.
 * El id se genera aquí (UUID) y no en la base de datos: así el mismo id
 * sirve para Mongo y para la auditoría, y el dominio no depende de Mongo.
 */
export class Validation {
  private constructor(private readonly props: ValidationProps) {}

  static create(params: {
    name: string;
    documentNumber: string;
    enrichment: ExchangeRateSnapshot | null;
    now?: Date;
  }): Validation {
    return new Validation({
      id: randomUUID(),
      name: params.name,
      documentNumber: params.documentNumber,
      enrichment: params.enrichment,
      enrichmentStatus: params.enrichment
        ? EnrichmentStatus.COMPLETED
        : EnrichmentStatus.FAILED,
      createdAt: params.now ?? new Date(),
    });
  }

  /** Reconstruye una entidad que ya existía (por ejemplo, leída de la base). */
  static restore(props: ValidationProps): Validation {
    return new Validation({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get documentNumber(): string {
    return this.props.documentNumber;
  }
  get enrichmentStatus(): EnrichmentStatus {
    return this.props.enrichmentStatus;
  }
  get enrichment(): ExchangeRateSnapshot | null {
    return this.props.enrichment;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  toPrimitives(): ValidationProps {
    return { ...this.props };
  }
}
