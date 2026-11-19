import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  AuditEvent,
  AuditHistoryPage,
  AuditHistoryQuery,
  AuditPort,
} from '../../../domain/ports/audit.port';
import { InvalidQueryError } from '../../../domain/errors';
import { withRetry } from '../../../../common/resilience/retry';

export const DYNAMO_CLIENT = Symbol('DYNAMO_CLIENT');
export const AUDIT_TABLE_NAME = Symbol('AUDIT_TABLE_NAME');

/**
 * '~' es mayor que cualquier carácter de un UUID (0-9, a-f, '-'), así que
 * "<ISO>#~" es el límite superior inclusivo de todos los eventos de ese instante.
 */
const UPPER_SUFFIX = '#~';

interface AuditItem {
  documentNumber: string;
  eventAt: string;
  occurredAt: string;
  eventType: AuditEvent['eventType'];
  validationId: string;
  name: string;
  enrichmentStatus: string;
}

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

  async findByDocument(query: AuditHistoryQuery): Promise<AuditHistoryPage> {
    const input: QueryCommandInput = {
      TableName: this.tableName,
      ...this.keyCondition(query),
      ScanIndexForward: false, // del más reciente al más antiguo
      Limit: query.limit,
      ExclusiveStartKey: query.cursor
        ? this.decodeCursor(query.cursor, query.documentNumber)
        : undefined,
    };

    const result = await this.docClient.send(new QueryCommand(input));
    const items = (result.Items ?? []) as AuditItem[];

    return {
      items: items.map((item) => ({
        eventType: item.eventType,
        validationId: item.validationId,
        documentNumber: item.documentNumber,
        name: item.name,
        enrichmentStatus: item.enrichmentStatus,
        occurredAt: new Date(item.occurredAt),
      })),
      nextCursor: result.LastEvaluatedKey
        ? this.encodeCursor(result.LastEvaluatedKey)
        : null,
    };
  }

  /** Rango de fechas resuelto sobre la sort key: sin Scan ni filtros en memoria. */
  private keyCondition(
    query: AuditHistoryQuery,
  ): Pick<
    QueryCommandInput,
    'KeyConditionExpression' | 'ExpressionAttributeValues'
  > {
    const values: Record<string, string> = { ':doc': query.documentNumber };
    let condition = 'documentNumber = :doc';

    const from = query.from?.toISOString();
    const to = query.to ? query.to.toISOString() + UPPER_SUFFIX : undefined;

    if (from && to) {
      condition += ' AND eventAt BETWEEN :from AND :to';
      Object.assign(values, { ':from': from, ':to': to });
    } else if (from) {
      condition += ' AND eventAt >= :from';
      values[':from'] = from;
    } else if (to) {
      condition += ' AND eventAt <= :to';
      values[':to'] = to;
    }

    return {
      KeyConditionExpression: condition,
      ExpressionAttributeValues: values,
    };
  }

  /** El cursor es la llave del último elemento, en base64url: opaco para el cliente. */
  private encodeCursor(key: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(key)).toString('base64url');
  }

  private decodeCursor(
    cursor: string,
    documentNumber: string,
  ): Record<string, string> {
    try {
      const key = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      // Un cursor de otro documento (o manipulado) no se acepta.
      if (
        key.documentNumber !== documentNumber ||
        typeof key.eventAt !== 'string'
      ) {
        throw new Error('cursor does not belong to this document');
      }
      return { documentNumber, eventAt: key.eventAt };
    } catch {
      throw new InvalidQueryError('Invalid cursor');
    }
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
