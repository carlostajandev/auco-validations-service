# AUCO Validations Service

Servicio en **NestJS + TypeScript** que registra validaciones de identidad:

1. Recibe nombre y número de documento.
2. Enriquece el registro con una API pública (foto de la tasa de cambio del momento).
3. Lo guarda en **MongoDB**.
4. Escribe un evento de auditoría en **DynamoDB Local** (llave: documento + fecha).
5. Responde con el `id` de la validación.

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

### Ver los eventos de auditoría en DynamoDB Local

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
      http/            controlador + DTOs (entrada/salida)
      persistence/     adaptador MongoDB
      audit/           adaptador DynamoDB
      enrichment/      adaptador de la API externa
    validations.module.ts   ← único lugar que conecta puertos con adaptadores
  common/              config validada, filtro global de errores, reintentos, health
test/
  unit/                casos de uso, reintentos y adaptador HTTP (puertos simulados)
  e2e/                 API completa vía HTTP con adaptadores en memoria
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
npm test            # unitarias
npm run test:e2e    # API completa vía HTTP
npm run test:cov    # cobertura
```

Las pruebas verifican **comportamiento**, incluidas las rutas de error:

- Si la API externa falla, se guarda con `enrichmentStatus=failed`.
- Se escribe el evento de auditoría al crear; si Mongo falla, no se audita.
- Si la auditoría falla, la validación igual responde con su id.
- Reintenta un 503, **no** reintenta un 404, corta por timeout, rechaza respuestas mal formadas.
- Backoff exponencial correcto.
- `POST` inválido → 400 con mensaje claro; campos extra → 400; `GET` inexistente → 404; id no UUID → 400.

Las unitarias simulan los puertos y las e2e usan adaptadores en memoria: corren en segundos, sin Docker ni red.

---

## Qué mejoraría con más tiempo

- **Transactional outbox** para la auditoría: guardar el evento pendiente junto a la validación en Mongo y que un proceso lo publique a DynamoDB con reintentos; ningún evento se pierde.
- **Idempotencia** en `POST` (`Idempotency-Key`) para que un reintento del cliente no duplique validaciones.
- **Pruebas de integración con Testcontainers** contra Mongo y DynamoDB reales.
- **Endpoint de historial** `GET /validations/history/:documentNumber` paginado sobre la tabla de auditoría.
- **Reprocesar** las validaciones con `enrichmentStatus=failed`.
- **Caché** del enriquecimiento (la tasa cambia una vez al día) y *circuit breaker* hacia el proveedor.
- **CI** con GitHub Actions (lint + pruebas + build de la imagen).
- **Autenticación** (JWT/OAuth2), *rate limiting* y cifrado o enmascarado del número de documento.
- **Observabilidad**: OpenTelemetry (trazas) y métricas Prometheus.
- **Terraform** para la tabla real de DynamoDB (con TTL y point-in-time recovery).
