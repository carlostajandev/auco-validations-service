import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRateSnapshot, Validation } from '../domain/validation.entity';
import { ValidationRepositoryPort } from '../domain/ports/validation.repository.port';
import { AuditEvent, AuditPort } from '../domain/ports/audit.port';
import { EnrichmentPort } from '../domain/ports/enrichment.port';

export interface CreateValidationCommand {
  name: string;
  documentNumber: string;
}

@Injectable()
export class CreateValidationUseCase {
  private readonly logger = new Logger(CreateValidationUseCase.name);

  constructor(
    private readonly repository: ValidationRepositoryPort,
    private readonly audit: AuditPort,
    private readonly enrichment: EnrichmentPort,
  ) {}

  async execute(command: CreateValidationCommand): Promise<{ id: string }> {
    const snapshot = await this.tryEnrich();

    const validation = Validation.create({
      name: command.name,
      documentNumber: command.documentNumber,
      enrichment: snapshot,
    });

    await this.repository.save(validation);

    await this.tryAudit({
      eventType: 'VALIDATION_CREATED',
      validationId: validation.id,
      documentNumber: validation.documentNumber,
      name: validation.name,
      enrichmentStatus: validation.enrichmentStatus,
      occurredAt: validation.createdAt,
    });

    return { id: validation.id };
  }

  // Si Mongo ya guardó y Dynamo falla, un 500 haría que el cliente reintente y
  // duplique la validación. Respondo 201 y dejo el evento completo en el log para
  // reprocesarlo. Lo correcto a futuro es un outbox (ver README).
  private async tryAudit(event: AuditEvent): Promise<void> {
    try {
      await this.audit.record(event);
    } catch (error) {
      this.logger.error(
        `AUDIT_WRITE_FAILED ${JSON.stringify(event)}: ${(error as Error).message}`,
      );
    }
  }

  // El enriquecimiento es contexto, no requisito: si el proveedor falla (ya con
  // reintentos) se guarda igual con enrichmentStatus=failed en vez de dar 502.
  private async tryEnrich(): Promise<ExchangeRateSnapshot | null> {
    try {
      return await this.enrichment.fetchSnapshot();
    } catch (error) {
      this.logger.warn(
        `Enrichment failed, saving validation without it: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
