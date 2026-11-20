// Imita a open.er-api.com para las pruebas de estrés: no abusamos de una API
// gratuita y medimos nuestro servicio, no la red ni al proveedor.
import { createServer } from 'node:http';

const LATENCY_MS = Number(process.env.FAKE_LATENCY_MS ?? 80);
const body = JSON.stringify({
  result: 'success',
  base_code: 'USD',
  time_last_update_utc: new Date().toUTCString(),
  rates: { USD: 1, COP: 3308.13, EUR: 0.91, MXN: 18.72, BRL: 5.8, CLP: 993.4 },
});

let served = 0;
createServer((req, res) => {
  served++;
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  }, LATENCY_MS);
}).listen(Number(process.env.FAKE_PORT ?? 8080), () => console.log(`fake rates on :${process.env.FAKE_PORT ?? 8080} (latency ${LATENCY_MS}ms)`));

setInterval(() => console.log(`served=${served}`), 10_000).unref();
