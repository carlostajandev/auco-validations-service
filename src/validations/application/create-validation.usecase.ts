import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRateSnapshot, Validation } from '../domain/validation.entity';
import { ValidationRepositoryPort } from '../domain/ports/validation.repository.port';
import { AuditEvent, AuditPort } from '../domain/ports/audit.port';
import { EnrichmentPort } from '../domain/ports/enrichment.port';

export interface CreateValidationCommand {
  name: string;
  documentNumber: string;
}

/**
 * Orquesta: enriquecer -> persistir -> auditar -> devolver id.
 * Solo conoce puertos (abstracciones); las implementaciones reales
 * (Mongo, DynamoDB, HTTP) se inyectan desde el módulo.
 */
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

  /**
   * Trade-off: si la validación ya quedó en Mongo y DynamoDB falla, devolver
   * un 500 haría que el cliente reintente y cree un duplicado. Se responde 201
   * y se deja el evento completo en un log de nivel error para reprocesarlo.
   * La solución definitiva es el patrón "transactional outbox" (ver README).
   */
  private async tryAudit(event: AuditEvent): Promise<void> {
    try {
      await this.audit.record(event);
    } catch (error) {
      this.logger.error(
        `AUDIT_WRITE_FAILED ${JSON.stringify(event)}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Decisión de resiliencia: el enriquecimiento es un dato de contexto,
   * no una condición para validar. Si el proveedor falla (ya con reintentos),
   * la validación se guarda igual con enrichmentStatus = "failed"
   * en lugar de perderla devolviendo un 502.
   */
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
