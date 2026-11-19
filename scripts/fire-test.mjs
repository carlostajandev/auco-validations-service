#!/usr/bin/env node
/**
 * Prueba de fuego contra el servicio corriendo (docker compose up).
 *
 *   node scripts/fire-test.mjs            contrato + carga + consistencia
 *   node scripts/fire-test.mjs --chaos    además: caída de DynamoDB, MongoDB y API externa
 *
 * Variables: BASE_URL (default http://localhost:3000), LOAD_POSTS, LOAD_GETS, CONCURRENCY.
 * Sale con código 1 si alguna verificación falla.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const LOAD_POSTS = Number(process.env.LOAD_POSTS ?? 100);
const LOAD_GETS = Number(process.env.LOAD_GETS ?? 1000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const CHAOS = process.argv.includes('--chaos');
const RUN = Date.now().toString(36).toUpperCase(); // prefijo único por corrida

// ---------------------------------------------------------------- utilidades
const results = [];
const c = { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m' };

function check(name, passed, detail = '') {
  results.push({ name, passed });
  const mark = passed ? `${c.ok}✔${c.r}` : `${c.bad}✘${c.r}`;
  console.log(`  ${mark} ${name}${detail ? ` ${c.dim}${detail}${c.r}` : ''}`);
}

function section(title) {
  console.log(`\n${c.b}▶ ${title}${c.r}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, body, timeoutMs = 30_000) {
  const started = performance.now();
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* respuesta no JSON */
    }
    return { status: res.status, body: json, headers: res.headers, ms: performance.now() - started };
  } catch (error) {
    return { status: 0, body: null, error: error.message, ms: performance.now() - started };
  }
}

/** Ejecuta tareas con un máximo de N en paralelo (como usuarios simultáneos). */
async function pool(tasks, concurrency) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function latencyReport(responses) {
  const ms = responses.map((r) => r.ms);
  const codes = responses.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return {
    p50: percentile(ms, 50).toFixed(0),
    p95: percentile(ms, 95).toFixed(0),
    p99: percentile(ms, 99).toFixed(0),
    max: Math.max(...ms).toFixed(0),
    codes,
  };
}

const docker = (cmd) => execSync(`docker ${cmd}`, { stdio: 'pipe' }).toString();
const compose = (cmd, env = {}) =>
  execSync(`docker compose ${cmd}`, { stdio: 'pipe', env: { ...process.env, ...env } }).toString();

async function waitFor(predicate, timeoutMs = 60_000, stepMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return Date.now() - started;
    await sleep(stepMs);
  }
  return -1;
}

const healthy = async () => (await http('GET', '/health', undefined, 2000)).status === 200;
const newDoc = (suffix) => `FT${RUN}${suffix}`.slice(0, 20);
const person = { name: 'Prueba De Fuego' };

// ---------------------------------------------------------------- 1. contrato
async function contract() {
  section('1. Contrato de la API');

  const health = await http('GET', '/health');
  check('GET /health responde 200', health.status === 200, JSON.stringify(health.body));

  const docs = await http('GET', '/docs-json');
  const paths = Object.keys(docs.body?.paths ?? {});
  check('Swagger publica los 4 endpoints', paths.length >= 4, paths.join(' '));

  const doc = newDoc('C1');
  const created = await http('POST', '/validations', { ...person, documentNumber: doc });
  check('POST válido → 201 con { id }', created.status === 201 && typeof created.body?.id === 'string');
  check('Responde x-request-id para trazabilidad', !!created.headers?.get('x-request-id'));

  const ownId = 'trace-' + randomUUID();
  const traced = await fetch(BASE_URL + '/health', { headers: { 'x-request-id': ownId } });
  check('Respeta el x-request-id que envía el cliente', traced.headers.get('x-request-id') === ownId);

  const got = await http('GET', `/validations/${created.body?.id}`);
  check(
    'GET devuelve el registro completo',
    got.status === 200 &&
      got.body?.documentNumber === doc &&
      ['completed', 'failed'].includes(got.body?.enrichmentStatus),
    `enrichmentStatus=${got.body?.enrichmentStatus}`,
  );

  const cases = [
    ['payload vacío', {}],
    ['nombre con números', { name: 'R2D2', documentNumber: '1020304050' }],
    ['documento corto', { name: 'Ana', documentNumber: '12' }],
    ['campo extra (mass assignment)', { name: 'Ana', documentNumber: '1020304050', isAdmin: true }],
    ['inyección NoSQL en documento', { name: 'Ana', documentNumber: { $gt: '' } }],
    ['inyección NoSQL en nombre', { name: { $ne: null }, documentNumber: '1020304050' }],
    ['script en el nombre', { name: '<script>alert(1)</script>', documentNumber: '1020304050' }],
    ['nombre de 5.000 caracteres', { name: 'a'.repeat(5000), documentNumber: '1020304050' }],
  ];
  for (const [label, payload] of cases) {
    const r = await http('POST', '/validations', payload);
    check(`POST con ${label} → 400`, r.status === 400, `(${r.status})`);
  }

  const malformed = await http('POST', '/validations', '{"name": "Ana",');
  check('POST con JSON roto → 400 (no 500)', malformed.status === 400, `(${malformed.status})`);

  const huge = await http('POST', '/validations', { name: 'Ana', documentNumber: '1020304050', pad: 'x'.repeat(2_000_000) });
  check('POST de 2 MB → rechazado sin caerse (413)', huge.status === 413, `(${huge.status})`);

  const err = await http('GET', '/validations/3f2b6c1e-8a4d-4f7e-9b2a-1c5d8e9f0a1b');
  check(
    'GET inexistente → 404 con formato de error estándar',
    err.status === 404 && ['statusCode', 'error', 'message', 'path', 'timestamp'].every((k) => k in (err.body ?? {})),
  );
  check('GET con id no UUID → 400', (await http('GET', '/validations/abc')).status === 400);
  check('Ruta inexistente → 404', (await http('GET', '/no-existe')).status === 404);

  const badRange = await http('GET', `/documents/${doc}/audit-events?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z`);
  check('Historial con rango invertido → 400', badRange.status === 400);
  const badCursor = await http('GET', `/documents/${doc}/audit-events?cursor=no-es-un-cursor`);
  check('Historial con cursor falso → 400', badCursor.status === 400);
}

// ---------------------------------------------------------------- 2. carga
async function load() {
  section(`2. Carga: ${LOAD_POSTS} POST y ${LOAD_GETS} GET con ${CONCURRENCY} usuarios simultáneos`);

  const docs = Array.from({ length: 10 }, (_, i) => newDoc(`L${i}`));
  const startedPosts = performance.now();
  const posts = await pool(
    Array.from({ length: LOAD_POSTS }, (_, i) => () =>
      http('POST', '/validations', { ...person, documentNumber: docs[i % docs.length] }),
    ),
    CONCURRENCY,
  );
  const postSecs = (performance.now() - startedPosts) / 1000;
  const pr = latencyReport(posts);
  const post5xx = posts.filter((r) => r.status === 0 || r.status >= 500).length;
  console.log(`    POST  p50=${pr.p50}ms p95=${pr.p95}ms p99=${pr.p99}ms max=${pr.max}ms  ${(LOAD_POSTS / postSecs).toFixed(1)} req/s  códigos=${JSON.stringify(pr.codes)}`);
  check('POST bajo carga: 0 errores 5xx o caídas', post5xx === 0, `(${post5xx})`);

  const created = posts.filter((r) => r.status === 201).map((r) => r.body.id);
  const ids = created.length ? created : ['3f2b6c1e-8a4d-4f7e-9b2a-1c5d8e9f0a1b'];

  // Enriquecimiento: ¿cuántas quedaron con la tasa y cuántas en fallback?
  const sample = await pool(ids.map((id) => () => http('GET', `/validations/${id}`)), CONCURRENCY);
  const failedEnrichment = sample.filter((r) => r.body?.enrichmentStatus === 'failed').length;
  console.log(`    Enriquecimiento: ${ids.length - failedEnrichment} completed / ${failedEnrichment} failed (fallback)`);

  const startedGets = performance.now();
  const gets = await pool(
    Array.from({ length: LOAD_GETS }, (_, i) => () => http('GET', `/validations/${ids[i % ids.length]}`)),
    CONCURRENCY * 2,
  );
  const getSecs = (performance.now() - startedGets) / 1000;
  const gr = latencyReport(gets);
  console.log(`    GET   p50=${gr.p50}ms p95=${gr.p95}ms p99=${gr.p99}ms max=${gr.max}ms  ${(LOAD_GETS / getSecs).toFixed(1)} req/s  códigos=${JSON.stringify(gr.codes)}`);
  check('GET bajo carga: 100 % responde 200', gets.every((r) => r.status === 200));
  check('GET bajo carga: p95 < 200 ms', Number(gr.p95) < 200, `(p95=${gr.p95}ms)`);

  return { created, docs, posts };
}

// ---------------------------------------------------------------- 3. consistencia
async function consistency({ created, docs, posts }) {
  section('3. Consistencia de datos (Mongo ↔ DynamoDB)');

  const reads = await pool(created.map((id) => () => http('GET', `/validations/${id}`)), CONCURRENCY);
  check(`Las ${created.length} validaciones creadas se pueden leer`, reads.every((r) => r.status === 200));
  check('Todos los ids son únicos', new Set(created).size === created.length);

  // Cada documento debe tener en auditoría exactamente las validaciones creadas para él.
  const expectedPerDoc = {};
  posts.forEach((r, i) => {
    if (r.status === 201) {
      const d = docs[i % docs.length];
      (expectedPerDoc[d] ??= new Set()).add(r.body.id);
    }
  });
  let missing = 0;
  for (const [doc, expected] of Object.entries(expectedPerDoc)) {
    const seen = new Set();
    let cursor;
    do {
      const page = await http('GET', `/documents/${doc}/audit-events?limit=7${cursor ? `&cursor=${cursor}` : ''}`);
      page.body.items.forEach((e) => seen.add(e.validationId));
      cursor = page.body.nextCursor;
    } while (cursor);
    missing += [...expected].filter((id) => !seen.has(id)).length;
  }
  check('Cada validación tiene su evento de auditoría (recorriendo todas las páginas)', missing === 0, `(faltan ${missing})`);

  // Ráfaga: 25 POST simultáneos del MISMO documento -> ninguno se pisa en DynamoDB.
  const burstDoc = newDoc('B1');
  const burst = await Promise.all(
    Array.from({ length: 25 }, () => http('POST', '/validations', { ...person, documentNumber: burstDoc })),
  );
  const burstIds = burst.filter((r) => r.status === 201).map((r) => r.body.id);
  const history = await http('GET', `/documents/${burstDoc}/audit-events?limit=100`);
  const historyIds = new Set(history.body.items.map((e) => e.validationId));
  check(
    '25 POST simultáneos del mismo documento → 25 eventos, ninguno sobrescrito',
    burstIds.length === 25 && burstIds.every((id) => historyIds.has(id)),
    `(${burstIds.length} creados, ${historyIds.size} en auditoría)`,
  );

  const times = history.body.items.map((e) => e.occurredAt);
  check('Historial ordenado del más reciente al más antiguo', times.every((t, i) => i === 0 || times[i - 1] >= t));
}

// ---------------------------------------------------------------- 4. caos
async function chaos() {
  section('4. Caos: caída de dependencias con el servicio en marcha');

  // 4a. DynamoDB se reinicia en medio de una ráfaga.
  const since = new Date().toISOString();
  const doc = newDoc('X1');
  const burst = Promise.all(
    Array.from({ length: 40 }, async (_, i) => {
      await sleep(i * 100);
      return http('POST', '/validations', { ...person, documentNumber: doc });
    }),
  );
  await sleep(500);
  docker('restart auco-dynamodb');
  const responses = await burst;
  const fivexx = responses.filter((r) => r.status === 0 || r.status >= 500).length;
  check('DynamoDB reiniciándose: ningún POST falla (la validación no se pierde)', fivexx === 0, `(${fivexx} con 5xx)`);
  const auditFailures = (docker(`logs auco-app --since ${since}`).match(/AUDIT_WRITE_FAILED/g) ?? []).length;
  console.log(`    Eventos que no llegaron a DynamoDB y quedaron en el log para reprocesar: ${auditFailures}`);
  await waitFor(async () => docker('inspect -f {{.State.Health.Status}} auco-dynamodb').trim() === 'healthy');
  const after = await http('POST', '/validations', { ...person, documentNumber: newDoc('X2') });
  const afterHist = await http('GET', `/documents/${newDoc('X2')}/audit-events`);
  check('Tras recuperarse DynamoDB, la auditoría vuelve a escribirse sola', after.status === 201 && afterHist.body?.items?.length === 1);

  // 4b. MongoDB se cae.
  docker('stop auco-mongo');
  const downStart = Date.now();
  const whileDown = await http('POST', '/validations', { ...person, documentNumber: newDoc('M1') }, 30_000);
  const healthDown = await http('GET', '/health', undefined, 5000);
  check(
    'Mongo caído: el POST responde 503 (temporal, reintentable) sin colgarse',
    whileDown.status === 503 && whileDown.body?.statusCode === 503 && whileDown.ms < 10_000,
    `(${whileDown.status} en ${(whileDown.ms / 1000).toFixed(1)} s)`,
  );
  check('Mongo caído: /health responde 503 (el balanceador dejaría de enviar tráfico)', healthDown.status === 503, `(${healthDown.status})`);
  check('Mongo caído: la respuesta de error no filtra detalles internos', !JSON.stringify(whileDown.body ?? {}).match(/mongo|ECONNREFUSED|stack/i));
  docker('start auco-mongo');
  const recovery = await waitFor(healthy, 90_000);
  const afterMongo = await http('POST', '/validations', { ...person, documentNumber: newDoc('M2') });
  check(
    'Mongo vuelve: el servicio se recupera solo, sin reiniciar la app',
    recovery >= 0 && afterMongo.status === 201,
    `(recuperado ${((Date.now() - downStart) / 1000).toFixed(1)} s después de la caída)`,
  );

  // 4c. La API externa no existe / no responde.
  compose('up -d --wait app', { ENRICHMENT_BASE_URL: 'http://10.255.255.1/v6', ENRICHMENT_TIMEOUT_MS: '1000', ENRICHMENT_MAX_RETRIES: '2' });
  await waitFor(healthy);
  const noProvider = await http('POST', '/validations', { ...person, documentNumber: newDoc('E1') });
  const stored = await http('GET', `/validations/${noProvider.body?.id}`);
  check(
    'API externa colgada: responde 201 y guarda enrichmentStatus=failed',
    noProvider.status === 201 && stored.body?.enrichmentStatus === 'failed',
    `(${(noProvider.ms / 1000).toFixed(1)} s: 3 intentos con timeout de 1 s + backoff)`,
  );
  check('API externa colgada: el tiempo de respuesta queda acotado (< 5 s)', noProvider.ms < 5000);
  compose('up -d --wait app');
  await waitFor(healthy);
}

// ---------------------------------------------------------------- main
console.log(`${c.b}Prueba de fuego${c.r} contra ${BASE_URL}  ${c.dim}(corrida ${RUN}${CHAOS ? ', con caos' : ''})${c.r}`);
if (!(await healthy())) {
  console.error(`${c.bad}El servicio no responde en ${BASE_URL}. Levántalo con: docker compose up -d --build${c.r}`);
  process.exit(1);
}

await contract();
const loadResult = await load();
await consistency(loadResult);
if (CHAOS) await chaos();

const failed = results.filter((r) => !r.passed);
console.log(
  `\n${c.b}Resultado:${c.r} ${results.length - failed.length}/${results.length} verificaciones OK` +
    (failed.length ? `\n${c.bad}Fallaron:${c.r}\n${failed.map((f) => `  - ${f.name}`).join('\n')}` : ` ${c.ok}✔${c.r}`),
);
process.exit(failed.length ? 1 : 0);
