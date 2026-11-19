import { Model } from 'mongoose';
import { ValidationMongoRepository } from '../../src/validations/infrastructure/persistence/mongo/validation.mongo.repository';
import { ValidationDocument } from '../../src/validations/infrastructure/persistence/mongo/validation.schema';
import { PersistenceUnavailableError } from '../../src/validations/domain/errors';
import { Validation } from '../../src/validations/domain/validation.entity';

const namedError = (name: string, message = 'boom') =>
  Object.assign(new Error(message), { name });

describe('ValidationMongoRepository (traducción de errores)', () => {
  const validation = Validation.create({
    name: 'Ana Pérez',
    documentNumber: '1020304050',
    enrichment: null,
  });

  const repoWithCreate = (error: Error) =>
    new ValidationMongoRepository({
      create: jest.fn().mockRejectedValue(error),
    } as unknown as Model<ValidationDocument>);

  it.each([
    ['MongooseServerSelectionError'],
    ['MongoNetworkError'],
    ['MongoNotConnectedError'],
  ])('traduce %s a PersistenceUnavailableError (503)', async (name) => {
    await expect(
      repoWithCreate(namedError(name)).save(validation),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError);
  });

  it('traduce el timeout de buffering de Mongoose', async () => {
    const error = new Error(
      'Operation `validations.insertOne()` buffering timed out after 10000ms',
    );
    await expect(repoWithCreate(error).save(validation)).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
  });

  it('no oculta otros errores (p. ej. clave duplicada)', async () => {
    const duplicate = namedError('MongoServerError', 'E11000 duplicate key');
    await expect(repoWithCreate(duplicate).save(validation)).rejects.toBe(
      duplicate,
    );
  });

  it('también traduce errores de conexión al leer', async () => {
    const repo = new ValidationMongoRepository({
      findById: () => ({
        lean: () => ({
          exec: () => Promise.reject(namedError('MongoServerSelectionError')),
        }),
      }),
    } as unknown as Model<ValidationDocument>);

    await expect(repo.findById(validation.id)).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
  });
});
