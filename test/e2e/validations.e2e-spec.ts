import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { ValidationsController } from '../../src/validations/infrastructure/http/validations.controller';
import { AuditHistoryController } from '../../src/validations/infrastructure/http/audit-history.controller';
import { ListAuditEventsUseCase } from '../../src/validations/application/list-audit-events.usecase';
import { CreateValidationUseCase } from '../../src/validations/application/create-validation.usecase';
import { GetValidationUseCase } from '../../src/validations/application/get-validation.usecase';
import { ValidationRepositoryPort } from '../../src/validations/domain/ports/validation.repository.port';
import {
  AuditEvent,
  AuditHistoryQuery,
  AuditPort,
} from '../../src/validations/domain/ports/audit.port';
import { EnrichmentPort } from '../../src/validations/domain/ports/enrichment.port';
import { Validation } from '../../src/validations/domain/validation.entity';
import { EnrichmentUnavailableError } from '../../src/validations/domain/errors';

/** Adaptadores falsos en memoria: rápidos y deterministas, sin Docker. */
class InMemoryRepository extends ValidationRepositoryPort {
  readonly items = new Map<string, Validation>();
  save(v: Validation) {
    this.items.set(v.id, v);
    return Promise.resolve();
  }
  findById(id: string) {
    return Promise.resolve(this.items.get(id) ?? null);
  }
}

class InMemoryAudit extends AuditPort {
  readonly events: AuditEvent[] = [];
  record(event: AuditEvent) {
    this.events.push(event);
    return Promise.resolve();
  }
  findByDocument(query: AuditHistoryQuery) {
    const items = this.events
      .filter((e) => e.documentNumber === query.documentNumber)
      .filter((e) => !query.from || e.occurredAt >= query.from)
      .filter((e) => !query.to || e.occurredAt <= query.to)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return Promise.resolve({
      items: items.slice(0, query.limit),
      nextCursor: null,
    });
  }
}

class FakeEnrichment extends EnrichmentPort {
  fail = false;
  fetchSnapshot() {
    if (this.fail) {
      return Promise.reject(new EnrichmentUnavailableError('timeout'));
    }
    return Promise.resolve({
      provider: 'fake',
      baseCurrency: 'USD',
      rates: { COP: 4000 },
      providerUpdatedAt: '2026-11-19T00:00:00.000Z',
      fetchedAt: '2026-11-19T00:00:00.000Z',
    });
  }
}

describe('Validations API (e2e)', () => {
  let app: NestExpressApplication;
  let audit: InMemoryAudit;
  let enrichment: FakeEnrichment;

  beforeAll(async () => {
    audit = new InMemoryAudit();
    enrichment = new FakeEnrichment();

    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationsController, AuditHistoryController],
      providers: [
        CreateValidationUseCase,
        GetValidationUseCase,
        ListAuditEventsUseCase,
        {
          provide: ValidationRepositoryPort,
          useValue: new InMemoryRepository(),
        },
        { provide: AuditPort, useValue: audit },
        { provide: EnrichmentPort, useValue: enrichment },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    enrichment.fail = false;
  });

  it('POST crea, GET devuelve el registro enriquecido y se audita', async () => {
    const created = await request(app.getHttpServer())
      .post('/validations')
      .send({ name: '  Ana   Pérez ', documentNumber: '1.020.304-050' })
      .expect(201);

    expect(created.body).toEqual({ id: expect.any(String) });

    const { body } = await request(app.getHttpServer())
      .get(`/validations/${created.body.id}`)
      .expect(200);

    expect(body).toMatchObject({
      id: created.body.id,
      name: 'Ana Pérez', // espacios normalizados
      documentNumber: '1020304050', // puntos y guiones removidos
      enrichmentStatus: 'completed',
      enrichment: { baseCurrency: 'USD', rates: { COP: 4000 } },
    });
    expect(audit.events.at(-1)).toMatchObject({
      validationId: created.body.id,
      documentNumber: '1020304050',
    });
  });

  it('POST con la API externa caída responde 201 y guarda enrichmentStatus=failed', async () => {
    enrichment.fail = true;

    const created = await request(app.getHttpServer())
      .post('/validations')
      .send({ name: 'Luis Gómez', documentNumber: '987654321' })
      .expect(201);

    const { body } = await request(app.getHttpServer())
      .get(`/validations/${created.body.id}`)
      .expect(200);
    expect(body.enrichmentStatus).toBe('failed');
    expect(body.enrichment).toBeNull();
  });

  it.each([
    ['payload vacío', {}],
    ['nombre con números', { name: 'R2D2', documentNumber: '1020304050' }],
    ['documento muy corto', { name: 'Ana', documentNumber: '12' }],
    [
      'campos no permitidos',
      { name: 'Ana', documentNumber: '1020304050', isAdmin: true },
    ],
  ])('POST con %s responde 400 con mensaje claro', async (_case, payload) => {
    const { body } = await request(app.getHttpServer())
      .post('/validations')
      .send(payload)
      .expect(400);

    expect(body).toMatchObject({
      statusCode: 400,
      error: 'BAD_REQUEST',
      path: '/validations',
    });
    expect(Array.isArray(body.message)).toBe(true);
  });

  it('POST con JSON mal formado responde 400, no 500', async () => {
    await request(app.getHttpServer())
      .post('/validations')
      .set('content-type', 'application/json')
      .send('{"name": "Ana",')
      .expect(400);
  });

  it('POST con un cuerpo de más de 10 KB responde 413, no 500', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/validations')
      .send({
        name: 'Ana',
        documentNumber: '1020304050',
        pad: 'x'.repeat(20_000),
      })
      .expect(413);
    expect(body.statusCode).toBe(413);
  });

  it('GET de un id inexistente responde 404', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/validations/3f2b6c1e-8a4d-4f7e-9b2a-1c5d8e9f0a1b')
      .expect(404);
    expect(body.statusCode).toBe(404);
  });

  it('GET con un id que no es UUID responde 400', async () => {
    await request(app.getHttpServer()).get('/validations/abc').expect(400);
  });

  describe('GET /documents/:documentNumber/audit-events', () => {
    it('devuelve el historial del documento, normalizando el número', async () => {
      await request(app.getHttpServer())
        .post('/validations')
        .send({ name: 'Marta Ruiz', documentNumber: '55667788' })
        .expect(201);

      const { body } = await request(app.getHttpServer())
        .get('/documents/55.667.788/audit-events')
        .expect(200);

      expect(body.nextCursor).toBeNull();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        eventType: 'VALIDATION_CREATED',
        documentNumber: '55667788',
        occurredAt: expect.any(String),
      });
    });

    it.each([
      ['una fecha inválida', '?from=ayer'],
      ['un limit fuera de rango', '?limit=500'],
      [
        'un rango invertido',
        '?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z',
      ],
    ])('responde 400 con %s', async (_case, qs) => {
      await request(app.getHttpServer())
        .get(`/documents/55667788/audit-events${qs}`)
        .expect(400);
    });
  });
});
