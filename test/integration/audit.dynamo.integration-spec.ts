import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { AuditDynamoAdapter } from '../../src/validations/infrastructure/audit/dynamo/audit.dynamo.adapter';
import { AuditEvent } from '../../src/validations/domain/ports/audit.port';
import { InvalidQueryError } from '../../src/validations/domain/errors';

describe('AuditDynamoAdapter (integration)', () => {
  let container: StartedTestContainer;
  let adapter: AuditDynamoAdapter;

  const event = (documentNumber: string, iso: string): AuditEvent => ({
    eventType: 'VALIDATION_CREATED',
    validationId: randomUUID(),
    documentNumber,
    name: 'Ana Pérez',
    enrichmentStatus: 'completed',
    occurredAt: new Date(iso),
  });

  beforeAll(async () => {
    container = await new GenericContainer('amazon/dynamodb-local:2.5.2')
      .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'])
      .withExposedPorts(8000)
      .start();

    const client = new DynamoDBClient({
      region: 'us-east-1',
      endpoint: `http://${container.getHost()}:${container.getMappedPort(8000)}`,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
    adapter = new AuditDynamoAdapter(client, 'audit_test');
    await adapter.onModuleInit(); // crea la tabla
  });

  afterAll(async () => {
    await container?.stop();
  });

  it('devuelve el historial de un documento del más reciente al más antiguo', async () => {
    const doc = 'DOC0001';
    await adapter.record(event(doc, '2026-11-10T10:00:00.000Z'));
    await adapter.record(event(doc, '2026-11-12T10:00:00.000Z'));
    await adapter.record(event(doc, '2026-11-11T10:00:00.000Z'));
    await adapter.record(event('OTHER001', '2026-11-11T10:00:00.000Z'));

    const page = await adapter.findByDocument({
      documentNumber: doc,
      limit: 10,
    });

    expect(page.items.map((e) => e.occurredAt.toISOString())).toEqual([
      '2026-11-12T10:00:00.000Z',
      '2026-11-11T10:00:00.000Z',
      '2026-11-10T10:00:00.000Z',
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('filtra por rango de fechas inclusivo usando la sort key', async () => {
    const doc = 'DOC0002';
    for (const day of ['01', '15', '30']) {
      await adapter.record(event(doc, `2026-11-${day}T12:00:00.000Z`));
    }
    await adapter.record(event(doc, '2026-12-01T00:00:00.000Z'));

    const page = await adapter.findByDocument({
      documentNumber: doc,
      from: new Date('2026-11-15T12:00:00.000Z'),
      to: new Date('2026-11-30T12:00:00.000Z'), // mismo instante que un evento
      limit: 10,
    });

    expect(page.items.map((e) => e.occurredAt.toISOString())).toEqual([
      '2026-11-30T12:00:00.000Z',
      '2026-11-15T12:00:00.000Z',
    ]);
  });

  it('pagina con cursor sin repetir ni saltarse eventos', async () => {
    const doc = 'DOC0003';
    for (let i = 1; i <= 5; i++) {
      await adapter.record(event(doc, `2026-11-0${i}T00:00:00.000Z`));
    }

    const first = await adapter.findByDocument({
      documentNumber: doc,
      limit: 2,
    });
    const second = await adapter.findByDocument({
      documentNumber: doc,
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await adapter.findByDocument({
      documentNumber: doc,
      limit: 2,
      cursor: second.nextCursor!,
    });

    const days = [...first.items, ...second.items, ...third.items].map((e) =>
      e.occurredAt.toISOString().slice(8, 10),
    );
    expect(days).toEqual(['05', '04', '03', '02', '01']);
  });

  it('dos eventos del mismo documento en el mismo milisegundo no se pisan', async () => {
    const doc = 'DOC0004';
    const iso = '2026-11-19T15:00:00.000Z';
    await adapter.record(event(doc, iso));
    await adapter.record(event(doc, iso));

    const page = await adapter.findByDocument({
      documentNumber: doc,
      limit: 10,
    });
    expect(page.items).toHaveLength(2);
  });

  it('nunca sobrescribe un evento existente (escritura condicional)', async () => {
    const duplicated = event('DOC0005', '2026-11-19T15:00:00.000Z');
    await adapter.record(duplicated);

    await expect(adapter.record(duplicated)).rejects.toThrow(
      /conditional request failed/i,
    );
  });

  it('rechaza un cursor que pertenece a otro documento', async () => {
    const foreign = Buffer.from(
      JSON.stringify({ documentNumber: 'DOC0001', eventAt: 'x' }),
    ).toString('base64url');

    await expect(
      adapter.findByDocument({
        documentNumber: 'DOC0003',
        limit: 2,
        cursor: foreign,
      }),
    ).rejects.toBeInstanceOf(InvalidQueryError);
  });
});
