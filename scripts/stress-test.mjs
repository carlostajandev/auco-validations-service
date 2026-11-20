#!/usr/bin/env node
// Prueba de estrés por escalones contra el entorno de docker-compose.stress.yml.
//
//   node scripts/stress-test.mjs
//
// Variables: BASE_URL, STAGES (usuarios por escalón, ej. "10,50,100"), STAGE_SECONDS,
// SOAK_USERS, SOAK_SECONDS, WRITE_RATIO (fracción de POST, default 0.3).
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const STAGES = (process.env.STAGES ?? '10,50,100,200,400').split(',').map(Number);
const STAGE_SECONDS = Number(process.env.STAGE_SECONDS ?? 20);
const SOAK_USERS = Number(process.env.SOAK_USERS ?? 100);
const SOAK_SECONDS = Number(process.env.SOAK_SECONDS ?? 120);
const WRITE_RATIO = Number(process.env.WRITE_RATIO ?? 0.3);
const CONTAINER = process.env.APP_CONTAINER ?? 'auco-app';

// Objetivos tipo SLO para decidir si un escalón "aguanta".
const SLO = { errorRate: 0.01, postP95: 500, getP95: 200 };

const RUN = Date.now().toString(36).toUpperCase();
const knownIds = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const started = performance.now();
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, ms: performance.now() - started };
  } catch {
    return { status: 0, json: null, ms: performance.now() - started };
  }
}

function pct(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

function containerStats() {
  try {
    const out = execSync(
      `docker stats ${CONTAINER} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}"`,
      { stdio: 'pipe' },
    ).toString().trim();
    const [cpu, mem] = out.split('|');
    return { cpu, mem: mem.split(' / ')[0] };
  } catch {
    return { cpu: '?', mem: '?' };
  }
}

/** Usuarios virtuales en bucle cerrado: cada uno hace una petición tras otra. */
async function stage(users, seconds) {
  const deadline = Date.now() + seconds * 1000;
  const post = [];
  const get = [];
  let errors = 0;
  let timeouts = 0;
  const statusCount = {};
  let peakCpu = 0;
  let lastStats = containerStats();

  const sampler = setInterval(() => {
    lastStats = containerStats();
    peakCpu = Math.max(peakCpu, parseFloat(lastStats.cpu) || 0);
  }, 3000);

  const user = async (u) => {
    let i = 0;
    while (Date.now() < deadline) {
      const write = knownIds.length < 20 || Math.random() < WRITE_RATIO;
      const r = write
        ? await call('POST', '/validations', {
            name: 'Usuario De Carga',
            documentNumber: `ST${RUN}${u % 50}`.slice(0, 20),
          })
        : await call('GET', `/validations/${knownIds[(u * 31 + i) % knownIds.length]}`);
      i++;
      statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
      const ok = write ? r.status === 201 : r.status === 200;
      if (!ok) errors++;
      if (r.status === 0) timeouts++;
      if (write && r.status === 201 && knownIds.length < 5000) knownIds.push(r.json.id);
      (write ? post : get).push(r.ms);
    }
  };

  const started = performance.now();
  await Promise.all(Array.from({ length: users }, (_, u) => user(u)));
  clearInterval(sampler);
  const secs = (performance.now() - started) / 1000;
  const total = post.length + get.length;

  return {
    users,
    total,
    rps: total / secs,
    errorRate: total ? errors / total : 1,
    timeouts,
    statusCount,
    postP50: pct(post, 50),
    postP95: pct(post, 95),
    postP99: pct(post, 99),
    getP50: pct(get, 50),
    getP95: pct(get, 95),
    getP99: pct(get, 99),
    peakCpu,
    mem: lastStats.mem,
  };
}

const meetsSlo = (s) =>
  s.errorRate <= SLO.errorRate && s.postP95 <= SLO.postP95 && s.getP95 <= SLO.getP95;

function printStage(label, s) {
  const ok = meetsSlo(s) ? '✔' : '✘';
  console.log(
    `${ok} ${label.padEnd(14)} ${String(Math.round(s.rps)).padStart(5)} req/s | ` +
      `POST p50/p95/p99 ${s.postP50.toFixed(0)}/${s.postP95.toFixed(0)}/${s.postP99.toFixed(0)} ms | ` +
      `GET ${s.getP50.toFixed(0)}/${s.getP95.toFixed(0)}/${s.getP99.toFixed(0)} ms | ` +
      `errores ${(s.errorRate * 100).toFixed(2)}% (timeouts ${s.timeouts}) | ` +
      `CPU pico ${s.peakCpu.toFixed(0)}% | mem ${s.mem}`,
  );
  if (s.errorRate > 0) console.log(`    códigos: ${JSON.stringify(s.statusCount)}`);
}

// ------------------------------------------------------------------ main
const health = await call('GET', '/health');
if (health.status !== 200) {
  console.error(`El servicio no responde en ${BASE_URL}`);
  process.exit(1);
}

console.log(`Estrés contra ${BASE_URL} — ${(WRITE_RATIO * 100).toFixed(0)}% POST / ${(100 - WRITE_RATIO * 100).toFixed(0)}% GET`);
console.log(`SLO: errores ≤ ${SLO.errorRate * 100}%, POST p95 ≤ ${SLO.postP95} ms, GET p95 ≤ ${SLO.getP95} ms`);
console.log(`Memoria en reposo: ${containerStats().mem}\n`);

console.log('Escalones de carga');
const results = [];
for (const users of STAGES) {
  const s = await stage(users, STAGE_SECONDS);
  results.push(s);
  printStage(`${users} usuarios`, s);
  await sleep(3000);
}

console.log(`\nResistencia: ${SOAK_USERS} usuarios durante ${SOAK_SECONDS} s`);
const memBefore = containerStats().mem;
const soak = await stage(SOAK_USERS, SOAK_SECONDS);
printStage('resistencia', soak);
await sleep(5000);
const memAfter = containerStats().mem;
console.log(`    memoria antes ${memBefore} → después ${memAfter} (tras 5 s de reposo)`);

const healthAfter = await call('GET', '/health');
const lastOk = [...results].reverse().find(meetsSlo);
console.log('\nConclusión');
console.log(`  Capacidad dentro del SLO (1 CPU, 512 MB): ${lastOk ? `~${Math.round(lastOk.rps)} req/s con ${lastOk.users} usuarios` : 'ningún escalón cumplió'}`);
console.log(`  Servicio sano al terminar: ${healthAfter.status === 200 ? 'sí' : 'NO'}`);
console.log(`  Validaciones creadas en la corrida: ${knownIds.length}${knownIds.length >= 5000 ? '+' : ''}`);
process.exit(healthAfter.status === 200 && soak.errorRate <= SLO.errorRate ? 0 : 1);
