import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  EnrichmentStatus,
  ExchangeRateSnapshot,
} from '../../../domain/validation.entity';

@Schema({ collection: 'validations', versionKey: false })
export class ValidationDocument {
  /** UUID generado por el dominio (no el ObjectId de Mongo). */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, index: true })
  documentNumber!: string;

  @Prop({ required: true, enum: Object.values(EnrichmentStatus) })
  enrichmentStatus!: EnrichmentStatus;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  enrichment!: ExchangeRateSnapshot | null;

  @Prop({ required: true })
  createdAt!: Date;
}

export type ValidationHydratedDocument = HydratedDocument<ValidationDocument>;
export const ValidationSchema =
  SchemaFactory.createForClass(ValidationDocument);
