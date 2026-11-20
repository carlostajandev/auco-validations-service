# auco-validations-service

[![CI](https://github.com/carlostajandev/auco-validations-service/actions/workflows/ci.yml/badge.svg)](https://github.com/carlostajandev/auco-validations-service/actions/workflows/ci.yml)

Prueba técnica para AUCO. Es un servicio en NestJS que recibe un nombre y un número de documento, lo enriquece con la tasa de cambio del momento (open.er-api.com), lo guarda en MongoDB y deja un evento de auditoría en DynamoDB Local. También expone el historial de auditoría de cada documento.

## Cómo correrlo

Solo necesitas Docker:

```bash
docker compose up --build
```

- API: http://localhost:3000
- Swagger: http://localhost:3000/docs
- Health: http://localhost:3000/health

La tabla de DynamoDB se crea sola al arrancar. Si prefieres correr la app fuera de Docker:

```bash
cp .env.example .env
docker compose up -d mongo dynamodb
npm install
npm run start:dev
```

En `requests.http` hay peticiones listas para la extensión REST Client de VS Code.

## Endpoints

**`POST /validations`**

```bash
curl -s -X POST http://localhost:3000/validations \
  -H 'content-type: application/json' \
  -d '{"name": "Ana María Pérez", "documentNumber": "1.020.304.050"}'
# {"id":"6f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b"}
```

- `name`: de 2 a 100 caracteres; letras (con tildes y ñ), espacios, `'` y `-`.
- `documentNumber`: de 5 a 20 alfanuméricos. Los puntos, guiones y espacios se ignoran, así que `1.020.304-050` queda como `1020304050`.
- Si llegan campos que no están en el DTO, la respuesta es 400. El cuerpo tiene un límite de 10 KB (413 si se pasa).

Los errores siempre tienen la misma forma:

```json
{
  "statusCode": 400,
  "error": "BAD_REQUEST",
  "message": ["documentNumber must be 5-20 alphanumeric characters"],
  "path": "/validations",
  "timestamp": "2026-11-19T15:04:05.123Z"
}
```

**`GET /validations/:id`**: devuelve el registro con el snapshot de la tasa. Da 404 si no existe y 400 si el id no es un UUID.

```json
{
  "id": "6f1c2b8e-3a4d-4e5f-9a6b-7c8d9e0f1a2b",
  "name": "Ana María Pérez",
  "documentNumber": "1020304050",
  "enrichmentStatus": "completed",
  "enrichment": {
    "provider": "open.er-api.com",
    "baseCurrency": "USD",
    "rates": { "COP": 3308.13, "EUR": 0.91, "MXN": 18.72, "BRL": 5.8, "CLP": 993.46 },
    "providerUpdatedAt": "2026-11-19T00:02:31.000Z",
    "fetchedAt": "2026-11-19T16:33:27.946Z"
  },
  "createdAt": "2026-11-19T16:33:27.946Z"
}
```

**`GET /documents/:documentNumber/audit-events?from=&to=&limit=&cursor=`**: historial de un documento, el más reciente primero. `from` y `to` son ISO 8601 inclusivos, `limit` va de 1 a 100 (20 por defecto) y `cursor` es el `nextCursor` de la página anterior.

```bash
curl -s 'http://localhost:3000/documents/1020304050/audit-events?from=2026-11-01T00:00:00Z&limit=2'
```

Para ver la tabla directamente:

```bash
docker run --rm --network auco-validations-service_default \
  -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local \
  amazon/aws-cli dynamodb query \
  --endpoint-url http://dynamodb:8000 --region us-east-1 \
  --table-name validation_audit_events \
  --key-condition-expression "documentNumber = :d" \
  --expression-attribute-values '{":d":{"S":"1020304050"}}'
```

## Configuración

Todo está en `.env.example`. Las variables se validan con Joi al arrancar: si falta una o viene mal, la app no levanta. Las que más importan:

| Variable | Default | |
|---|---|---|
| `MONGO_URI` | (obligatoria) | |
| `DYNAMO_ENDPOINT` | | vacío = AWS real |
| `ENRICHMENT_TIMEOUT_MS` | `3000` | timeout por intento |
| `ENRICHMENT_MAX_RETRIES` | `2` | solo para fallos transitorios |
| `ENRICHMENT_CACHE_TTL_MS` | `600000` | cuánto se reutiliza la tasa |
| `ENRICHMENT_CACHE_MAX_STALE_MS` | `86400000` | cuánto se acepta una tasa vieja si el proveedor cae |

## Estructura

Usé arquitectura hexagonal. El dominio y los casos de uso solo conocen los puertos (`ValidationRepositoryPort`, `AuditPort`, `EnrichmentPort`), y `validations.module.ts` decide qué adaptador implementa cada uno. Eso fue lo que me permitió probar los casos de uso sin Mongo ni Dynamo, y meter la caché después sin tocar el caso de uso.

```
src/validations/
  domain/          entidad, errores y puertos
  application/     casos de uso (crear, consultar, historial)
  infrastructure/  http, mongo, dynamo, proveedor de tasas (+ caché)
src/common/        config, filtro de errores, reintentos, health
test/              unit, e2e, integration
scripts/           prueba de fuego y de estrés
```

## Decisiones

**Por qué la tasa de cambio.** Es gratis, no pide API key y tiene sentido para una auditoría: se guarda el contexto que había en el momento de validar (base, tasas, fecha del proveedor y fecha de consulta), no algo que se consulte después. Solo guardo las monedas configuradas, no las ~160.

**Si el proveedor falla.** Hay timeout por intento y reintentos con backoff exponencial y jitter, pero solo ante fallos transitorios (red, timeout, 5xx, 429). Un 404 o una respuesta con forma rara no se reintentan, porque insistir no lo arregla. Si después de eso sigue fallando, la validación se guarda igual con `enrichmentStatus: "failed"`. La tasa es contexto, no un requisito para validar, y preferí no perder la validación por culpa de un tercero.

**Caché de la tasa.** El proveedor publica una vez al día, así que llamarlo en cada POST solo suma latencia y nos expone a un 429 en cuanto haya volumen. La tasa se reutiliza 10 minutos, si llegan muchas peticiones a la vez sale una sola consulta y, si el proveedor se cae, se usa la última buena con su `fetchedAt` real. Lo implementé como un decorador del puerto.

**El id lo genero yo (UUID).** Así es el mismo en Mongo y en el evento de auditoría, el dominio no depende de `ObjectId` y el GET rechaza ids mal formados antes de ir a la base.

**Llaves de DynamoDB.**
- PK `documentNumber`: la pregunta típica de una auditoría es "¿qué pasó con este documento?", y así se responde con un `Query` sobre una sola partición, sin `Scan`.
- SK `eventAt` = `2026-11-19T15:04:05.123Z#<validationId>`: el ISO en UTC se ordena igual alfabética que cronológicamente, entonces los rangos de fechas salen con `BETWEEN` o `begins_with` sobre la misma llave. El `#id` del final es para que dos validaciones del mismo documento en el mismo milisegundo no se pisen.
- La escritura es condicional (`attribute_not_exists`): un evento nunca se sobrescribe.

**Si Mongo guarda y Dynamo falla.** Responder 500 ahí haría que el cliente reintente y duplique la validación. Respondo 201 y dejo el evento completo en el log (`AUDIT_WRITE_FAILED`) para reprocesarlo. No es lo ideal (ver mejoras), pero es el trade-off que elegí para este alcance. Si es Mongo el que falla, no se audita nada y la respuesta es 503.

**Lo que no hice a propósito.** Colas, microservicios o CQRS. Son dos endpoints; con hexagonal alcanza para que sea fácil de probar y de cambiar.

## Pruebas

```bash
npm test                  # unitarias
npm run test:e2e          # API por HTTP con adaptadores en memoria
npm run test:integration  # contra Mongo y DynamoDB reales con Testcontainers (requiere Docker)
```

Las unitarias y las e2e corren en segundos sin Docker. Las de integración levantan contenedores temporales y prueban lo que un mock no puede: orden por sort key, rangos inclusivos, paginación sin repetir eventos, escritura condicional y `_id` UUID en Mongo. La CI corre las tres capas más el build de la imagen.

Un detalle que me costó: el driver 7 de MongoDB carga `os` con un `import()` dinámico y Jest no lo soporta por defecto. La metadata del handshake sale vacía y el servidor responde *"Missing required sub-document 'driver'"*. Por eso el script de integración corre con `--experimental-vm-modules`.

## Prueba de fuego y estrés

Aparte de los tests, hay dos scripts que atacan el servicio corriendo:

```bash
docker compose up -d --build
npm run test:fire     # contrato, carga y consistencia Mongo/Dynamo
npm run test:chaos    # lo anterior + tumbar Dynamo, Mongo y el proveedor en caliente
```

La prueba de fuego tiene 37 verificaciones y todas pasan. De ahí salieron dos bugs que corregí: un cuerpo de 2 MB devolvía 500 en vez de 413, y con Mongo caído se respondía 500 en vez de 503. En el caos, con Dynamo reiniciándose no se perdió ninguna validación, pero unos 26 de 40 eventos quedaron solo en el log. Ese es el argumento concreto para el outbox.

Para el estrés uso `docker-compose.stress.yml`: la app limitada a 1 CPU y 512 MB, como un pod, y un proveedor falso para no pegarle miles de veces a una API gratuita. El cliente corre dentro de la red de Docker:

```bash
docker compose -f docker-compose.yml -f docker-compose.stress.yml up -d --build --wait
docker run --rm --network auco-validations-service_default -v "$PWD/scripts:/s:ro" \
  -e BASE_URL=http://app:3000 auco-validations-service-app node /s/stress-test.mjs
```

Resultados con 1 CPU (30 % POST / 70 % GET):

| Usuarios simultáneos | req/s | POST p95 | GET p95 | Errores |
|---|---|---|---|---|
| 10 | ~230 | 149 ms | 96 ms | 0 |
| 50 | ~300 | 397 ms | 276 ms | 0 |
| 100 | ~300 | 726 ms | 507 ms | 0 |
| 400 | ~340 | 2,3 s | 1,3 s | 0,8 % (timeouts de 10 s) |
| 100 durante 2 min | ~350 | 597 ms | 423 ms | 0 |

Lo que saqué de esto:
- Aguanta: cero caídas, cero reinicios y la memoria estable en unos 100 MB de 512, sin fugas.
- El límite es la CPU. Cada petición cuesta unos 3 ms (Nest, firma del SDK de AWS, Mongoose y los logs), así que una instancia de 1 CPU da para unas 300 req/s. Pasado ese punto las peticiones hacen cola en vez de fallar. Como el servicio no guarda estado, se escala agregando réplicas.
- Con el límite justo de 1 CPU, el contenedor estuvo frenado por el kernel en casi el 90 % de los periodos: Node usa hilos de fondo (GC, libuv) que gastan la cuota a ráfagas. Con 2 CPU de límite, el frenado bajó al 8 % y el rendimiento subió entre 40 y 60 %. En Kubernetes le daría un `limit` por encima del `request`.
- Mi primera medición desde el host daba un p99 de ~1 s. Era el `docker-proxy` del puerto publicado, no la app: dentro de la app la petición más lenta era de 175 ms. Por eso el cliente de estrés corre dentro de la red.

## ¿Está listo para producción?

El diseño sí: es resiliente a la caída de cualquiera de sus dependencias, se recupera solo, responde con los códigos correctos, no tiene fugas y escala horizontal. Para salir de verdad le faltaría:

- **Outbox** para la auditoría: guardar el evento pendiente en la misma escritura de Mongo y que un proceso lo publique a Dynamo con reintentos. Es lo más importante, como mostró la prueba de caos.
- **Idempotencia** en el POST (`Idempotency-Key`).
- Mongo como **replica set** (acá es un nodo suelto) y DynamoDB real con Terraform (TTL, PITR). DynamoDB Local no sirve para medir rendimiento.
- **Autenticación**, rate limiting y enmascarar o cifrar el número de documento.
- **Timeouts del lado del servidor** para descartar carga cuando se satura, en vez de dejar crecer la cola.
- Trazas (OpenTelemetry), métricas (Prometheus) y despliegue continuo desde la CI.
- Reprocesar las validaciones que quedaron con `enrichmentStatus=failed`.
