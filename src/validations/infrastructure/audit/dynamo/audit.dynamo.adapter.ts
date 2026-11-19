import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AuditEvent, AuditPort } from '../../../domain/ports/audit.port';
import { withRetry } from '../../../../common/resilience/retry';

export const DYNAMO_CLIENT = Symbol('DYNAMO_CLIENT');
export const AUDIT_TABLE_NAME = Symbol('AUDIT_TABLE_NAME');

/**
 * Diseño de llaves de la tabla de auditoría:
 *   PK  documentNumber            -> agrupa todo el historial de un documento
 *   SK  eventAt = "<ISO-8601>#<validationId>"
 *       - ISO 8601 en UTC se ordena alfabéticamente igual que en el tiempo,
 *         así que BETWEEN / begins_with sobre el SK sirven para rangos de fechas.
 *       - El sufijo #validationId evita que dos eventos del mismo documento
 *         en el mismo milisegundo se sobrescriban.
 */
@Injectable()
export class AuditDynamoAdapter extends AuditPort implements OnModuleInit {
  private readonly logger = new Logger(AuditDynamoAdapter.name);
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    @Inject(DYNAMO_CLIENT) private readonly client: DynamoDBClient,
    @Inject(AUDIT_TABLE_NAME) private readonly tableName: string,
  ) {
    super();
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /** Crea la tabla al arrancar si no existe (solo tiene sentido en local). */
  async onModuleInit(): Promise<void> {
    // DynamoDB Local tarda unos segundos en estar listo dentro de Docker.
    await withRetry(() => this.ensureTable(), {
      retries: 8,
      baseDelayMs: 500,
      onRetry: (error, attempt) =>
        this.logger.warn(
          `DynamoDB not ready (attempt ${attempt}): ${(error as Error).message}`,
        ),
    });
  }

  async record(event: AuditEvent): Promise<void> {
    const occurredAt = event.occurredAt.toISOString();
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          documentNumber: event.documentNumber,
          eventAt: `${occurredAt}#${event.validationId}`,
          occurredAt,
          eventType: event.eventType,
          validationId: event.validationId,
          name: event.name,
          enrichmentStatus: event.enrichmentStatus,
        },
        // Un registro de auditoría nunca se sobrescribe.
        ConditionExpression: 'attribute_not_exists(eventAt)',
      }),
    );
  }

  private async ensureTable(): Promise<void> {
    try {
      await this.client.send(
        new DescribeTableCommand({ TableName: this.tableName }),
      );
      return;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }

    this.logger.log(`Creating audit table "${this.tableName}"`);
    await this.client.send(
      new CreateTableCommand({
        TableName: this.tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'documentNumber', AttributeType: 'S' },
          { AttributeName: 'eventAt', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'documentNumber', KeyType: 'HASH' },
          { AttributeName: 'eventAt', KeyType: 'RANGE' },
        ],
      }),
    );
    await waitUntilTableExists(
      { client: this.client, maxWaitTime: 30 },
      { TableName: this.tableName },
    );
  }
}
