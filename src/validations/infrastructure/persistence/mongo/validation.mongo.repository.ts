import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ValidationRepositoryPort } from '../../../domain/ports/validation.repository.port';
import { Validation } from '../../../domain/validation.entity';
import { PersistenceUnavailableError } from '../../../domain/errors';
import { ValidationDocument } from './validation.schema';

@Injectable()
export class ValidationMongoRepository extends ValidationRepositoryPort {
  constructor(
    @InjectModel(ValidationDocument.name)
    private readonly model: Model<ValidationDocument>,
  ) {
    super();
  }

  async save(validation: Validation): Promise<void> {
    const { id, ...rest } = validation.toPrimitives();
    await this.translateErrors(() => this.model.create({ _id: id, ...rest }));
  }

  async findById(id: string): Promise<Validation | null> {
    // lean(): devuelve un objeto plano (más rápido, sin la "magia" de Mongoose)
    const doc = await this.translateErrors(() =>
      this.model.findById(id).lean().exec(),
    );
    if (!doc) return null;

    return Validation.restore({
      id: doc._id,
      name: doc.name,
      documentNumber: doc.documentNumber,
      enrichmentStatus: doc.enrichmentStatus,
      enrichment: doc.enrichment,
      createdAt: doc.createdAt,
    });
  }

  /**
   * Los errores de conexión de Mongo se traducen a un error de dominio:
   * el resto de la app (y el filtro HTTP) no necesita saber que existe Mongo.
   */
  private async translateErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isConnectionError(error)) {
        throw new PersistenceUnavailableError(error);
      }
      throw error;
    }
  }
}

const CONNECTION_ERRORS = new Set([
  'MongooseServerSelectionError',
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
]);

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    CONNECTION_ERRORS.has(error.name) ||
    /buffering timed out/i.test(error.message)
  );
}
