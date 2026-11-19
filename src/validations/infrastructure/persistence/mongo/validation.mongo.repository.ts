import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ValidationRepositoryPort } from '../../../domain/ports/validation.repository.port';
import { Validation } from '../../../domain/validation.entity';
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
    await this.model.create({ _id: id, ...rest });
  }

  async findById(id: string): Promise<Validation | null> {
    // lean(): devuelve un objeto plano (más rápido, sin la "magia" de Mongoose)
    const doc = await this.model.findById(id).lean().exec();
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
}
