import { CreateValidationUseCase } from '../../src/validations/application/create-validation.usecase';
import { ValidationRepositoryPort } from '../../src/validations/domain/ports/validation.repository.port';
import { AuditPort } from '../../src/validations/domain/ports/audit.port';
import { EnrichmentPort } from '../../src/validations/domain/ports/enrichment.port';
import { EnrichmentUnavailableError } from '../../src/validations/domain/errors';
import {
  EnrichmentStatus,
  ExchangeRateSnapshot,
  Validation,
} from '../../src/validations/domain/validation.entity';

const snapshot: ExchangeRateSnapshot = {
  provider: 'open.er-api.com',
  baseCurrency: 'USD',
  rates: { COP: 4000, EUR: 0.9 },
  providerUpdatedAt: '2026-11-19T00:00:00.000Z',
  fetchedAt: '2026-11-19T10:00:00.000Z',
};

describe('CreateValidationUseCase', () => {
  let repository: jest.Mocked<ValidationRepositoryPort>;
  let audit: jest.Mocked<AuditPort>;
  let enrichment: jest.Mocked<EnrichmentPort>;
  let useCase: CreateValidationUseCase;

  beforeEach(() => {
    repository = { save: jest.fn(), findById: jest.fn() };
    audit = { record: jest.fn() };
    enrichment = { fetchSnapshot: jest.fn() };
    useCase = new CreateValidationUseCase(repository, audit, enrichment);
  });

  const command = { name: 'Ana Pérez', documentNumber: '1020304050' };

  it('enriquece, persiste y devuelve el id de la validación', async () => {
    enrichment.fetchSnapshot.mockResolvedValue(snapshot);

    const result = await useCase.execute(command);

    expect(repository.save).toHaveBeenCalledTimes(1);
    const saved = repository.save.mock.calls[0][0];
    expect(saved.id).toBe(result.id);
    expect(saved.enrichmentStatus).toBe(EnrichmentStatus.COMPLETED);
    expect(saved.enrichment).toEqual(snapshot);
  });

  it('si la API externa falla, guarda igual con enrichmentStatus=failed', async () => {
    enrichment.fetchSnapshot.mockRejectedValue(
      new EnrichmentUnavailableError('timeout'),
    );

    const result = await useCase.execute(command);

    const saved: Validation = repository.save.mock.calls[0][0];
    expect(result.id).toBeDefined();
    expect(saved.enrichmentStatus).toBe(EnrichmentStatus.FAILED);
    expect(saved.enrichment).toBeNull();
  });

  it('escribe el evento de auditoría con el documento y el id creados', async () => {
    enrichment.fetchSnapshot.mockResolvedValue(snapshot);

    const { id } = await useCase.execute(command);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'VALIDATION_CREATED',
        validationId: id,
        documentNumber: command.documentNumber,
        enrichmentStatus: EnrichmentStatus.COMPLETED,
      }),
    );
  });

  it('si la auditoría falla, la validación ya guardada igual responde con su id', async () => {
    enrichment.fetchSnapshot.mockResolvedValue(snapshot);
    audit.record.mockRejectedValue(new Error('dynamo down'));

    const result = await useCase.execute(command);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(repository.save.mock.calls[0][0].id);
  });

  it('no audita si la persistencia falla (no hay eventos de algo que no existe)', async () => {
    enrichment.fetchSnapshot.mockResolvedValue(snapshot);
    repository.save.mockRejectedValue(new Error('mongo down'));

    await expect(useCase.execute(command)).rejects.toThrow('mongo down');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
