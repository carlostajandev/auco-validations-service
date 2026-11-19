import { ListAuditEventsUseCase } from '../../src/validations/application/list-audit-events.usecase';
import { AuditPort } from '../../src/validations/domain/ports/audit.port';
import { InvalidQueryError } from '../../src/validations/domain/errors';

describe('ListAuditEventsUseCase', () => {
  let audit: jest.Mocked<AuditPort>;
  let useCase: ListAuditEventsUseCase;

  beforeEach(() => {
    audit = {
      record: jest.fn(),
      findByDocument: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
    };
    useCase = new ListAuditEventsUseCase(audit);
  });

  it('delega la consulta al puerto de auditoría', async () => {
    const query = {
      documentNumber: '1020304050',
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-30T00:00:00Z'),
      limit: 20,
    };

    await useCase.execute(query);

    expect(audit.findByDocument).toHaveBeenCalledWith(query);
  });

  it('rechaza un rango donde "from" es posterior a "to"', () => {
    expect(() =>
      useCase.execute({
        documentNumber: '1020304050',
        from: new Date('2026-12-01T00:00:00Z'),
        to: new Date('2026-11-01T00:00:00Z'),
        limit: 20,
      }),
    ).toThrow(InvalidQueryError);
    expect(audit.findByDocument).not.toHaveBeenCalled();
  });
});
