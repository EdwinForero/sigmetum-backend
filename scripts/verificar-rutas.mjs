// Verificación repetible de las rutas (M21: rutas públicas y protegidas) y de la validación de /send-email y imageKey.
// Uso: node scripts/verificar-rutas.mjs   (o: npm run verificar:rutas)
// Reproduce la pila de producción de index.js (auth, data y content bajo el mismo prefijo, con el errorHandler
// al final) con S3 y SMTP sustituidos por espías: no hay red ni credenciales reales.
// Criterio 1: las ocho rutas públicas responden sin token (nunca 401).
// Criterios 2 a 5: límite y validación de POST /send-email (anónimo) y validación de imageKey (GET y DELETE).
// Criterio 6: las nueve rutas protegidas dan 401 sin token, con token inválido y con token caducado, también
//   /upload y /upload-image con multipart (tokenAuth corre antes que multer) y las variantes de mayúsculas y barra final.
// Criterio 7: todas las rutas mutantes de la pila real dan 401 y no llaman a S3 ni a SMTP (salvo POST /log y POST /send-email).
// Criterio 8: estructura. Tabla de clasificación contra la pila real (app._router.stack), tokenAuth como primer manejador
//   de cada ruta protegida, ausente en las públicas, sin use(tokenAuth) a nivel de router, y lectura ESTÁTICA de index.js.
// Criterio 9: Authorization inválido o caducado en las rutas abiertas responde igual que sin token; rutas inexistentes y
//   métodos no definidos dan el 404 por defecto de Express (estado transitorio hasta la entrega 3: 404 con envoltorio).
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
const { tokenAuth } = require('../functions/tokenAuthentication');

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
  return { app, base: `http://127.0.0.1:${server.address().port}${PREFIX}` };
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

// Lectura estática de index.js: los montajes deben ser authRoutes, dataRoutes, contentRoutes y errorHandler, en ese
// orden, y no debe haber otros app.use/app.all con rutas (solo /healthcheck, que es público). Los montajes
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
    } else if (/^\s*(morgan|cors|compression)\(/.test(rest) || /^\s*express\.json\(\)/.test(rest)) {
      order.push('middleware');
    } else {
      problems.push(`index.js tiene un app.use no reconocido: ${rest.trim().slice(0, 50)}`);
    }
  }
  if (mounts.join(',') !== 'authRoutes,dataRoutes,contentRoutes') problems.push(`Montajes de index.js: ${mounts.join(', ') || 'ninguno'} (esperado: authRoutes, dataRoutes, contentRoutes)`);
  if (order.filter((o) => o === 'errorHandler').length !== 1 || order[order.length - 1] !== 'errorHandler') problems.push('errorHandler debe montarse una vez y al final de index.js');
  for (const [name, file] of [['authRoutes', './routes/auth'], ['dataRoutes', './routes/data'], ['contentRoutes', './routes/content']]) {
    if (!source.includes(`const ${name} = require('${file}');`)) problems.push(`index.js no importa ${name} desde ${file}`);
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
  const problemasIndex = checkIndexStatic();
  record(8, 'index.js (estático): montajes y orden', problemasIndex.length === 0, problemasIndex.join('; '));
};

// ─── Criterio 9: tokens en las rutas abiertas y rutas inexistentes ───────────

const criterio9 = async (base) => {
  const abiertas = [['POST', '/send-email', {}], ['GET', '/get-image?imageKey=foto.jpg'], ['GET', '/list-images'], ['GET', '/list-terms']];
  for (const [method, path, body] of abiertas) {
    const sinToken = await call(base, method, path, { body, ip: nextIp() });
    for (const [estado, token] of TOKEN_STATES.slice(1)) {
      const r = await call(base, method, path, { token, body, ip: nextIp() });
      record(9, `${estado} ${method} ${path} responde como sin token`, r.status !== 401 && r.status === sinToken.status, `${r.status} (sin token: ${sinToken.status})`);
    }
  }
  // Estado transitorio hasta la entrega 3: el 404 es el de Express por defecto (HTML, sin envoltorio).
  for (const [method, path] of [['GET', '/no-existe'], ['DELETE', '/list-terms'], ['POST', '/no-existe']]) {
    for (const [estado, token] of [['sin token', undefined], ['token válido', validToken]]) {
      const r = await call(base, method, path, { token, body: method === 'GET' ? undefined : {} });
      record(9, `${estado} ${method} ${path} da 404`, r.status === 404, String(r.status));
    }
  }
};

// ─── Ejecución ───────────────────────────────────────────────────────────────

const main = async () => {
  const { app, base } = await startApp();
  await criterio1(base);
  await criterio2();
  await criterio3();
  await criterios45();
  await criterio6(base);
  await criterio7(base, app);
  criterio8(app);
  await criterio9(base);

  let fallos = 0;
  for (const id of Object.keys(criteria).sort()) {
    const { total, fallos: lista } = criteria[id];
    console.log(`Criterio ${id}: ${lista.length === 0 ? 'PASA' : 'FALLA'} (${total - lista.length}/${total})`);
    for (const f of lista.slice(0, 8)) console.log(`  - ${f}`);
    if (lista.length > 8) console.log(`  ... y ${lista.length - 8} más`);
    fallos += lista.length;
  }
  // Un criterio que no registró ningún caso no se vería arriba: se exige que los criterios 1 a 9 hayan registrado algo.
  const vacios = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((id) => !criteria[id] || criteria[id].total === 0);
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
