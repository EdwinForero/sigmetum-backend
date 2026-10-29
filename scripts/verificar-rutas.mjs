// Verificación repetible de las rutas (M21: rutas públicas y protegidas) y de la validación de /send-email y imageKey.
// Uso: node scripts/verificar-rutas.mjs   (o: npm run verificar:rutas)
// Reproduce la pila de producción de index.js (/healthcheck, cors, express.json, auth, data y content bajo el mismo
// prefijo, con el errorHandler al final) con S3 y SMTP sustituidos por espías: no hay red ni credenciales reales.
// /healthcheck y cors son una réplica de index.js (no se monta morgan).
// Criterio 1: las ocho rutas públicas responden sin token (nunca 401).
// Criterios 2 a 5: límite y validación de POST /send-email (anónimo) y validación de imageKey (GET y DELETE).
// Criterio 6: las nueve rutas protegidas dan 401 sin token, con token inválido y con token caducado, también
//   /upload y /upload-image con multipart (tokenAuth corre antes que multer) y las variantes de mayúsculas y barra final.
// Criterio 7: todas las rutas mutantes de la pila real dan 401 y no llaman a S3 ni a SMTP (salvo POST /log y POST /send-email).
// Criterio 8: estructura. Tabla de clasificación contra la pila real (app._router.stack), tokenAuth como primer manejador
//   de cada ruta protegida, ausente en las públicas, sin use(tokenAuth) a nivel de router, y lectura ESTÁTICA de index.js.
// Criterio 9: Authorization inválido o caducado en las rutas abiertas responde igual que sin token; rutas inexistentes
//   (también fuera del prefijo) y métodos no definidos dan 404 con envoltorio { success: false, error: 'Not found' } fijo,
//   sin 405; /healthcheck y OPTIONS conservan su respuesta; Origin no permitido da 403 y JSON mal formado 400 Invalid JSON.
// Criterio 10: errores controlados y CORS (M17, M22). Errores inyectados con `inject` sobre GET /list-terms y delete-*:
//   500 genérico sin el texto original, 5xx explícito, mapeados de almacenamiento, 4xx de librería, MulterError, 413,
//   delete-* sin reflejar el SDK y el origen rechazado fuera de las respuestas (solo en el console.warn).
// Criterio 11: fecha UTC única (A1). formatFileName y getNextVersion con la fecha inyectada y el flujo de POST /upload.
// Criterio 12: validación del nombre de provincia (A4), sin red.
// Criterio 13: POST /upload con un Excel real en memoria y convertExcelToJson real: provincia válida e inválida.
// Criterio 14: claves del cliente en upload/confirm, update-file y delete-file (formato, NFC, sin tocar S3).
// Criterio 15: prefijo con barra en los listados, sobre el aws/awsS3connect.js real con S3Client.send parcheado.
// Se ejecuta también con TZ=Pacific/Kiritimati (UTC+14) para distinguir la fecha local de la UTC.
// Límite: la réplica de cors de startApp es una copia a mano de index.js (los marcadores del criterio 8 detectan
//   su ausencia, no una divergencia); el index.js real solo se ejercita con un arranque real.
// Sale con código 0 si todo pasa, 1 si algún caso falla y 2 si el propio script falla.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
const spyTotal = () => Object.values(calls).reduce((sum, n) => sum + n, 0);

const injectInCache = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
};

// Respuestas sembradas por el criterio 10 (null = comportamiento normal). Las rutas inyectadas también cuentan.
const inject = { getTextJson: null, deleteImage: null, deleteTerm: null };

const other = (value) => async () => { calls.s3Other += 1; return value; };
// Argumentos recibidos por los espías de versiones (criterios 11 a 14) y listado sembrado para listFilesInS3Folder.
const argsLog = { upload: [], update: [], del: [], list: [] };
const seed = { list: [] };
injectInCache(join(ROOT, 'aws', 'awsS3connect.js'), {
  getPresignedUrlsFromS3Folder: other([]),
  getPresignedUrlFromS3: async () => { calls.getPresigned += 1; return 'https://s3.example.invalid/url-prefirmada'; },
  uploadImageToS3: other(undefined),
  deleteImageFromS3: async () => { calls.deleteImage += 1; return inject.deleteImage ?? { success: true }; },
  getTextJsonS3: async () => { calls.s3Other += 1; if (inject.getTextJson) throw inject.getTextJson; return []; },
  uploadTextToJsonS3: other(undefined),
  deleteTermFromS3: async () => { calls.s3Other += 1; return inject.deleteTerm ?? { success: true }; },
  uploadFileToS3: async (...args) => { calls.s3Other += 1; argsLog.upload.push(args); },
  getFileFromS3: other({}),
  getMergedDataInS3Folder: other({}),
  deleteFileFromS3: async (...args) => { calls.s3Other += 1; argsLog.del.push(args); return { success: true }; },
  updateFileS3: async (...args) => { calls.s3Other += 1; argsLog.update.push(args); },
  listFilesInS3Folder: async (...args) => { calls.s3Other += 1; argsLog.list.push(args); return seed.list; },
});
injectInCache('nodemailer', {
  createTransport: () => ({ sendMail: async () => { calls.sendMail += 1; return { accepted: [] }; } }),
});

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const errorHandler = require('../middleware/errorHandler');
const notFound = require('../middleware/notFound');
const { tokenAuth } = require('../functions/tokenAuthentication');

const PREFIX = '/api/v1';
const contentPath = require.resolve('../routes/content.js');

// Monta la pila como index.js. Recargar solo routes/content.js reinicia el limitador (MemoryStore nuevo).
const servers = [];
const startApp = async () => {
  delete require.cache[contentPath];
  const app = express();
  app.set('trust proxy', 1);
  // Réplica de index.js: /healthcheck y cors con la misma lógica de origen permitido.
  app.use('/healthcheck', (req, res) => {
    res.status(200).send('ok');
  });
  const originNotAllowed = new Error('Origin not allowed');
  originNotAllowed.status = 403;
  originNotAllowed.publicMessage = 'Origin not allowed';
  app.use(cors({
    origin: (origin, callback) => {
      const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        console.warn('CORS: origin not allowed:', JSON.stringify(origin.slice(0, 200)));
        callback(originNotAllowed);
      }
    },
  }));
  app.use(express.json());
  app.use(PREFIX, require('../routes/auth'));
  app.use(PREFIX, require('../routes/data'));
  app.use(PREFIX, require('../routes/content.js'));
  app.use(notFound);
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const root = `http://127.0.0.1:${server.address().port}`;
  return { app, root, base: `${root}${PREFIX}` };
};

const validToken = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });
const expiredToken = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: -10 });
const invalidToken = jwt.sign({ userId: 1 }, 'otra-clave-distinta-de-prueba', { expiresIn: '1h' });
const TOKEN_STATES = [
  ['sin token', undefined, 'No token provided'],
  ['token inválido', invalidToken, 'Invalid token'],
  ['token caducado', expiredToken, 'Token expired'],
];

let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };

const call = async (base, method, path, { token, body, ip, headers: extra, rawBody } = {}) => {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  let payload = rawBody;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, contentType: res.headers.get('content-type') ?? '', headers: res.headers };
};

// ─── Registro de resultados por criterio ─────────────────────────────────────

const criteria = {};
const record = (criterio, nombre, ok, detalle = '') => {
  criteria[criterio] ??= { total: 0, fallos: [] };
  criteria[criterio].total += 1;
  if (!ok) criteria[criterio].fallos.push(`${nombre}${detalle ? ` -> ${detalle}` : ''}`);
};
const isEnvelopeError = (r) => r.json && r.json.success === false && typeof r.json.error === 'string';

// ─── Tabla de clasificación de rutas (tal como se declaran, sin prefijo) ─────

const ROUTES = {
  'POST /send-email': 'public',
  'GET /list-images': 'public',
  'GET /get-image': 'public',
  'GET /list-terms': 'public',
  'GET /list-files': 'public',
  'GET /get-data/:path(*)': 'public',
  'GET /get-merged-data': 'public',
  'POST /log': 'public',
  'GET /auth': 'protected',
  'POST /upload': 'protected',
  'POST /upload/confirm': 'protected',
  'POST /update-file': 'protected',
  'POST /delete-file': 'protected',
  'POST /upload-image': 'protected',
  'DELETE /delete-image': 'protected',
  'POST /upload-term': 'protected',
  'DELETE /delete-term': 'protected',
};
const PROTECTED = Object.entries(ROUTES).filter(([, kind]) => kind === 'protected').map(([id]) => id.split(' '));

// Recorre la pila de Express 4 de forma recursiva: las capas con .route dan método, ruta y manejadores; las capas
// con name 'router' se recorren entrando en layer.handle.stack (también el estado anterior al cambio, con
// protectedRouter); una capa que no es ruta y cuyo manejador es tokenAuth es un use(tokenAuth) a nivel de router.
const declaredRoutes = (app) => {
  if (!app._router || !Array.isArray(app._router.stack)) {
    throw new Error('No se encuentra app._router.stack: ¿cambió la versión de Express? Este script necesita Express 4.');
  }
  const routes = [];
  const routerLevelAuth = [];
  const walkStack = (stack, trail) => {
    for (const layer of stack) {
      if (layer.route) {
        const handlers = layer.route.stack.map((l) => l.handle);
        for (const method of Object.keys(layer.route.methods).filter((m) => layer.route.methods[m])) {
          routes.push({ method: method.toUpperCase(), path: String(layer.route.path), handlers, trail });
        }
      } else if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
        walkStack(layer.handle.stack, [...trail, 'router']);
      } else if (layer.handle === tokenAuth) {
        routerLevelAuth.push(trail.join('>') || 'app');
      }
    }
  };
  walkStack(app._router.stack, []);
  return { routes, routerLevelAuth };
};

// Lectura estática de index.js: los montajes deben ser authRoutes, dataRoutes, contentRoutes, notFound y errorHandler,
// en ese orden, y no debe haber otros app.use/app.all con rutas (solo /healthcheck, que es público). Los montajes
// construidos dinámicamente en variables no se ven (límite conocido de la comprobación estática).
const checkIndexStatic = () => {
  const problems = [];
  const source = readFileSync(join(ROOT, 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const mounts = [];
  const order = [];
  for (const match of source.matchAll(/^\s*app\.(use|all|get|post|put|patch|delete|options|route)\(([^\n]*)$/gm)) {
    const [, method, rest] = match;
    if (method !== 'use') {
      problems.push(`index.js declara app.${method}(...): ${rest.trim().slice(0, 50)}`);
    } else if (/^\s*['"]\/healthcheck['"]/.test(rest)) {
      order.push('healthcheck');
    } else if (/^\s*API_PREFIX\s*,\s*(\w+)\s*\)/.test(rest)) {
      mounts.push(rest.match(/^\s*API_PREFIX\s*,\s*(\w+)\s*\)/)[1]);
      order.push('mount');
    } else if (/^\s*errorHandler\s*\)/.test(rest)) {
      order.push('errorHandler');
    } else if (/^\s*notFound\s*\)/.test(rest)) {
      order.push('notFound');
    } else if (/^\s*(morgan|cors|compression)\(/.test(rest) || /^\s*express\.json\(\)/.test(rest)) {
      order.push('middleware');
    } else {
      problems.push(`index.js tiene un app.use no reconocido: ${rest.trim().slice(0, 50)}`);
    }
  }
  if (mounts.join(',') !== 'authRoutes,dataRoutes,contentRoutes') problems.push(`Montajes de index.js: ${mounts.join(', ') || 'ninguno'} (esperado: authRoutes, dataRoutes, contentRoutes)`);
  if (order.filter((o) => o === 'errorHandler').length !== 1 || order[order.length - 1] !== 'errorHandler') problems.push('errorHandler debe montarse una vez y al final de index.js');
  // Solo montajes de routers, notFound y errorHandler, en su orden de aparición: exactamente mount x3, notFound, errorHandler.
  const secuencia = order.filter((o) => ['mount', 'notFound', 'errorHandler'].includes(o)).join(',');
  if (secuencia !== 'mount,mount,mount,notFound,errorHandler') problems.push(`notFound debe montarse una vez, tras los tres routers y justo antes de errorHandler (secuencia: ${secuencia || 'ninguna'})`);
  for (const [name, file] of [['authRoutes', './routes/auth'], ['dataRoutes', './routes/data'], ['contentRoutes', './routes/content'], ['notFound', './middleware/notFound']]) {
    if (!source.includes(`const ${name} = require('${file}');`)) problems.push(`index.js no importa ${name} desde ${file}`);
  }
  // Marcadores del 403 de CORS (M22). Comprobación literal: un cambio de espaciado en index.js la haría fallar.
  for (const marcador of ['originNotAllowed.status = 403;', "originNotAllowed.publicMessage = 'Origin not allowed';","console.warn('CORS: origin not allowed:'"]) {
    if (!source.includes(marcador)) problems.push(`index.js no contiene el marcador de CORS: ${marcador}`);
  }
  return problems;
};

// ─── Criterio 1: las ocho rutas públicas responden sin token ─────────────────

const criterio1 = async (base) => {
  const publicas = [
    ['POST', '/send-email', 400, {}], ['GET', '/get-image?imageKey=foto.jpg', 200], ['GET', '/list-images', 200],
    ['GET', '/list-terms', 200], ['GET', '/list-files', 200], ['GET', '/get-data/data/malaga/x.json', 200],
    ['GET', '/get-merged-data', 200], ['POST', '/log', 400, {}],
  ];
  for (const [method, path, esperado, body] of publicas) {
    const r = await call(base, method, path, { body, ip: nextIp() });
    record(1, `sin token ${method} ${path}`, r.status !== 401 && r.status === esperado, `${r.status} ${r.json?.error ?? ''}`.trim());
  }
  const log = await call(base, 'POST', '/log', { body: {} });
  record(1, 'POST /log llega a su manejador con envoltorio', log.status === 400 && isEnvelopeError(log), String(log.status));
};

// ─── Criterio 2: límite de 5 peticiones por IP (anónimo) ─────────────────────

const validMail = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };

const criterio2 = async () => {
  const { base } = await startApp();
  const ipA = nextIp();
  const ipB = nextIp();
  const antes = calls.sendMail;
  const statuses = [];
  for (let i = 1; i <= 5; i += 1) {
    const r = await call(base, 'POST', '/send-email', { body: validMail, ip: ipA });
    statuses.push(r.status);
  }
  record(2, 'cinco peticiones anónimas válidas dan 200', statuses.every((s) => s === 200), statuses.join(','));
  record(2, 'sendMail cuenta 5', calls.sendMail - antes === 5, String(calls.sendMail - antes));
  const sexto = await call(base, 'POST', '/send-email', { body: validMail, ip: ipA });
  record(2, 'la sexta anónima da 429 con envoltorio', sexto.status === 429 && isEnvelopeError(sexto), `${sexto.status} ${JSON.stringify(sexto.json)}`);
  const sextoToken = await call(base, 'POST', '/send-email', { token: validToken, body: validMail, ip: ipA });
  record(2, 'con token válido la misma IP sigue limitada', sextoToken.status === 429, String(sextoToken.status));
  record(2, 'la sexta no envía correo', calls.sendMail - antes === 5, `sendMail=${calls.sendMail - antes}`);
  const otraIp = await call(base, 'POST', '/send-email', { body: validMail, ip: ipB });
  record(2, 'otra IP sí pasa', otraIp.status === 200, String(otraIp.status));

  const ipC = nextIp();
  const malos = [];
  for (let i = 1; i <= 5; i += 1) malos.push((await call(base, 'POST', '/send-email', { body: {}, ip: ipC })).status);
  record(2, 'cinco cuerpos inválidos dan 400', malos.every((s) => s === 400), malos.join(','));
  const trasMalos = await call(base, 'POST', '/send-email', { body: validMail, ip: ipC });
  record(2, 'los 400 cuentan para el límite', trasMalos.status === 429, String(trasMalos.status));
};

// ─── Criterio 3: validación de /send-email (anónimo) ─────────────────────────

const criterio3 = async () => {
  const { base } = await startApp();
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
    const r = await call(base, 'POST', '/send-email', { body, ip: nextIp() });
    const enviado = calls.sendMail - antes;
    record(3, nombre, r.status === 400 && isEnvelopeError(r) && enviado === 0, `status=${r.status} sendMail=${enviado}`);
  }
  const sinCuerpo = await call(base, 'POST', '/send-email', { ip: nextIp() });
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
    const r = await call(base, 'POST', '/send-email', { body, ip: nextIp() });
    record(3, nombre, r.status === 200 && r.json?.success === true && calls.sendMail - antes === 1, `status=${r.status} sendMail=${calls.sendMail - antes}`);
  }
};

// ─── Criterios 4 y 5: imageKey (GET anónimo; DELETE con token válido) ────────

const criterios45 = async () => {
  const { base } = await startApp();
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
      const r = await call(base, 'GET', `/get-image?${query}`);
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
    'Café.jpg', 'Año/arbol-nandu.jpg',
    `${'a'.repeat(196)}.jpg`,
  ];
  for (const key of validos) {
    const antesG = calls.getPresigned;
    const g = await call(base, 'GET', `/get-image?imageKey=${encode(key)}`);
    record(4, `GET válido ${key.slice(0, 40)}`, g.status === 200 && g.json?.data?.imageUrl && calls.getPresigned - antesG === 1,
      `status=${g.status} s3=${calls.getPresigned - antesG}`);
    const antesD = calls.deleteImage;
    const d = await call(base, 'DELETE', '/delete-image', { token: validToken, body: { imageKey: key } });
    record(5, `DELETE válido ${key.slice(0, 40)}`, d.status === 200 && d.json?.success === true && calls.deleteImage - antesD === 1,
      `status=${d.status} s3=${calls.deleteImage - antesD}`);
  }

  const sinG = await call(base, 'GET', '/get-image');
  record(4, 'GET sin imageKey mantiene el mensaje', sinG.status === 400 && sinG.json?.error === 'imageKey is required', `${sinG.status} ${sinG.json?.error}`);
  const sinD = await call(base, 'DELETE', '/delete-image', { token: validToken, body: {} });
  record(5, 'DELETE sin imageKey mantiene el mensaje', sinD.status === 400 && sinD.json?.error === 'imageKey is required', `${sinD.status} ${sinD.json?.error}`);
  const sinTokenD = await call(base, 'DELETE', '/delete-image', { body: { imageKey: 'foto.jpg' } });
  record(5, 'DELETE sin token da 401 (es protegida)', sinTokenD.status === 401, String(sinTokenD.status));
};

// ─── Criterio 6: las nueve protegidas dan 401 en los tres estados ────────────

const criterio6 = async (base) => {
  const esperado = (status, json, mensaje) => status === 401 && json?.error === mensaje;
  for (const [method, path] of PROTECTED) {
    for (const [estado, token, mensaje] of TOKEN_STATES) {
      const antes = spyTotal();
      const r = await call(base, method, path, { token, body: method === 'GET' ? undefined : {} });
      record(6, `${estado} ${method} ${path}`, esperado(r.status, r.json, mensaje) && spyTotal() === antes, `${r.status} ${r.json?.error}`);
    }
  }
  // Orden de middleware: tokenAuth corre antes que multer (si multer corriera primero, un multipart roto daría 400).
  for (const path of ['/upload', '/upload-image']) {
    for (const [estado, token, mensaje] of TOKEN_STATES) {
      const antes = spyTotal();
      const form = new FormData();
      form.append('file', new Blob(['contenido']), 'a.xlsx');
      form.append('title', 'prueba');
      const real = await call(base, 'POST', path, { token, rawBody: form });
      record(6, `multipart real ${estado} POST ${path}`, esperado(real.status, real.json, mensaje) && spyTotal() === antes, `${real.status} ${real.json?.error}`);
      const roto = await call(base, 'POST', path, { token, headers: { 'Content-Type': 'multipart/form-data' }, rawBody: 'sin boundary' });
      record(6, `multipart sin boundary ${estado} POST ${path}`, esperado(roto.status, roto.json, mensaje) && spyTotal() === antes, `${roto.status} ${roto.json?.error}`);
    }
  }
  for (const variante of ['/UPLOAD', '/upload/']) {
    for (const [estado, token, mensaje] of TOKEN_STATES) {
      const r = await call(base, 'POST', variante, { token, body: {} });
      record(6, `${estado} POST ${variante}`, esperado(r.status, r.json, mensaje), `${r.status} ${r.json?.error}`);
    }
  }
  // Controles positivos: con token válido se llega al manejador (el 401 no es un efecto de otra cosa).
  const auth = await call(base, 'GET', '/auth', { token: validToken });
  record(6, 'control: GET /auth con token válido da 200', auth.status === 200, String(auth.status));
  const confirm = await call(base, 'POST', '/upload/confirm', { token: validToken, body: {} });
  record(6, 'control: POST /upload/confirm con token válido llega al manejador (400)', confirm.status === 400 && isEnvelopeError(confirm), String(confirm.status));
};

// ─── Criterio 7: todas las mutantes de la pila real ──────────────────────────

const criterio7 = async (base, app) => {
  const { routes } = declaredRoutes(app);
  const mutantes = routes.filter((r) => r.method !== 'GET');
  record(7, 'hay rutas mutantes en la pila', mutantes.length > 0, 'la pila no tiene rutas mutantes');
  for (const route of mutantes) {
    if (['POST /log', 'POST /send-email'].includes(`${route.method} ${route.path}`)) continue;
    const path = route.path.replace(/:\w+(\(\*\))?/g, 'x');
    for (const [estado, token] of TOKEN_STATES) {
      const antes = spyTotal();
      const r = await call(base, route.method, path, { token, body: {} });
      record(7, `${estado} ${route.method} ${route.path}`, r.status === 401 && spyTotal() === antes, `${r.status} llamadas=${spyTotal() - antes}`);
    }
  }
};

// ─── Criterio 8: estructura de la pila y de index.js ─────────────────────────

const criterio8 = (app) => {
  const { routes, routerLevelAuth } = declaredRoutes(app);
  const declared = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]));
  for (const id of declared.keys()) record(8, `ruta clasificada ${id}`, id in ROUTES, 'no está en la tabla ROUTES');
  for (const id of Object.keys(ROUTES)) record(8, `ruta de la tabla existe ${id}`, declared.has(id), 'la tabla la lista y no existe en la pila');
  for (const [id, kind] of Object.entries(ROUTES)) {
    const route = declared.get(id);
    if (!route) continue;
    if (kind === 'protected') record(8, `tokenAuth es el primer manejador de ${id}`, route.handlers[0] === tokenAuth, 'el primer manejador no es tokenAuth');
    else record(8, `${id} pública sin tokenAuth`, !route.handlers.includes(tokenAuth), 'lleva tokenAuth');
  }
  record(8, 'sin use(tokenAuth) a nivel de router', routerLevelAuth.length === 0, `hay ${routerLevelAuth.length} en ${routerLevelAuth.join(', ')}`);
  const ultimas = app._router.stack.slice(-2).map((layer) => layer.handle);
  record(8, 'pila: notFound y errorHandler son las dos últimas capas (en ese orden)', ultimas[0] === notFound && ultimas[1] === errorHandler,
    'las dos últimas capas de la pila no son notFound y errorHandler');
  const problemasIndex = checkIndexStatic();
  record(8, 'index.js (estático): montajes y orden', problemasIndex.length === 0, problemasIndex.join('; '));
};

// ─── Criterio 9: tokens en las rutas abiertas y rutas inexistentes ───────────

const criterio9 = async (base, root) => {
  const abiertas = [['POST', '/send-email', {}], ['GET', '/get-image?imageKey=foto.jpg'], ['GET', '/list-images'], ['GET', '/list-terms']];
  for (const [method, path, body] of abiertas) {
    const sinToken = await call(base, method, path, { body, ip: nextIp() });
    for (const [estado, token] of TOKEN_STATES.slice(1)) {
      const r = await call(base, method, path, { token, body, ip: nextIp() });
      record(9, `${estado} ${method} ${path} responde como sin token`, r.status !== 401 && r.status === sinToken.status, `${r.status} (sin token: ${sinToken.status})`);
    }
  }
  const estados = [['sin token', undefined], ['token válido', validToken], ['token inválido', invalidToken], ['token caducado', expiredToken]];
  const es404 = (r) => r.status === 404 && /application\/json/.test(r.contentType) && r.json?.success === false && r.json?.error === 'Not found';
  const resumen = (r) => `${r.status} ${r.contentType} ${JSON.stringify(r.json)}`;
  const cuerpo = (method) => (method === 'GET' ? undefined : {});

  // a. Rutas inexistentes bajo el prefijo, con todos los métodos y estados de token.
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const [estado, token] of estados) {
      const r = await call(base, method, '/no-existe', { token, body: cuerpo(method) });
      record(9, `a. ${estado} ${method} /no-existe da 404 con envoltorio`, es404(r), resumen(r));
    }
  }
  // b. Método no definido en una ruta existente: 404, no 405, sin cabecera Allow.
  for (const [method, path] of [['DELETE', '/list-terms'], ['POST', '/list-images'], ['GET', '/upload']]) {
    for (const [estado, token] of estados) {
      const r = await call(base, method, path, { token, body: cuerpo(method) });
      record(9, `b. ${estado} ${method} ${path} da 404 con envoltorio`, es404(r) && !r.headers.has('allow'), `${resumen(r)} allow=${r.headers.get('allow')}`);
    }
  }
  // c. Mensaje fijo: no refleja ruta, método ni consulta.
  const c1 = await call(base, 'GET', '/no-existe/%3Cscript%3Ealert(1)%3C%2Fscript%3E?x=1');
  const c2 = await call(base, 'POST', '/otra-ruta-distinta', { body: {} });
  record(9, 'c. el error es idéntico en dos rutas distintas', es404(c1) && es404(c2) && c1.json.error === c2.json.error, `${resumen(c1)} | ${resumen(c2)}`);
  record(9, 'c. el error no refleja la ruta ni la consulta', typeof c1.json?.error === 'string' && !/script|no-existe|x=1/i.test(c1.json.error), resumen(c1));
  // d. Fuera del prefijo.
  for (const path of ['/', '/otra', '/api/v2/x']) {
    const r = await call(root, 'GET', path);
    record(9, `d. GET ${path} (fuera del prefijo) da 404 con envoltorio`, es404(r), resumen(r));
  }
  // e. Sin cambios: /healthcheck, OPTIONS, Origin permitido y no permitido.
  const health = await fetch(`${root}/healthcheck`);
  const healthText = await health.text();
  record(9, 'e. GET /healthcheck da 200 ok (texto, no JSON)', health.status === 200 && healthText === 'ok' && !/json/.test(health.headers.get('content-type') ?? ''), `${health.status} ${healthText}`);
  const preflight = await call(base, 'OPTIONS', '/no-existe', { headers: { Origin: 'http://localhost', 'Access-Control-Request-Method': 'GET' } });
  record(9, 'e. OPTIONS con Origin permitido da 204 con CORS', preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'http://localhost',
    `${preflight.status} acao=${preflight.headers.get('access-control-allow-origin')}`);
  const conOrigin = await call(base, 'GET', '/no-existe', { headers: { Origin: 'http://localhost' } });
  record(9, 'e. GET /no-existe con Origin permitido lleva la cabecera CORS', conOrigin.headers.get('access-control-allow-origin') === 'http://localhost',
    String(conOrigin.headers.get('access-control-allow-origin')));
  const otroOrigen = await call(base, 'GET', '/list-terms', { headers: { Origin: 'http://otro.example' } });
  record(9, 'e. Origin no permitido da 403 Origin not allowed sin el origen (no Not found)',
    otroOrigen.status === 403 && otroOrigen.json?.success === false && otroOrigen.json?.error === 'Origin not allowed'
    && !JSON.stringify(otroOrigen.json).includes('otro.example'), resumen(otroOrigen));
  const otroPreflight = await call(base, 'OPTIONS', '/list-terms', { headers: { Origin: 'http://otro.example', 'Access-Control-Request-Method': 'GET' } });
  record(9, 'e. Preflight OPTIONS con Origin no permitido da 403 sin el origen',
    otroPreflight.status === 403 && otroPreflight.json?.error === 'Origin not allowed' && !JSON.stringify(otroPreflight.json).includes('otro.example'), resumen(otroPreflight));
  // f. JSON mal formado da 400 con envoltorio y texto fijo, sin el mensaje del parser.
  const malformado = await call(base, 'POST', '/send-email', { rawBody: '{', headers: { 'Content-Type': 'application/json' }, ip: nextIp() });
  record(9, 'f. JSON mal formado da 400 Invalid JSON sin detalle del parser',
    malformado.status === 400 && isEnvelopeError(malformado) && malformado.json.error === 'Invalid JSON'
    && !/Unexpected|position/.test(malformado.json.error), resumen(malformado));
};

// ─── Criterio 10: errores controlados y CORS ─────────────────────────────────

const resumenCaso = (r) => `${r.status} ${JSON.stringify(r.json)}`;

const criterio10 = async (base) => {
  const registro = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  const capturar = (...args) => { registro.push(args.map(String).join(' ')); };
  const sembrar = async (error) => {
    inject.getTextJson = error;
    try { return await call(base, 'GET', '/list-terms'); } finally { inject.getTextJson = null; }
  };
  const conRegistro = (texto) => registro.some((linea) => linea.includes(texto));
  const sinTexto = (r, texto) => !JSON.stringify(r.json ?? {}).includes(texto);
  const conCodigo = (mensaje, props) => Object.assign(new Error(mensaje), props);
  console.error = capturar;
  console.warn = capturar;
  try {
    // 10a. Error sin status y sin mapear: texto genérico; el detalle solo va al registro.
    const a = await sembrar(new Error('secreto interno xyz'));
    record(10, 'a. error sin status da 500 Internal server error sin el texto original',
      a.status === 500 && a.json?.error === 'Internal server error' && sinTexto(a, 'secreto'), resumenCaso(a));
    record(10, 'a. el registro conserva el mensaje real', conRegistro('secreto interno xyz'), 'no se registró');
    // 10b. 5xx explícito.
    const b = await sembrar(conCodigo('secreto 503', { status: 503 }));
    record(10, 'b. status 503 se conserva con Internal server error',
      b.status === 503 && b.json?.error === 'Internal server error' && sinTexto(b, 'secreto'), resumenCaso(b));
    // 10c. Mapeados de almacenamiento: conservan su texto.
    const mapeados = [
      ['NoSuchKey', 'The requested file does not exist in storage'], ['NoSuchBucket', 'Storage bucket is not configured correctly'],
      ['AccessDenied', 'Access denied to storage'], ['NetworkingError', 'Storage connection error'], ['ECONNREFUSED', 'Storage connection error'],
    ];
    for (const [code, texto] of mapeados) {
      const r = await sembrar(conCodigo(`detalle ${code}`, { code }));
      record(10, `c. ${code} conserva su texto`, r.status === 500 && r.json?.error === texto, resumenCaso(r));
    }
    // 10d. Otro 4xx de librería: texto fijo.
    const d = await sembrar(conCodigo('secreto 422', { status: 422 }));
    record(10, 'd. status 422 da Bad request sin el texto original', d.status === 422 && d.json?.error === 'Bad request' && sinTexto(d, 'secreto'), resumenCaso(d));
    // 10e. MulterError real: campo inesperado (LIMIT_UNEXPECTED_FILE).
    const form = new FormData();
    form.append('otro', new Blob(['contenido']), 'a.jpg');
    const e = await call(base, 'POST', '/upload-image', { token: validToken, rawBody: form });
    record(10, 'e. MulterError (campo inesperado) da 400 File upload error: Unexpected field',
      e.status === 400 && e.json?.error === 'File upload error: Unexpected field', resumenCaso(e));
    // 10f. delete-image y delete-term no reflejan el error del SDK.
    inject.deleteImage = { success: false, error: 'secreto del sdk' };
    let fi;
    try { fi = await call(base, 'DELETE', '/delete-image', { token: validToken, body: { imageKey: 'foto.jpg' } }); } finally { inject.deleteImage = null; }
    record(10, 'f. delete-image fallido da 500 Internal server error sin el texto del SDK',
      fi.status === 500 && fi.json?.error === 'Internal server error' && sinTexto(fi, 'secreto'), resumenCaso(fi));
    inject.deleteTerm = { success: false, message: 'secreto del sdk' };
    let ft;
    try { ft = await call(base, 'DELETE', '/delete-term', { token: validToken, body: { term: 'x' } }); } finally { inject.deleteTerm = null; }
    record(10, 'f. delete-term fallido da 500 Internal server error sin el texto del SDK',
      ft.status === 500 && ft.json?.error === 'Internal server error' && sinTexto(ft, 'secreto'), resumenCaso(ft));
    record(10, 'f. el registro conserva el texto del SDK', conRegistro('secreto del sdk'), 'no se registró');
    // 10g. Cuerpo mayor que el límite de express.json (100 KB): 413 con texto fijo.
    const grande = await call(base, 'POST', '/send-email', { rawBody: JSON.stringify({ message: 'a'.repeat(110 * 1024) }), headers: { 'Content-Type': 'application/json' }, ip: nextIp() });
    record(10, 'g. cuerpo de más de 100 KB da 413 Payload too large', grande.status === 413 && grande.json?.error === 'Payload too large', resumenCaso(grande));
    // 10h. El origen rechazado no vuelve al cliente; solo el 403 y el warn aportan evidencia (404 y 500 no reflejan el origen).
    const evil = 'http://evil-xyz.example';
    registro.length = 0;
    const h403 = await call(base, 'GET', '/list-terms', { headers: { Origin: evil } });
    record(10, 'h. 403 de CORS sin el origen en el cuerpo', h403.status === 403 && h403.json?.error === 'Origin not allowed' && sinTexto(h403, 'evil-'), resumenCaso(h403));
    record(10, 'h. el warn registra el origen rechazado', registro.some((linea) => linea.includes('CORS') && linea.includes(evil)), 'el warn no contiene el origen');
    // El index.js real registra el origen truncado con JSON.stringify (neutraliza saltos de línea y comillas del valor del cliente).
    const indexSource = readFileSync(join(ROOT, 'index.js'), 'utf8');
    record(10, 'h. index.js registra el origen rechazado truncado con JSON.stringify (estático)',
      indexSource.includes("console.warn('CORS: origin not allowed:', JSON.stringify(origin.slice(0, 200)))"), 'falta el warn con JSON.stringify(origin.slice(0, 200)) en index.js');
    const h404 = await call(base, 'GET', '/no-existe', { headers: { Origin: 'http://localhost' } });
    record(10, 'h. 404 sin el origen (no aporta evidencia)', sinTexto(h404, 'evil-'), resumenCaso(h404));
    inject.getTextJson = new Error('fallo sembrado');
    let h500;
    try { h500 = await call(base, 'GET', '/list-terms', { headers: { Origin: 'http://localhost' } }); } finally { inject.getTextJson = null; }
    record(10, 'h. 500 sin el origen (no aporta evidencia)', sinTexto(h500, 'evil-'), resumenCaso(h500));
    // 10i. Origin muy largo: el warn lo trunca a 200 caracteres y el cuerpo del 403 no refleja nada.
    registro.length = 0;
    const largo = `http://${'a'.repeat(5000)}.example`;
    const i403 = await call(base, 'GET', '/list-terms', { headers: { Origin: largo } });
    const lineaWarn = registro.find((linea) => linea.includes('CORS')) ?? '';
    record(10, 'i. Origin de 5000 caracteres: 403 sin reflejar el origen', i403.status === 403 && i403.json?.error === 'Origin not allowed' && sinTexto(i403, 'aaaa'), resumenCaso(i403));
    record(10, 'i. el warn trunca el origen largo (conserva 200 caracteres y descarta el resto)',
      lineaWarn.includes('a'.repeat(100)) && !lineaWarn.includes('a'.repeat(201)) && lineaWarn.length < 400, `longitud del warn: ${lineaWarn.length}`);
    // 10j. delete-image / delete-term con {success:false} sin texto: 500 genérico y mensaje por defecto en el registro.
    registro.length = 0;
    inject.deleteImage = { success: false };
    let vi;
    try { vi = await call(base, 'DELETE', '/delete-image', { token: validToken, body: { imageKey: 'foto.jpg' } }); } finally { inject.deleteImage = null; }
    record(10, 'j. delete-image sin texto de error da 500 Internal server error', vi.status === 500 && vi.json?.error === 'Internal server error', resumenCaso(vi));
    record(10, 'j. el registro de delete-image lleva el mensaje por defecto', conRegistro('delete-image failed'), 'el registro no contiene delete-image failed');
    inject.deleteTerm = { success: false };
    let vt;
    try { vt = await call(base, 'DELETE', '/delete-term', { token: validToken, body: { term: 'x' } }); } finally { inject.deleteTerm = null; }
    record(10, 'j. delete-term sin texto de error da 500 Internal server error', vt.status === 500 && vt.json?.error === 'Internal server error', resumenCaso(vt));
    record(10, 'j. el registro de delete-term lleva el mensaje por defecto', conRegistro('delete-term failed'), 'el registro no contiene delete-term failed');
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    inject.getTextJson = null;
    inject.deleteImage = null;
    inject.deleteTerm = null;
  }
};

// ─── Criterios 11 a 15: fecha UTC, provincia y claves de versión (A1, A4) ─────

const ExcelJS = require('exceljs');
const HEADERS = ['Provincia', 'Municipio', 'Altitud Media', 'Sector Biogeográfico', 'Piso Bioclimático', 'Ombrotipo',
  'Naturaleza del Sustrato', 'Tipo de Serie', 'Serie de Vegetación', 'Vegetación Potencial', 'Especies Características'];
const fullRow = (provincia) => [provincia, 'Municipio', 100, 'Sector', 'Piso', 'Ombrotipo', 'Sustrato', 'Tipo', 'Serie', 'Vegetación', 'Especies'];
const makeXlsx = async (rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Hoja1');
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
const FILE_RE = /^\d{4}-\d{2}-\d{2}_v\d+\.xlsx$/;

const subir = async (base, rows) => {
  const form = new FormData();
  form.append('file', new Blob([await makeXlsx(rows)]), 'datos.xlsx');
  return call(base, 'POST', '/upload', { token: validToken, rawBody: form });
};

const criterio11 = async (base) => {
  const { formatFileName } = require('../functions/formatFileName');
  const { getNextVersion } = require('../functions/getNextVersion');
  const antesDeNoche = new Date('2026-10-28T23:30:00Z');
  const despuesDeNoche = new Date('2026-10-29T00:30:00Z');
  record(11, 'formatFileName(1, 2026-10-28T23:30Z) usa el día UTC', formatFileName(1, antesDeNoche) === '2026-10-28_v1.xlsx', formatFileName(1, antesDeNoche));
  record(11, 'formatFileName(1, 2026-10-29T00:30Z) usa el día UTC', formatFileName(1, despuesDeNoche) === '2026-10-29_v1.xlsx', formatFileName(1, despuesDeNoche));
  record(11, 'formatFileName conserva el formato con versión', formatFileName(7, antesDeNoche) === '2026-10-28_v7.xlsx', formatFileName(7, antesDeNoche));
  try {
    seed.list = [{ name: '2026-10-28_v1.xlsx', key: 'data/Málaga/2026-10-28_v1.xlsx' }];
    const mismoDia = await getNextVersion('Málaga', antesDeNoche);
    record(11, 'getNextVersion con v1 del mismo día UTC da versión 2', mismoDia.version === 2, String(mismoDia.version));
    record(11, 'getNextVersion devuelve la carpeta de la provincia', mismoDia.provinciaFolder === 'data/Málaga', mismoDia.provinciaFolder);
    const otroDia = await getNextVersion('Málaga', despuesDeNoche);
    record(11, 'getNextVersion el día UTC siguiente vuelve a la versión 1', otroDia.version === 1, String(otroDia.version));

    // Flujo de POST /upload: la clave y la versión usan el mismo día UTC.
    const hoy = utcDay();
    seed.list = [{ name: `${hoy}_v1.xlsx`, key: `data/Málaga/${hoy}_v1.xlsx` }];
    const antes = argsLog.upload.length;
    const r = await subir(base, [fullRow('Málaga')]);
    const nombre = argsLog.upload[antes]?.[0];
    record(11, 'POST /upload usa el mismo día UTC en la versión y en el nombre', r.status === 200 && nombre === `${hoy}_v2.xlsx`, `${r.status} ${nombre}`);
    record(11, 'POST /upload devuelve la misma clave que sube', r.json?.data?.key === `data/Málaga/${hoy}_v2.xlsx`, String(r.json?.data?.key));
  } finally {
    seed.list = [];
  }
};

const criterio12 = () => {
  let nombre;
  let filas;
  try {
    ({ getProvinciaNameError: nombre } = require('../functions/validateProvincia'));
    ({ validateProvincia: filas } = require('../functions/validateProvincia'));
  } catch (error) {
    record(12, 'existe functions/validateProvincia.js', false, error.message.split('\n')[0]);
    return;
  }
  const validas = ['Activos', 'Málaga', 'Santa Cruz de Tenerife', 'A Coruña', 'Illes Balears', 'Castellón-Castelló'];
  for (const v of validas) record(12, `válida ${v}`, nombre(v) === null, String(nombre(v)));
  const rechazadas = ['a/b', 'a\\b', '..', 'a1', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'active', 'terms', 'drafts',
    'Active', 'Terms', 'Activeness', 'Termsx', 'Terms2', 'a  b', ' a', 'a ', '-a', 'a-', 'a- b', 'Alicante/Alacant', 'a.b', 'a'.repeat(51), 5, ['a'], {}];
  for (const v of rechazadas) record(12, `getProvinciaNameError rechaza ${JSON.stringify(v)?.slice(0, 20)}`, typeof nombre(v) === 'string', String(nombre(v)));
  record(12, '50 letras es válido', nombre('a'.repeat(50)) === null, String(nombre('a'.repeat(50))));
  record(12, 'reservada da Province is reserved', nombre('active') === 'Province is reserved' && nombre('drafts') === 'Province is reserved', String(nombre('active')));
  const via = (rows) => filas(rows);
  const casos = [
    ['ausente', [{}], 'Province is required'], ['vacía', [{ Provincia: '' }], 'Province is required'], ['solo espacios', [{ Provincia: '  ' }], 'Province is required'],
    ['sin filas', [], 'Province is required'], ['primera fila sin provincia', [{}, { Provincia: 'Málaga' }], 'Province is required'],
    ['número', [{ Provincia: 5 }], 'Province is not valid'], ['array', [{ Provincia: ['a', 'b'] }], 'Province is not valid'],
    ['51 letras', [{ Provincia: 'a'.repeat(51) }], 'Province is not valid'], ['reservada', [{ Provincia: 'terms' }], 'Province is reserved'],
    ['dos provincias', [{ Provincia: 'Málaga' }, { Provincia: 'Sevilla' }], 'Excel contains more than one province'],
    ['otra fila con array', [{ Provincia: 'Málaga' }, { Provincia: ['Málaga', 'Sevilla'] }], 'Excel contains more than one province'],
    ['otra fila con número', [{ Provincia: 'Málaga' }, { Provincia: 5 }], 'Excel contains more than one province'],
  ];
  for (const [n, rows, esperado] of casos) record(12, `validateProvincia ${n}`, via(rows).error === esperado, JSON.stringify(via(rows)));
  const nfc = 'Málaga';
  const nfd = nfc.normalize('NFD');
  record(12, 'recorta espacios', via([{ Provincia: ' Málaga ' }]).provincia === nfc, JSON.stringify(via([{ Provincia: ' Málaga ' }])));
  record(12, 'la forma NFD se resuelve a NFC', via([{ Provincia: nfd }]).provincia === nfc, JSON.stringify(via([{ Provincia: nfd }])));
  record(12, 'otra fila igual tras NFC y trim es la misma provincia', via([{ Provincia: nfc }, { Provincia: ` ${nfd} ` }]).provincia === nfc, JSON.stringify(via([{ Provincia: nfc }, { Provincia: ` ${nfd} ` }])));
  record(12, 'otra fila sin la clave se ignora', via([{ Provincia: nfc }, { Municipio: 'x' }]).provincia === nfc, JSON.stringify(via([{ Provincia: nfc }, { Municipio: 'x' }])));
  record(12, 'Málaga y Malaga siguen distintas', via([{ Provincia: nfc }, { Provincia: 'Malaga' }]).error === 'Excel contains more than one province', JSON.stringify(via([{ Provincia: nfc }, { Provincia: 'Malaga' }])));
};

const criterio13 = async (base) => {
  const nfd = 'Málaga'.normalize('NFD');
  const ok = [
    ['Málaga', [fullRow('Málaga')], 'Málaga'], ['con espacios', [fullRow(' Málaga ')], 'Málaga'], ['en NFD', [fullRow(nfd)], 'Málaga'],
    ['varias filas con la misma provincia', [fullRow('Málaga'), fullRow('Málaga')], 'Málaga'],
    ['Santa Cruz de Tenerife', [fullRow('Santa Cruz de Tenerife')], 'Santa Cruz de Tenerife'],
  ];
  for (const [n, rows, carpeta] of ok) {
    const antes = argsLog.upload.length;
    const r = await subir(base, rows);
    const subidas = argsLog.upload.slice(antes);
    const bien = r.status === 200 && subidas.length === 2 && FILE_RE.test(subidas[0][0]) && subidas[0][2] === `data/${carpeta}`
      && subidas[1][0] === `${carpeta}.json` && subidas[1][2] === 'data/active' && r.json?.data?.key === `data/${carpeta}/${subidas[0][0]}`;
    record(13, `éxito ${n}`, bien, `${r.status} ${JSON.stringify(subidas.map((s) => [s[0], s[2]]))}`);
  }
  const malos = [
    ['sin filas', [], 'Province is required'], ['primera fila sin provincia', [fullRow(null), fullRow('Sevilla')], 'Province is required'],
    ['solo espacios', [fullRow('   ')], 'Province is required'],
    ['active', [fullRow('active')], 'Province is reserved'], ['terms', [fullRow('terms')], 'Province is reserved'],
    ['drafts', [fullRow('drafts')], 'Province is reserved'], ['Active (mayúscula)', [fullRow('Active')], 'Province is reserved'],
    ['__proto__', [fullRow('__proto__')], 'Province is not valid'], ['constructor', [fullRow('constructor')], 'Province is not valid'],
    ['con barra', [fullRow('a/b')], 'Province is not valid'], ['con barra invertida', [fullRow('a\\b')], 'Province is not valid'],
    ['con ..', [fullRow('..')], 'Province is not valid'], ['numérica', [fullRow(5)], 'Province is not valid'],
    ['con coma (array)', [fullRow('a,b')], 'Province is not valid'], ['51 letras', [fullRow('a'.repeat(51))], 'Province is not valid'],
    ['dos provincias', [fullRow('Málaga'), fullRow('Sevilla')], 'Excel contains more than one province'],
    ['otra fila con coma', [fullRow('Málaga'), fullRow('Málaga,Sevilla')], 'Excel contains more than one province'],
  ];
  for (const [n, rows, mensaje] of malos) {
    const antes = argsLog.upload.length;
    const listadas = argsLog.list.length;
    const r = await subir(base, rows);
    record(13, `400 ${n}`, r.status === 400 && isEnvelopeError(r) && r.json.error === mensaje && argsLog.upload.length === antes && argsLog.list.length === listadas,
      `${r.status} ${r.json?.error} subidas=${argsLog.upload.length - antes} listados=${argsLog.list.length - listadas}`);
  }
  // Filas con celdas vacías: el flujo de borrador no cambia y conserva data.draftKey.
  const borradores = [
    ['fila posterior sin provincia', [fullRow('Málaga'), fullRow(null)]],
    ['primera fila con otras celdas vacías', [['Málaga', null, null, null, null, null, null, null, null, null, null]]],
  ];
  for (const [n, rows] of borradores) {
    const antes = argsLog.upload.length;
    const r = await subir(base, rows);
    const subidas = argsLog.upload.slice(antes);
    record(13, `borrador ${n}`, r.status === 400 && r.json?.error === 'Some rows have empty fields.' && /^data\/Málaga\/\d{4}-\d{2}-\d{2}_v\d+\.xlsx$/.test(r.json?.data?.draftKey ?? '') && subidas.length === 1,
      `${r.status} ${r.json?.error} draftKey=${r.json?.data?.draftKey} subidas=${subidas.length}`);
  }
};

const criterio14 = async (base) => {
  const buena = 'data/Málaga/2026-10-28_v1.xlsx';
  const nfdKey = `data/${'Málaga'.normalize('NFD')}/2026-10-28_v1.xlsx`;
  const rutas = [
    ['POST /upload/confirm (confirmar)', '/upload/confirm', (k) => ({ draftKey: k, confirmed: true }), 'draftKey', argsLog.update],
    ['POST /upload/confirm (cancelar)', '/upload/confirm', (k) => ({ draftKey: k, confirmed: false }), 'draftKey', argsLog.del],
    ['POST /update-file', '/update-file', (k) => ({ fileName: k }), 'fileName', argsLog.update],
    ['POST /delete-file', '/delete-file', (k) => ({ fileName: k }), 'fileName', argsLog.del],
  ];
  const invalidas = [
    ['data/active/2026-10-28_v1.xlsx', 'data/active/2026-10-28_v1.xlsx'], ['data/terms/x.xlsx', 'data/terms/x.xlsx'],
    ['data/a/b/2026-10-28_v1.xlsx', 'data/a/b/2026-10-28_v1.xlsx'], ['x/Málaga/...', 'x/Málaga/2026-10-28_v1.xlsx'],
    ['data/Málaga/x.json', 'data/Málaga/x.json'], ['data/Málaga/../active/...', 'data/Málaga/../active/2026-10-28_v1.xlsx'],
    ['provincia en NFD', nfdKey], ['más de 120 caracteres', `data/Málaga/${'x'.repeat(120)}.xlsx`],
    ['provincia __proto__', 'data/__proto__/2026-10-28_v1.xlsx'], ['sin extensión', 'data/Málaga/2026-10-28_v1'],
    ['sin prefijo data/', 'Málaga/2026-10-28_v1.xlsx'], ['provincia vacía', 'data//2026-10-28_v1.xlsx'],
  ];
  for (const [n, ruta, cuerpo, campo, log] of rutas) {
    const antes = log.length;
    const r = await call(base, 'POST', ruta, { token: validToken, body: cuerpo(buena) });
    record(14, `${n}: clave válida llega a S3 intacta`, r.status === 200 && log.length === antes + 1 && log[antes][0] === buena, `${r.status} ${JSON.stringify(log[antes])}`);
    for (const [descr, clave] of invalidas) {
      const total = spyTotal();
      const x = await call(base, 'POST', ruta, { token: validToken, body: cuerpo(clave) });
      record(14, `${n}: 400 con ${descr}`, x.status === 400 && x.json?.error === `Invalid ${campo}` && spyTotal() === total, `${x.status} ${x.json?.error} s3=${spyTotal() - total}`);
    }
    for (const valor of [123, ['data/Málaga/2026-10-28_v1.xlsx'], {}, '', null]) {
      const total = spyTotal();
      const x = await call(base, 'POST', ruta, { token: validToken, body: cuerpo(valor) });
      record(14, `${n}: ${JSON.stringify(valor)} mantiene ${campo} is required`, x.status === 400 && x.json?.error === `${campo} is required` && spyTotal() === total, `${x.status} ${x.json?.error}`);
    }
  }
};

// Criterio 15: carga el aws/awsS3connect.js real y parchea S3Client.prototype.send para inspeccionar el Prefix.
// Guarda y restaura los dos módulos de la caché (aws y getNextVersion) para no dejar la red a los demás criterios.
const criterio15 = async () => {
  const { Readable } = require('node:stream');
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
  const awsPath = require.resolve('../aws/awsS3connect.js');
  const nextPath = require.resolve('../functions/getNextVersion.js');
  const guardados = [awsPath, nextPath].map((p) => [p, require.cache[p]]);
  const originalSend = S3Client.prototype.send;
  const claves = [
    'data/active/Málaga.json', 'data/activos/Otra.json', 'data/Santa Cruz/2026-10-01_v1.xlsx', 'data/Santa Cruz de Tenerife/2026-10-05_v3.xlsx',
  ];
  const xlsx = await makeXlsx([fullRow('Santa Cruz')]);
  const prefijos = [];
  const leidas = [];
  const escritas = [];
  try {
    for (const [p] of guardados) delete require.cache[p];
    const realAws = require('../aws/awsS3connect.js');
    const realNext = require('../functions/getNextVersion.js');
    S3Client.prototype.send = async function send(command) {
      if (command instanceof ListObjectsV2Command) {
        prefijos.push(command.input.Prefix);
        return { Contents: claves.filter((k) => k.startsWith(command.input.Prefix)).map((Key) => ({ Key, Size: 10 })) };
      }
      if (command instanceof GetObjectCommand) {
        leidas.push(command.input.Key);
        return { Body: Readable.from([command.input.Key.endsWith('.xlsx') ? xlsx : Buffer.from('[]')]) };
      }
      escritas.push(`${command.constructor.name} ${command.input.Key}`);
      return {};
    };
    const ultimo = () => prefijos[prefijos.length - 1];

    await realAws.getMergedDataInS3Folder('data/active');
    record(15, "getMergedDataInS3Folder('data/active') lista con barra final", ultimo() === 'data/active/', String(ultimo()));
    record(15, 'getMergedDataInS3Folder no lee data/activos/', leidas.length === 1 && leidas[0] === 'data/active/Málaga.json', JSON.stringify(leidas));

    await realAws.listFilesInS3Folder('data/');
    record(15, "listFilesInS3Folder('data/') no duplica la barra", ultimo() === 'data/', String(ultimo()));

    const lista = await realAws.listFilesInS3Folder('data/Santa Cruz');
    record(15, 'listar Santa Cruz solo ve sus archivos', lista.length === 1 && lista[0].key === 'data/Santa Cruz/2026-10-01_v1.xlsx', JSON.stringify(lista));

    const { version } = await realNext.getNextVersion('Santa Cruz', new Date('2026-10-05T12:00:00Z'));
    record(15, 'getNextVersion de Santa Cruz no cuenta Santa Cruz de Tenerife', version === 1 && ultimo() === 'data/Santa Cruz/', `version=${version} prefijo=${ultimo()}`);

    leidas.length = 0;
    await realAws.deleteFileFromS3('data/Santa Cruz/2026-10-02_v2.xlsx');
    record(15, 'deleteFileFromS3 de Santa Cruz solo considera sus archivos', ultimo() === 'data/Santa Cruz/' && leidas.length === 1 && leidas[0] === 'data/Santa Cruz/2026-10-01_v1.xlsx',
      `prefijo=${ultimo()} leidas=${JSON.stringify(leidas)} escritas=${JSON.stringify(escritas)}`);
  } finally {
    S3Client.prototype.send = originalSend;
    for (const [p, entrada] of guardados) {
      delete require.cache[p];
      if (entrada) require.cache[p] = entrada;
    }
  }
};

// ─── Ejecución ───────────────────────────────────────────────────────────────

const main = async () => {
  const { app, root, base } = await startApp();
  await criterio1(base);
  await criterio2();
  await criterio3();
  await criterios45();
  await criterio6(base);
  await criterio7(base, app);
  criterio8(app);
  await criterio9(base, root);
  await criterio10(base);
  await criterio11(base);
  criterio12();
  await criterio13(base);
  await criterio14(base);
  await criterio15();

  let fallos = 0;
  for (const id of Object.keys(criteria).sort()) {
    const { total, fallos: lista } = criteria[id];
    console.log(`Criterio ${id}: ${lista.length === 0 ? 'PASA' : 'FALLA'} (${total - lista.length}/${total})`);
    for (const f of lista.slice(0, 8)) console.log(`  - ${f}`);
    if (lista.length > 8) console.log(`  ... y ${lista.length - 8} más`);
    fallos += lista.length;
  }
  // Un criterio que no registró ningún caso no se vería arriba: se exige que los criterios 1 a 15 hayan registrado algo.
  const vacios = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter((id) => !criteria[id] || criteria[id].total === 0);
  if (vacios.length > 0) console.log(`FALLA: el criterio ${vacios.join(', ')} no registró ningún caso (criterio vacío)`);
  console.log(fallos === 0 && vacios.length === 0 ? 'Resultado: todo pasa' : `Resultado: ${fallos} caso(s) fallan${vacios.length > 0 ? `, ${vacios.length} criterio(s) vacío(s)` : ''}`);
  return fallos === 0 && vacios.length === 0 ? 0 : 1;
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Error del script:', error.message);
    process.exit(2);
  });
