// Criterios 6 y 7 del antiguo script de verificación de rutas (retirado): las nueve rutas protegidas dan 401 en los tres estados de token
// y todas las rutas mutantes de la pila real dan 401 sin llamar a S3 ni a SMTP. Los nombres de los casos son los del script.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { appNueva, llamar, isEnvelopeError, reiniciar, spyTotal, TOKEN_STATES, validToken } = require('./helpers/simulados');
const { declaredRoutes } = require('./helpers/pila');

const PREFIX = '/api/v1';
const app = appNueva();
beforeEach(reiniciar);

const PROTECTED = [
    ['GET', '/auth'], ['POST', '/upload'], ['POST', '/upload/confirm'], ['POST', '/update-file'], ['POST', '/delete-file'],
    ['POST', '/upload-image'], ['DELETE', '/delete-image'], ['POST', '/upload-term'], ['DELETE', '/delete-term'],
];
const esperado = (r, mensaje) => r.status === 401 && r.json?.error === mensaje;

test('la lista de rutas protegidas tiene las nueve rutas y los tres estados de token', () => {
    assert.equal(PROTECTED.length, 9);
    assert.equal(TOKEN_STATES.length, 3);
});

for (const [method, path] of PROTECTED) {
    for (const [estado, token, mensaje] of TOKEN_STATES) {
        test(`${estado} ${method} ${path}`, async () => {
            const r = await llamar(app, method, `${PREFIX}${path}`, { token, body: method === 'GET' ? undefined : {} });
            assert.ok(esperado(r, mensaje), `${r.status} ${r.json?.error}`);
            assert.equal(spyTotal(), 0);
        });
    }
}

// Orden de middleware: tokenAuth corre antes que multer (si multer corriera primero, un multipart roto daría 400).
for (const path of ['/upload', '/upload-image']) {
    for (const [estado, token, mensaje] of TOKEN_STATES) {
        test(`multipart real ${estado} POST ${path}`, async () => {
            let req = request(app).post(`${PREFIX}${path}`);
            if (token) req = req.set('Authorization', `Bearer ${token}`);
            const res = await req.attach('file', Buffer.from('contenido'), 'a.xlsx').field('title', 'prueba');
            assert.ok(res.status === 401 && res.body?.error === mensaje, `${res.status} ${res.body?.error}`);
            assert.equal(spyTotal(), 0);
        });
        test(`multipart sin boundary ${estado} POST ${path}`, async () => {
            let req = request(app).post(`${PREFIX}${path}`).set('Content-Type', 'multipart/form-data');
            if (token) req = req.set('Authorization', `Bearer ${token}`);
            const res = await req.send('sin boundary');
            assert.ok(res.status === 401 && res.body?.error === mensaje, `${res.status} ${res.body?.error}`);
            assert.equal(spyTotal(), 0);
        });
    }
}

for (const variante of ['/UPLOAD', '/upload/']) {
    for (const [estado, token, mensaje] of TOKEN_STATES) {
        test(`${estado} POST ${variante}`, async () => {
            const r = await llamar(app, 'POST', `${PREFIX}${variante}`, { token, body: {} });
            assert.ok(esperado(r, mensaje), `${r.status} ${r.json?.error}`);
        });
    }
}

// Controles positivos: con token válido se llega al manejador (el 401 no es un efecto de otra cosa).
test('control: GET /auth con token válido da 200', async () => {
    const r = await llamar(app, 'GET', `${PREFIX}/auth`, { token: validToken });
    assert.equal(r.status, 200);
});
test('control: POST /upload/confirm con token válido llega al manejador (400)', async () => {
    const r = await llamar(app, 'POST', `${PREFIX}/upload/confirm`, { token: validToken, body: {} });
    assert.equal(r.status, 400);
    assert.ok(isEnvelopeError(r));
});

// Criterio 7: todas las mutantes de la pila real (declaredRoutes recorre app._router.stack, también router.route()).
const { routes } = declaredRoutes(app);
const mutantes = routes.filter((r) => r.method !== 'GET');

test('hay rutas mutantes en la pila', () => assert.ok(mutantes.length > 0, 'la pila no tiene rutas mutantes'));

for (const route of mutantes) {
    if (['POST /log', 'POST /send-email'].includes(`${route.method} ${route.path}`)) continue;
    const path = route.path.replace(/:\w+(\(\*\))?/g, 'x');
    for (const [estado, token] of TOKEN_STATES) {
        test(`${estado} ${route.method} ${route.path}`, async () => {
            const r = await llamar(app, route.method, `${PREFIX}${path}`, { token, body: {} });
            assert.equal(r.status, 401, `${r.status}`);
            assert.equal(spyTotal(), 0, `llamadas=${spyTotal()}`);
        });
    }
}
