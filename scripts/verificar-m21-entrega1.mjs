// Verificación repetible de la entrega 1 de M21 (límite y validación en routes/content.js).
// Uso: node scripts/verificar-m21-entrega1.mjs
// Reproduce la pila de producción de index.js (auth, data y content bajo el mismo prefijo, con el
// errorHandler al final) con S3 y SMTP sustituidos por espías: no hay red ni credenciales reales.
// Criterio 1: sin token las rutas siguen dando 401 (no se abre ninguna).
// Criterio 2: POST /send-email tiene límite de 5 peticiones por IP (429).
// Criterio 3: POST /send-email valida formato y longitud (400) sin enviar correo.
// Criterios 4 y 5: GET /get-image y DELETE /delete-image validan imageKey (400) sin llamar a S3.
// Sale con código 0 si todo pasa y 1 si algún caso falla.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Entorno ficticio, antes de cargar ningún módulo del proyecto.
const TEST_SECRET = 'solo-para-pruebas-no-es-un-secreto';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = TEST_SECRET;
process.env.JWT_EXPIRATION = '1h';
process.env.ADMIN_USERNAME = 'admin-de-prueba';
process.env.ADMIN_PASSWORD = 'no-es-un-hash-real';
process.env.EMAIL = 'correo-de-prueba@example.com';
process.env.EMAIL_PASSWORD = 'solo-para-pruebas-no-es-un-secreto';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_BUCKET_NAME = 'bucket-de-prueba';
process.env.ALLOWED_ORIGIN = 'http://localhost';

// ─── Espías de S3 y SMTP ─────────────────────────────────────────────────────

const calls = { sendMail: 0, getPresigned: 0, deleteImage: 0, s3Other: 0 };

const injectInCache = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
};

const other = (value) => async () => { calls.s3Other += 1; return value; };
injectInCache(join(ROOT, 'aws', 'awsS3connect.js'), {
  getPresignedUrlsFromS3Folder: other([]),
  getPresignedUrlFromS3: async () => { calls.getPresigned += 1; return 'https://s3.example.invalid/url-prefirmada'; },
  uploadImageToS3: other(undefined),
  deleteImageFromS3: async () => { calls.deleteImage += 1; return { success: true }; },
  getTextJsonS3: other([]),
  uploadTextToJsonS3: other(undefined),
  deleteTermFromS3: other({ success: true }),
  uploadFileToS3: other(undefined),
  getFileFromS3: other({}),
  getMergedDataInS3Folder: other({}),
  deleteFileFromS3: other({ success: true }),
  updateFileS3: other(undefined),
  listFilesInS3Folder: other([]),
});
injectInCache('nodemailer', {
  createTransport: () => ({ sendMail: async () => { calls.sendMail += 1; return { accepted: [] }; } }),
});

const express = require('express');
const jwt = require('jsonwebtoken');
const errorHandler = require('../middleware/errorHandler');

const PREFIX = '/api/v1';
const contentPath = require.resolve('../routes/content.js');

// Monta la pila como index.js. Recargar solo routes/content.js reinicia el limitador (MemoryStore nuevo).
const servers = [];
const startApp = async () => {
  delete require.cache[contentPath];
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(PREFIX, require('../routes/auth'));
  app.use(PREFIX, require('../routes/data'));
  app.use(PREFIX, require('../routes/content.js'));
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}${PREFIX}`;
};

const validToken = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });
const expiredToken = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: -10 });
const invalidToken = jwt.sign({ userId: 1 }, 'otra-clave-distinta-de-prueba', { expiresIn: '1h' });

let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };

const call = async (base, method, path, { token, body, ip } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};

// ─── Registro de resultados por criterio ─────────────────────────────────────

const criteria = {};
const record = (criterio, nombre, ok, detalle = '') => {
  criteria[criterio] ??= { total: 0, fallos: [] };
  criteria[criterio].total += 1;
  if (!ok) criteria[criterio].fallos.push(`${nombre}${detalle ? ` -> ${detalle}` : ''}`);
};
const isEnvelopeError = (r) => r.json && r.json.success === false && typeof r.json.error === 'string';

// ─── Criterio 1: sin token siguen los 401 ────────────────────────────────────

const criterio1 = async (base) => {
  const publicasBloqueadas = [
    ['POST', '/send-email'], ['GET', '/get-image?imageKey=foto.jpg'], ['GET', '/list-images'], ['GET', '/list-terms'],
  ];
  const protegidas = [
    ['GET', '/auth'], ['POST', '/upload'], ['POST', '/upload/confirm'], ['POST', '/update-file'], ['POST', '/delete-file'],
    ['POST', '/upload-image'], ['DELETE', '/delete-image'], ['POST', '/upload-term'], ['DELETE', '/delete-term'],
  ];
  for (const [method, path] of [...publicasBloqueadas, ...protegidas]) {
    const r = await call(base, method, path, { body: method === 'GET' ? undefined : {} });
    record(1, `sin token ${method} ${path}`, r.status === 401 && r.json?.error === 'No token provided', `${r.status} ${r.json?.error}`);
  }
  for (const [method, path] of [['POST', '/send-email'], ['GET', '/list-terms'], ['DELETE', '/delete-image']]) {
    const body = method === 'GET' ? undefined : {};
    const inv = await call(base, method, path, { token: invalidToken, body });
    record(1, `token inválido ${method} ${path}`, inv.status === 401 && inv.json?.error === 'Invalid token', `${inv.status} ${inv.json?.error}`);
    const cad = await call(base, method, path, { token: expiredToken, body });
    record(1, `token caducado ${method} ${path}`, cad.status === 401 && cad.json?.error === 'Token expired', `${cad.status} ${cad.json?.error}`);
  }
  const lista = await call(base, 'GET', '/list-files');
  record(1, 'GET /list-files sigue pública', lista.status === 200, String(lista.status));
  const log = await call(base, 'POST', '/log', { body: {} });
  record(1, 'POST /log sigue llegando a su manejador', log.status === 400 && isEnvelopeError(log), String(log.status));
};

// ─── Criterio 2: límite de 5 peticiones por IP ───────────────────────────────

const validMail = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };

const criterio2 = async () => {
  const base = await startApp();
  const ipA = nextIp();
  const ipB = nextIp();
  const antes = calls.sendMail;
  const statuses = [];
  for (let i = 1; i <= 5; i += 1) {
    const r = await call(base, 'POST', '/send-email', { token: validToken, body: validMail, ip: ipA });
    statuses.push(r.status);
    if (i === 3) {
      const sinToken = await call(base, 'POST', '/send-email', { body: validMail, ip: ipA });
      record(2, 'sin token entre medias da 401', sinToken.status === 401, String(sinToken.status));
    }
  }
  record(2, 'cinco peticiones válidas dan 200', statuses.every((s) => s === 200), statuses.join(','));
  record(2, 'sendMail cuenta 5', calls.sendMail - antes === 5, String(calls.sendMail - antes));
  const sexto = await call(base, 'POST', '/send-email', { token: validToken, body: validMail, ip: ipA });
  record(2, 'la sexta da 429 con envoltorio', sexto.status === 429 && isEnvelopeError(sexto), `${sexto.status} ${JSON.stringify(sexto.json)}`);
  record(2, 'la sexta no envía correo', calls.sendMail - antes === 5, `sendMail=${calls.sendMail - antes}`);
  const otraIp = await call(base, 'POST', '/send-email', { token: validToken, body: validMail, ip: ipB });
  record(2, 'otra IP sí pasa', otraIp.status === 200, String(otraIp.status));
};

// ─── Criterio 3: validación de /send-email ───────────────────────────────────

const criterio3 = async () => {
  const base = await startApp();
  const sin = (campo) => { const m = { ...validMail }; delete m[campo]; return m; };
  const con = (campo, valor) => ({ ...validMail, [campo]: valor });
  const invalidos = [
    ['sin username', sin('username')], ['sin email', sin('email')], ['sin subject', sin('subject')], ['sin message', sin('message')],
    ['username número', con('username', 5)], ['email array', con('email', ['a@b.co'])],
    ['subject objeto', con('subject', { a: 1 })], ['message número', con('message', 7)],
    ['username vacío', con('username', '')], ['subject solo espacios', con('subject', '   ')], ['message solo espacios', con('message', ' \t ')],
    ['correo abc', con('email', 'abc')], ['correo con espacio', con('email', 'a b@c.d')], ['correo con dos destinatarios', con('email', 'a@b.c,d@e.f')],
    ['correo de 255 caracteres', con('email', `${'a'.repeat(243)}@example.com`)],
    ['username de 101', con('username', 'a'.repeat(101))], ['subject de 151', con('subject', 'a'.repeat(151))],
    ['message de 2001', con('message', 'a'.repeat(2001))],
    ['salto de línea en username', con('username', 'Ana\nBcc: x@y.z')], ['salto de línea en subject', con('subject', 'Hola\r\nBcc: x@y.z')],
    ['salto de línea en email', con('email', 'ana@example.com\nBcc: x@y.z')],
    ['U+2028 en username', con('username', 'Ana Bcc')], ['U+2029 en username', con('username', 'Ana Bcc')],
    ['U+2028 en subject', con('subject', 'Hola Bcc')], ['U+2029 en subject', con('subject', 'Hola Bcc')],
    ['U+2028 en email', con('email', 'ana @example.com')], ['U+0085 en subject', con('subject', 'Hola\u0085Bcc')],
    ['NUL en username', con('username', 'Ana\u0000')], ['NUL en email', con('email', 'ana\u0000@example.com')],
    ['NUL en subject', con('subject', 'Hola\u0000')], ['NUL en message', con('message', 'Hola\u0000')],
    ['BEL en username', con('username', 'Ana\u0007')], ['BEL en email', con('email', 'ana\u0007@example.com')],
    ['BEL en subject', con('subject', 'Hola\u0007')], ['BEL en message', con('message', 'Hola\u0007')],
    ['correo con paréntesis', con('email', 'a(b)@example.com')], ['correo con comilla simple', con('email', "o'brien@example.com")],
    ['correo con barra invertida', con('email', 'a\\b@example.com')], ['correo con dos puntos', con('email', 'a:b@example.com')],
  ];
  for (const [nombre, body] of invalidos) {
    const antes = calls.sendMail;
    const r = await call(base, 'POST', '/send-email', { token: validToken, body, ip: nextIp() });
    const enviado = calls.sendMail - antes;
    record(3, nombre, r.status === 400 && isEnvelopeError(r) && enviado === 0, `status=${r.status} sendMail=${enviado}`);
  }
  const sinCuerpo = await call(base, 'POST', '/send-email', { token: validToken, ip: nextIp() });
  record(3, 'sin cuerpo', sinCuerpo.status === 400 && sinCuerpo.json?.success === false, String(sinCuerpo.status));

  const validos = [
    ['cuerpo válido', validMail],
    ['límites exactos (100, 254, 150, 2000)', {
      username: 'a'.repeat(100), email: `${'a'.repeat(242)}@example.com`, subject: 'a'.repeat(150), message: 'a'.repeat(2000),
    }],
    ['campos con espacios alrededor', { username: ' Ana ', email: ' ana@example.com ', subject: ' Hola ', message: ' Texto ' }],
    ['message con \\n, \\r\\n y \\t', { ...validMail, message: 'Línea 1\nLínea 2\r\n\tSangrada' }],
    ['correo con +tag y subdominio', { ...validMail, email: 'nombre+tag@sub.dominio.es' }],
    ['correo a@b.com', { ...validMail, email: 'a@b.com' }],
  ];
  for (const [nombre, body] of validos) {
    const antes = calls.sendMail;
    const r = await call(base, 'POST', '/send-email', { token: validToken, body, ip: nextIp() });
    record(3, nombre, r.status === 200 && r.json?.success === true && calls.sendMail - antes === 1, `status=${r.status} sendMail=${calls.sendMail - antes}`);
  }
};

// ─── Criterios 4 y 5: imageKey ───────────────────────────────────────────────

const criterios45 = async () => {
  const base = await startApp();
  const encode = encodeURIComponent;
  // [nombre, imageKey para el cuerpo del DELETE, query del GET (null = no aplica)]
  const invalidos = [
    ['../x.jpg', '../x.jpg'], ['a/../b.jpg', 'a/../b.jpg'], ['/a.jpg', '/a.jpg'], ['a//b.jpg', 'a//b.jpg'],
    ['a b.jpg (espacio)', 'a b.jpg'], ['a\\b.jpg (barra invertida)', 'a\\b.jpg'], ['carácter de control', 'a\u0001b.jpg'],
    ['201 caracteres', `${'a'.repeat(197)}.jpg`], ['a.txt', 'a.txt'], ['sin extensión', 'a'], ['.hidden.jpg', '.hidden.jpg'],
    ['a/.hidden.jpg', 'a/.hidden.jpg'], ['termina en barra', 'a/'],
    ['marca combinante inicial', '́a.jpg'], ['marca combinante inicial de segmento', 'a/́b.jpg'], ['foto (1).jpg con espacio', 'foto (1).jpg'],
  ].map(([nombre, key]) => ({ nombre, key, query: `imageKey=${encode(key)}` }));
  invalidos.push(
    { nombre: 'a%2e%2e/b.jpg (llega como a../b.jpg)', key: 'a../b.jpg', query: 'imageKey=a%2e%2e/b.jpg' },
    { nombre: 'array imageKey=a&imageKey=b', key: ['a', 'b'], query: 'imageKey=a&imageKey=b' },
    { nombre: 'número', key: 123, query: null },
  );
  for (const { nombre, key, query } of invalidos) {
    if (query !== null) {
      const antes = calls.getPresigned;
      const r = await call(base, 'GET', `/get-image?${query}`, { token: validToken });
      const llamadas = calls.getPresigned - antes;
      record(4, `GET inválido ${nombre}`, r.status === 400 && isEnvelopeError(r) && llamadas === 0, `status=${r.status} s3=${llamadas}`);
    }
    const antes = calls.deleteImage;
    const r = await call(base, 'DELETE', '/delete-image', { token: validToken, body: { imageKey: key } });
    const llamadas = calls.deleteImage - antes;
    record(5, `DELETE inválido ${nombre}`, r.status === 400 && isEnvelopeError(r) && llamadas === 0, `status=${r.status} s3=${llamadas}`);
  }

  const validos = [
    'foto.jpg', 'sub/foto-1_2.PNG', 'a.webp', 'b.gif', 'c.jpeg', 'Año/árbol-ñandú.jpg', 'foto(1).jpg', 'a+b.png',
    'Café.jpg', 'Año/arbol-nandu.jpg', 'Año/arbol-nandu.jpg',
    `${'a'.repeat(196)}.jpg`,
  ];
  for (const key of validos) {
    const antesG = calls.getPresigned;
    const g = await call(base, 'GET', `/get-image?imageKey=${encode(key)}`, { token: validToken });
    record(4, `GET válido ${key.slice(0, 40)}`, g.status === 200 && g.json?.data?.imageUrl && calls.getPresigned - antesG === 1,
      `status=${g.status} s3=${calls.getPresigned - antesG}`);
    const antesD = calls.deleteImage;
    const d = await call(base, 'DELETE', '/delete-image', { token: validToken, body: { imageKey: key } });
    record(5, `DELETE válido ${key.slice(0, 40)}`, d.status === 200 && d.json?.success === true && calls.deleteImage - antesD === 1,
      `status=${d.status} s3=${calls.deleteImage - antesD}`);
  }

  const sinG = await call(base, 'GET', '/get-image', { token: validToken });
  record(4, 'GET sin imageKey mantiene el mensaje', sinG.status === 400 && sinG.json?.error === 'imageKey is required', `${sinG.status} ${sinG.json?.error}`);
  const sinD = await call(base, 'DELETE', '/delete-image', { token: validToken, body: {} });
  record(5, 'DELETE sin imageKey mantiene el mensaje', sinD.status === 400 && sinD.json?.error === 'imageKey is required', `${sinD.status} ${sinD.json?.error}`);
};

// ─── Ejecución ───────────────────────────────────────────────────────────────

const main = async () => {
  const base = await startApp();
  await criterio1(base);
  await criterio2();
  await criterio3();
  await criterios45();

  let fallos = 0;
  for (const id of Object.keys(criteria).sort()) {
    const { total, fallos: lista } = criteria[id];
    console.log(`Criterio ${id}: ${lista.length === 0 ? 'PASA' : 'FALLA'} (${total - lista.length}/${total})`);
    for (const f of lista.slice(0, 8)) console.log(`  - ${f}`);
    if (lista.length > 8) console.log(`  ... y ${lista.length - 8} más`);
    fallos += lista.length;
  }
  console.log(fallos === 0 ? 'Resultado: todo pasa' : `Resultado: ${fallos} caso(s) fallan`);
  return fallos === 0 ? 0 : 1;
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Error del script:', error.message);
    process.exit(2);
  });
