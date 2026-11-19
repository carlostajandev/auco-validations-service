# AUCO Validations Service

[![CI](https://github.com/carlostajandev/auco-validations-service/actions/workflows/ci.yml/badge.svg)](https://github.com/carlostajandev/auco-validations-service/actions/workflows/ci.yml)

Servicio en **NestJS + TypeScript** que registra validaciones de identidad:

1. Recibe nombre y número de documento.
2. Enriquece el registro con una API pública (foto de la tasa de cambio del momento).
3. Lo guarda en **MongoDB**.
4. Escribe un evento de auditoría en **DynamoDB Local** (llave: documento + fecha).
5. Responde con el `id` de la validación.

Además expone el historial de auditoría de cada documento, con filtro por fechas y paginación.

---

## Inicio rápido (un comando)

Requisito: **Docker** con Docker Compose v2.

```bash
docker compose up --build
```

| Qué | Dónde |
|---|---|
| API | http://localhost:3000 |
| Swagger (documentación interactiva) | http://localhost:3000/docs |
| Health check | http://localhost:3000/health |

La tabla de auditoría de DynamoDB se crea sola al arrancar.

### Correr sin Docker para la app (modo desarrollo)

```bash
cp .env.example .env
docker compose up -d mongo dynamodb   # solo las bases
npm install
npm run start:dev
```

---

## Endpoints

### `POST /validations`

```bash
curl -s -X POST http://localhost:3000/validations \
  -H 'content-type: application/json' \
  -d '{"name": "Ana María Pérez", "documentNumber": "1.020.304.050"}'
```

```json
{ "id": "6f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b" }
```

Reglas de validación:

| Campo | Regla |
|---|---|
| `name` | 2 a 100 caracteres; solo letras (con tildes y ñ), espacios, `'` y `-`. Se recortan espacios repetidos. |
| `documentNumber` | 5 a 20 caracteres alfanuméricos. Se ignoran puntos, guiones y espacios (`1.020.304-050` → `1020304050`). |
| Campos extra | Se rechazan con 400 (protege contra *mass assignment*). |

Error de validación (400):

```json
{
  "statusCode": 400,
  "error": "BAD_REQUEST",
  "message": ["documentNumber must be 5-20 alphanumeric characters"],
  "path": "/validations",
  "timestamp": "2026-11-19T15:04:05.123Z"
}
```

### `GET /validations/:id`

```bash
curl -s http://localhost:3000/validations/<id>
```

```json
{
  "id": "6f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b",
  "name": "Ana María Pérez",
  "documentNumber": "1020304050",
  "enrichmentStatus": "completed",
  "enrichment": {
    "provider": "open.er-api.com",
    "baseCurrency": "USD",
    "rates": { "COP": 4012.5, "EUR": 0.91, "MXN": 18.2, "BRL": 5.4, "CLP": 940 },
    "providerUpdatedAt": "2026-11-19T00:00:01.000Z",
    "fetchedAt": "2026-11-19T15:04:05.100Z"
  },
  "createdAt": "2026-11-19T15:04:05.123Z"
}
```

- `404` si no existe.
- `400` si el id no es un UUID.

### `GET /documents/:documentNumber/audit-events`

Historial de auditoría de un documento, del más reciente al más antiguo.

| Query | Descripción |
|---|---|
| `from`, `to` | Rango de fechas ISO 8601, inclusivo (opcionales) |
| `limit` | 1 a 100, por defecto 20 |
| `cursor` | `nextCursor` de la página anterior |

```bash
curl -s 'http://localhost:3000/documents/1020304050/audit-events?from=2026-11-01T00:00:00Z&limit=2'
```

```json
{
  "items": [
    {
      "eventType": "VALIDATION_CREATED",
      "validationId": "6f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b",
      "documentNumber": "1020304050",
      "name": "Ana María Pérez",
      "enrichmentStatus": "completed",
      "occurredAt": "2026-11-19T15:04:05.123Z"
    }
  ],
  "nextCursor": "eyJkb2N1bWVudE51bWJlciI6..."
}
```

El rango se resuelve con `BETWEEN` sobre la sort key (sin `Scan` ni filtros en memoria). El cursor es opaco y se rechaza si pertenece a otro documento.

### Ver los eventos directamente en DynamoDB Local

```bash
docker run --rm --network auco-validations-service_default \
  -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local \
  amazon/aws-cli dynamodb query \
  --endpoint-url http://dynamodb:8000 --region us-east-1 \
  --table-name validation_audit_events \
  --key-condition-expression "documentNumber = :d" \
  --expression-attribute-values '{":d":{"S":"1020304050"}}'
```

---

## Variables de entorno

Todas se validan al arrancar: si una falta o es inválida, la app **no arranca** (fail fast). Ver `.env.example`.

| Variable | Default | Para qué |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `LOG_LEVEL` | `info` | Nivel de logs (pino) |
| `MONGO_URI` | — (obligatoria) | Conexión a MongoDB |
| `DYNAMO_ENDPOINT` | — | Endpoint de DynamoDB Local (vacío = AWS real) |
| `DYNAMO_REGION` | `us-east-1` | Región |
| `DYNAMO_AUDIT_TABLE` | `validation_audit_events` | Tabla de auditoría |
| `ENRICHMENT_BASE_URL` | `https://open.er-api.com/v6` | API externa |
| `ENRICHMENT_BASE_CURRENCY` | `USD` | Moneda base |
| `ENRICHMENT_TARGET_CURRENCIES` | `COP,EUR,MXN,BRL,CLP` | Monedas que se guardan |
| `ENRICHMENT_TIMEOUT_MS` | `3000` | Timeout por intento |
| `ENRICHMENT_MAX_RETRIES` | `2` | Reintentos ante fallos transitorios |

---

## Arquitectura

Arquitectura **hexagonal (puertos y adaptadores)**. El dominio y los casos de uso no conocen MongoDB, DynamoDB ni HTTP: dependen de *puertos* (abstracciones) y el módulo decide qué *adaptador* implementa cada uno.

```
                 ┌─────────────── infraestructura ────────────────┐
  HTTP ──► ValidationsController                                   │
                 │                                                 │
                 ▼                                                 │
        ┌──── aplicación ─────┐                                    │
        │ CreateValidation    │──► EnrichmentPort ──► ExchangeRateAdapter ──► open.er-api.com
        │ GetValidation       │──► ValidationRepositoryPort ──► ValidationMongoRepository ──► MongoDB
        └─────────┬───────────┘──► AuditPort ──► AuditDynamoAdapter ──► DynamoDB Local
                  ▼                                                │
           dominio: Validation, errores                            │
                 └─────────────────────────────────────────────────┘
```

```
src/
  validations/
    domain/            entidad, errores de dominio y puertos (sin dependencias externas)
    application/       casos de uso
    infrastructure/
      http/            controladores + DTOs (entrada/salida)
      persistence/     adaptador MongoDB
      audit/           adaptador DynamoDB
      enrichment/      adaptador de la API externa
    validations.module.ts   ← único lugar que conecta puertos con adaptadores
  common/              config validada, filtro global de errores, reintentos, health
test/
  unit/                casos de uso, reintentos y adaptador HTTP (puertos simulados)
  e2e/                 API completa vía HTTP con adaptadores en memoria
  integration/         adaptadores contra MongoDB y DynamoDB reales (Testcontainers)
.github/workflows/     CI: lint, tipos, pruebas y build de la imagen
```

Flujo de `POST /validations`: **validar entrada → enriquecer → persistir → auditar → devolver id**.

---

## Decisiones y trade-offs

### API externa: tasa de cambio (open.er-api.com)
Gratis, sin API key y estable. Se guarda una **foto del contexto** en el momento de la validación (moneda base, tasas seleccionadas, fecha del proveedor y fecha de consulta): en un registro auditable interesa saber *cuál era el contexto cuando se validó*, no consultarlo después. Solo se guardan las monedas configuradas para no inflar cada documento con ~160 tasas.

### Resiliencia ante la API externa
- **Timeout** por intento (`AbortSignal.timeout`, 3 s por defecto): una API lenta no deja requests colgados.
- **Reintentos con backoff exponencial y jitter**, solo para fallos **transitorios** (red, timeout, 5xx, 429). Un 4xx o una respuesta mal formada no se reintenta: insistir no lo arregla.
- **Se valida la forma de la respuesta**: nunca se confía ciegamente en un tercero.
- **Fallback**: si el proveedor falla definitivamente, la validación **se guarda igual** con `enrichmentStatus: "failed"` y `enrichment: null`. El enriquecimiento es contexto, no una condición para validar; perder la validación por un tercero caído sería peor. Queda marcada para reprocesarla.

### El id lo genera el dominio (UUID v4), no Mongo
Así el mismo id se usa en MongoDB y en el evento de auditoría, y el dominio no depende de `ObjectId`. Además el GET rechaza con 400 cualquier id que no sea UUID antes de tocar la base.

### Llaves de DynamoDB
| Llave | Atributo | Valor |
|---|---|---|
| Partition key | `documentNumber` | `1020304050` |
| Sort key | `eventAt` | `2026-11-19T15:04:05.123Z#<validationId>` |

- **PK = documento**: agrupa en una partición todo el historial de un documento, que es el patrón de acceso natural de una auditoría ("¿qué pasó con este documento?"), resuelto con un `Query` sin `Scan`.
- **SK = fecha ISO 8601 en UTC**: ese formato se ordena alfabéticamente igual que en el tiempo, así que los eventos salen en orden cronológico y se pueden pedir rangos con `BETWEEN` o `begins_with` (p. ej. todo noviembre: `begins_with(eventAt, "2026-11")`), con paginación temporal.
- **Sufijo `#validationId`**: dos validaciones del mismo documento en el mismo milisegundo tendrían la misma llave y una sobrescribiría a la otra. El sufijo garantiza unicidad sin perder el orden.
- **Escritura condicional** (`attribute_not_exists`): un evento de auditoría nunca se sobrescribe.
- **El endpoint de historial aprovecha el diseño**: un `Query` por partición con `BETWEEN` sobre la sort key, orden descendente y paginación con `LastEvaluatedKey`. Las pruebas de integración lo verifican contra DynamoDB Local real.

### ¿Y si Mongo guarda pero DynamoDB falla?
Devolver 500 haría que el cliente reintente y cree una **validación duplicada**. Se responde 201 y el evento completo queda en un log de nivel `error` (`AUDIT_WRITE_FAILED`) para reprocesarlo. Si Mongo falla, no se audita nada (no hay eventos de algo que no existe). La solución definitiva es el patrón *transactional outbox* (ver "Qué mejoraría").

### Errores consistentes
Un filtro global traduce errores de dominio a HTTP (`ValidationNotFoundError` → 404, etc.) y devuelve siempre la misma forma. Los 500 nunca exponen detalles internos; el detalle va al log.

### Logs
JSON estructurado con `pino`, un `x-request-id` por request (se respeta el que envíe el cliente) y el cuerpo de los requests excluido de los logs para no registrar datos personales.

### Lo que deliberadamente NO se hizo
Nada de colas, microservicios ni CQRS: es un solo servicio con dos endpoints. Hexagonal sí, porque hace todo testeable y deja claro dónde va cada cosa; más complejidad no se justifica aquí.

---

## Pruebas

```bash
npm install
npm test                  # unitarias
npm run test:e2e          # API completa vía HTTP
npm run test:integration  # contra MongoDB y DynamoDB reales (requiere Docker)
npm run test:all          # las tres
```

| Capa | Qué prueba | Dependencias |
|---|---|---|
| Unitarias | Casos de uso, reintentos, adaptador HTTP | Ninguna (puertos simulados) |
| E2E | Contrato HTTP: validación, códigos, formato de errores | Ninguna (adaptadores en memoria) |
| Integración | Consultas reales: orden, rangos, cursor, escritura condicional, `_id` UUID | Docker (Testcontainers levanta contenedores efímeros) |

> Nota: el driver de MongoDB 7 carga un módulo con `import()` dinámico, que Jest solo soporta con `--experimental-vm-modules`. Por eso el script de integración activa esa opción; sin ella la conexión falla con *"Missing required sub-document 'driver'"*.

La CI (GitHub Actions) corre lint, tipos, las tres capas de pruebas y el build de la imagen en cada push y pull request.

Las pruebas verifican **comportamiento**, incluidas las rutas de error:

- Si la API externa falla, se guarda con `enrichmentStatus=failed`.
- Se escribe el evento de auditoría al crear; si Mongo falla, no se audita.
- Si la auditoría falla, la validación igual responde con su id.
- Reintenta un 503, **no** reintenta un 404, corta por timeout, rechaza respuestas mal formadas.
- Historial: orden cronológico inverso, rango inclusivo, paginación sin repetir ni saltarse eventos, dos eventos en el mismo milisegundo no se pisan, cursor ajeno rechazado.
- Backoff exponencial correcto.
- `POST` inválido → 400 con mensaje claro; campos extra → 400; `GET` inexistente → 404; id no UUID → 400.

Las unitarias simulan los puertos y las e2e usan adaptadores en memoria: corren en segundos, sin Docker ni red.

---

## Prueba de fuego (contra el servicio corriendo)

Además de las pruebas automáticas, `scripts/fire-test.mjs` ataca el servicio levantado con Docker como si fuera producción:

```bash
docker compose up -d --build
npm run test:fire     # contrato + carga + consistencia
npm run test:chaos    # además tumba DynamoDB, MongoDB y la API externa en caliente
```

| Bloque | Qué verifica |
|---|---|
| Contrato | Los 4 endpoints, códigos de respuesta, formato de errores, `x-request-id`, inyección NoSQL, JSON roto, cuerpos gigantes (413) |
| Carga | 100 POST y 1.000 GET con 20 usuarios simultáneos: latencias p50/p95/p99 y 0 errores 5xx |
| Consistencia | Toda validación creada se puede leer y tiene su evento de auditoría; 25 POST simultáneos del mismo documento no se pisan |
| Caos | DynamoDB reiniciándose, MongoDB caído y API externa colgada, con el servicio en marcha |

Resultados en una máquina de desarrollo (37/37 verificaciones OK):

| Escenario | Resultado |
|---|---|
| POST bajo carga | p95 ≈ 250-370 ms (incluye la llamada a la API externa), 0 errores |
| GET bajo carga | p95 ≈ 55-80 ms, ~900 req/s, 100 % OK |
| DynamoDB reiniciándose | 0 POST fallidos; ~26 de 40 eventos quedaron en el log `AUDIT_WRITE_FAILED` |
| MongoDB caído | `503` en 5 s (no se cuelga), `/health` en 503, sin filtrar detalles internos; se recupera solo al volver |
| API externa colgada | `201` con `enrichmentStatus=failed` en ~3,8 s (3 intentos de 1 s + backoff) |

Lo que la prueba encontró y se corrigió:
- Un cuerpo de 2 MB devolvía **500** en vez de **413**: el filtro global no reconocía los errores de `body-parser`. Ahora respeta los errores HTTP de Express y el cuerpo se limita a 10 KB.
- Con MongoDB caído se respondía **500**; ahora el adaptador traduce los errores de conexión a un error de dominio y la API responde **503** (temporal, reintentable).

Lo que la prueba deja medido: con DynamoDB caído, las validaciones no se pierden pero sus eventos de auditoría quedan solo en el log. Es la razón concreta para implementar el *transactional outbox* (primera mejora de la lista siguiente).

## Qué mejoraría con más tiempo

- **Transactional outbox** para la auditoría: guardar el evento pendiente junto a la validación en Mongo y que un proceso lo publique a DynamoDB con reintentos; ningún evento se pierde.
- **Idempotencia** en `POST` (`Idempotency-Key`) para que un reintento del cliente no duplique validaciones.
- **Reprocesar** las validaciones con `enrichmentStatus=failed`.
- **Caché** del enriquecimiento (la tasa cambia una vez al día) y *circuit breaker* hacia el proveedor.
- **CD**: publicar la imagen en un registro y desplegar desde la CI.
- **Autenticación** (JWT/OAuth2), *rate limiting* y cifrado o enmascarado del número de documento.
- **Observabilidad**: OpenTelemetry (trazas) y métricas Prometheus.
- **Terraform** para la tabla real de DynamoDB (con TTL y point-in-time recovery).
