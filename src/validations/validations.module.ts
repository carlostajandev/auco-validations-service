import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateValidationUseCase } from './application/create-validation.usecase';
import { GetValidationUseCase } from './application/get-validation.usecase';
import { ListAuditEventsUseCase } from './application/list-audit-events.usecase';
import { ValidationRepositoryPort } from './domain/ports/validation.repository.port';
import { AuditPort } from './domain/ports/audit.port';
import { EnrichmentPort } from './domain/ports/enrichment.port';
import { ValidationsController } from './infrastructure/http/validations.controller';
import { AuditHistoryController } from './infrastructure/http/audit-history.controller';
import {
  ValidationDocument,
  ValidationSchema,
} from './infrastructure/persistence/mongo/validation.schema';
import { ValidationMongoRepository } from './infrastructure/persistence/mongo/validation.mongo.repository';
import {
  AUDIT_TABLE_NAME,
  AuditDynamoAdapter,
  DYNAMO_CLIENT,
} from './infrastructure/audit/dynamo/audit.dynamo.adapter';
import {
  EXCHANGE_RATE_OPTIONS,
  ExchangeRateAdapter,
  ExchangeRateOptions,
} from './infrastructure/enrichment/exchange-rate.adapter';
import { CachedEnrichmentAdapter } from './infrastructure/enrichment/cached-enrichment.adapter';

// Aquí se decide qué adaptador implementa cada puerto.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ValidationDocument.name, schema: ValidationSchema },
    ]),
  ],
  controllers: [ValidationsController, AuditHistoryController],
  providers: [
    CreateValidationUseCase,
    GetValidationUseCase,
    ListAuditEventsUseCase,

    { provide: ValidationRepositoryPort, useClass: ValidationMongoRepository },
    { provide: AuditPort, useClass: AuditDynamoAdapter },
    ExchangeRateAdapter,
    {
      // la tasa cambia una vez al día, no hace falta pedirla en cada POST
      provide: EnrichmentPort,
      inject: [ExchangeRateAdapter, ConfigService],
      useFactory: (http: ExchangeRateAdapter, config: ConfigService) =>
        new CachedEnrichmentAdapter(http, {
          ttlMs: config.getOrThrow<number>('ENRICHMENT_CACHE_TTL_MS'),
          maxStaleMs: config.getOrThrow<number>(
            'ENRICHMENT_CACHE_MAX_STALE_MS',
          ),
        }),
    },

    {
      provide: DYNAMO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DynamoDBClient({
          region: config.getOrThrow<string>('DYNAMO_REGION'),
          endpoint: config.get<string>('DYNAMO_ENDPOINT'),
        }),
    },
    {
      provide: AUDIT_TABLE_NAME,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('DYNAMO_AUDIT_TABLE'),
    },
    {
      provide: EXCHANGE_RATE_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ExchangeRateOptions => ({
        baseUrl: config.getOrThrow<string>('ENRICHMENT_BASE_URL'),
        baseCurrency: config.getOrThrow<string>('ENRICHMENT_BASE_CURRENCY'),
        targetCurrencies: config
          .getOrThrow<string>('ENRICHMENT_TARGET_CURRENCIES')
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        timeoutMs: config.getOrThrow<number>('ENRICHMENT_TIMEOUT_MS'),
        maxRetries: config.getOrThrow<number>('ENRICHMENT_MAX_RETRIES'),
      }),
    },
  ],
})
export class ValidationsModule {}
