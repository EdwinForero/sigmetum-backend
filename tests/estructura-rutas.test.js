// Criterio 8 del antiguo script de verificación de rutas (retirado): estructura exacta de la pila de app.js real (sin réplicas).
// Los nombres de los casos son los del script; los dos casos estáticos (montajes y orden, y marcadores de CORS) se
// sustituyen por la pila exacta de capas y por el comportamiento de CORS (ver también respuestas-base y errores-controlados).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { appNueva } = require('./helpers/simulados');
const { declaredRoutes } = require('./helpers/pila');

const app = appNueva();
// notFound y errorHandler se requieren después de appNueva(): son los mismos módulos que cargó app.js.
const notFound = require('../middleware/notFound');
const errorHandler = require('../middleware/errorHandler');
const { tokenAuth } = require('../middleware/tokenAuthentication');
const authRoutes = require('../routes/auth');
const dataRoutes = require('../routes/data');
const contentRoutes = require('../routes/content');

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

// Pila de nivel app esperada, en orden exacto (Express 4: Layer.name = fn.name || '<anonymous>').
const CAPAS_APP = ['query', 'expressInit', '<anonymous>', 'logger', 'corsMiddleware', 'jsonParser', 'compression', 'router', 'router', 'router', 'notFound', 'errorHandler'];
// Capas internas que no son rutas dentro de cada router: hoy ninguna.
const CAPAS_INTERNAS = [[], [], []];

const stack = app._router.stack;
const { routes, routerLevelAuth } = declaredRoutes(app);
const declared = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]));

test('la tabla de rutas y la pila declarada no están vacías', () => {
    assert.equal(Object.keys(ROUTES).length, 17);
    assert.ok(routes.length > 0);
});

for (const id of declared.keys()) {
    test(`ruta clasificada ${id}`, () => assert.ok(id in ROUTES, 'no está en la tabla ROUTES'));
}
for (const id of Object.keys(ROUTES)) {
    test(`ruta de la tabla existe ${id}`, () => assert.ok(declared.has(id), 'la tabla la lista y no existe en la pila'));
}
for (const [id, kind] of Object.entries(ROUTES)) {
    if (kind === 'protected') {
        test(`tokenAuth es el primer manejador de ${id}`, () => assert.equal(declared.get(id)?.handlers[0], tokenAuth));
    } else {
        test(`${id} pública sin tokenAuth`, () => assert.ok(declared.has(id) && !declared.get(id).handlers.includes(tokenAuth), 'lleva tokenAuth'));
    }
}

test('sin use(tokenAuth) a nivel de router', () => {
    assert.equal(routerLevelAuth.length, 0, `hay ${routerLevelAuth.length} en ${routerLevelAuth.join(', ')}`);
});

test('pila: notFound y errorHandler son las dos últimas capas (en ese orden)', () => {
    const ultimas = stack.slice(-2).map((layer) => layer.handle);
    assert.equal(ultimas[0], notFound);
    assert.equal(ultimas[1], errorHandler);
});

test('pila: los nombres de las capas de nivel app son exactamente los esperados', () => {
    assert.deepEqual(stack.map((layer) => layer.name), CAPAS_APP);
});

test('pila: los tres routers son auth, data y content, en ese orden, bajo el prefijo /api/v1', () => {
    const routers = stack.filter((layer) => layer.name === 'router');
    assert.deepEqual(routers.map((layer) => layer.handle), [authRoutes, dataRoutes, contentRoutes]);
    for (const layer of routers) assert.ok(layer.regexp.test('/api/v1/auth'), `${layer.regexp} no casa con /api/v1`);
    assert.ok(!routers[0].regexp.test('/otro'));
});

test('pila: /healthcheck casa con su capa y responde ok', async () => {
    const layer = stack[2];
    assert.equal(layer.name, '<anonymous>');
    assert.ok(layer.regexp.test('/healthcheck'));
    assert.ok(!layer.regexp.test('/api/v1'));
    const res = await request(app).get('/healthcheck');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'ok');
});

test('pila: trust proxy vale 1', () => assert.equal(app.get('trust proxy'), 1));

test('pila: los routers no tienen capas internas que no sean rutas', () => {
    const internas = stack.filter((layer) => layer.name === 'router').map((layer) => layer.handle.stack.filter((l) => !l.route).map((l) => l.name));
    assert.deepEqual(internas, CAPAS_INTERNAS);
});
