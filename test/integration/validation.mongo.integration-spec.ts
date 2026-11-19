import mongoose, { Connection } from 'mongoose';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { ValidationMongoRepository } from '../../src/validations/infrastructure/persistence/mongo/validation.mongo.repository';
import {
  ValidationDocument,
  ValidationSchema,
} from '../../src/validations/infrastructure/persistence/mongo/validation.schema';
import {
  EnrichmentStatus,
  Validation,
} from '../../src/validations/domain/validation.entity';

describe('ValidationMongoRepository (integration)', () => {
  let container: StartedTestContainer;
  let connection: Connection;
  let repository: ValidationMongoRepository;

  beforeAll(async () => {
    container = await new GenericContainer('mongo:7')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start();

    const uri = `mongodb://${container.getHost()}:${container.getMappedPort(27017)}/auco_test`;
    connection = await mongoose.createConnection(uri).asPromise();
    const model = connection.model(ValidationDocument.name, ValidationSchema);
    repository = new ValidationMongoRepository(model);
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  it('guarda y recupera la entidad completa, con el UUID como _id', async () => {
    const validation = Validation.create({
      name: 'Ana Pérez',
      documentNumber: '1020304050',
      enrichment: {
        provider: 'open.er-api.com',
        baseCurrency: 'USD',
        rates: { COP: 4012.5, EUR: 0.91 },
        providerUpdatedAt: '2026-11-19T00:00:00.000Z',
        fetchedAt: '2026-11-19T10:00:00.000Z',
      },
    });

    await repository.save(validation);
    const found = await repository.findById(validation.id);

    expect(found?.toPrimitives()).toEqual(validation.toPrimitives());
    const raw = await connection.collection('validations').findOne({});
    expect(raw?._id).toBe(validation.id);
  });

  it('guarda una validación sin enriquecimiento', async () => {
    const validation = Validation.create({
      name: 'Luis Gómez',
      documentNumber: '987654321',
      enrichment: null,
    });

    await repository.save(validation);
    const found = await repository.findById(validation.id);

    expect(found?.enrichmentStatus).toBe(EnrichmentStatus.FAILED);
    expect(found?.enrichment).toBeNull();
  });

  it('devuelve null si el id no existe', async () => {
    await expect(
      repository.findById('3f2b6c1e-8a4d-4f7e-9b2a-1c5d8e9f0a1b'),
    ).resolves.toBeNull();
  });

  it('rechaza guardar dos veces el mismo id', async () => {
    const validation = Validation.create({
      name: 'Marta Ruiz',
      documentNumber: '55667788',
      enrichment: null,
    });
    await repository.save(validation);

    await expect(repository.save(validation)).rejects.toThrow(/duplicate key/);
  });
});
