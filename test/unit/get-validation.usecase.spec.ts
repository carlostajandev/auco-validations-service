import { GetValidationUseCase } from '../../src/validations/application/get-validation.usecase';
import { ValidationRepositoryPort } from '../../src/validations/domain/ports/validation.repository.port';
import { ValidationNotFoundError } from '../../src/validations/domain/errors';
import { Validation } from '../../src/validations/domain/validation.entity';

describe('GetValidationUseCase', () => {
  let repository: jest.Mocked<ValidationRepositoryPort>;
  let useCase: GetValidationUseCase;

  beforeEach(() => {
    repository = { save: jest.fn(), findById: jest.fn() };
    useCase = new GetValidationUseCase(repository);
  });

  it('devuelve la validación cuando existe', async () => {
    const validation = Validation.create({
      name: 'Ana Pérez',
      documentNumber: '1020304050',
      enrichment: null,
    });
    repository.findById.mockResolvedValue(validation);

    await expect(useCase.execute(validation.id)).resolves.toBe(validation);
  });

  it('lanza ValidationNotFoundError cuando no existe', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing-id')).rejects.toBeInstanceOf(
      ValidationNotFoundError,
    );
  });
});
