import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../../src/app.setup';
import { ValidationsController } from '../../src/validations/infrastructure/http/validations.controller';
import { CreateValidationUseCase } from '../../src/validations/application/create-validation.usecase';
import { GetValidationUseCase } from '../../src/validations/application/get-validation.usecase';
import { ValidationRepositoryPort } from '../../src/validations/domain/ports/validation.repository.port';
import {
  AuditEvent,
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
  let app: INestApplication<App>;
  let audit: InMemoryAudit;
  let enrichment: FakeEnrichment;

  beforeAll(async () => {
    audit = new InMemoryAudit();
    enrichment = new FakeEnrichment();

    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationsController],
      providers: [
        CreateValidationUseCase,
        GetValidationUseCase,
        {
          provide: ValidationRepositoryPort,
          useValue: new InMemoryRepository(),
        },
        { provide: AuditPort, useValue: audit },
        { provide: EnrichmentPort, useValue: enrichment },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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

  it('GET de un id inexistente responde 404', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/validations/3f2b6c1e-8a4d-4f7e-9b2a-1c5d8e9f0a1b')
      .expect(404);
    expect(body.statusCode).toBe(404);
  });

  it('GET con un id que no es UUID responde 400', async () => {
    await request(app.getHttpServer()).get('/validations/abc').expect(400);
  });
});
