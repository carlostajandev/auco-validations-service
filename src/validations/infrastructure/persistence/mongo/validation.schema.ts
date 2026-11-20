import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  EnrichmentStatus,
  ExchangeRateSnapshot,
} from '../../../domain/validation.entity';

// Tipos explícitos en cada @Prop: con ts-jest la metadata del enum no llega y Mongoose revienta.
@Schema({ collection: 'validations', versionKey: false })
export class ValidationDocument {
  // uuid del dominio, no ObjectId
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, index: true })
  documentNumber!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(EnrichmentStatus),
  })
  enrichmentStatus!: EnrichmentStatus;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  enrichment!: ExchangeRateSnapshot | null;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}

export type ValidationHydratedDocument = HydratedDocument<ValidationDocument>;
export const ValidationSchema =
  SchemaFactory.createForClass(ValidationDocument);
