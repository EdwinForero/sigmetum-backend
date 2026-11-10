// JWKS de Cognito: disponibilidad (503) y límite de peticiones al JWKS (criterio 5), medidos contra aws-jwt-verify real
// con el JWKS simulado de helpers/cognito.js. El verificador guarda su caché y su penalización (10 s por URI) en memoria:
// cada test crea una app nueva con un verificador nuevo, para empezar sin caché y sin penalización.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, llamar } = require('./helpers/simulados');
const { jwksControl, reiniciarJwks, claimsAcceso, firmar, validToken, JWKS_URI } = require('./helpers/cognito');

const AUTH = '/api/v1/auth';
const MENSAJE_503 = 'Authentication service unavailable';

// App con verificador propio: el middleware y las rutas de auth se vuelven a cargar (los demás routers conservan el suyo).
const appFresca = () => {
    for (const modulo of ['middleware/tokenAuthentication.js', 'routes/auth.js', 'app.js']) delete require.cache[path.join(ROOT, modulo)];
    return require('../app');
};
const kidDesconocido = (n) => firmar(claimsAcceso(), { kid: `kid-desconocido-${n}` });

beforeEach(() => reiniciarJwks());

describe('Cognito: JWKS caído y sin caché', () => {
    test('da 503 con el mensaje fijo, sin texto de la librería ni el token, y registra una sola línea con el nombre del error', async (t) => {
        const logs = t.mock.method(console, 'error', () => {});
        jwksControl.modo = 'caido';
        const r = await llamar(appFresca(), 'GET', AUTH, { token: validToken });
        assert.equal(r.status, 503);
        assert.deepEqual(r.json, { success: false, error: MENSAJE_503 });
        for (const prohibido of [validToken, 'caido', 'simulado', 'jwks', 'amazonaws', 'FetchError']) assert.ok(!r.text.includes(prohibido));
        assert.equal(logs.mock.callCount(), 1);
        assert.deepEqual(logs.mock.calls[0].arguments, ['[auth] JWKS no disponible:', 'FetchError']);
    });

    test('20 peticiones seguidas hacen como mucho 1 petición al JWKS y el resto da 503 (fetcher envuelto con la penalización)', async (t) => {
        t.mock.method(console, 'error', () => {});
        jwksControl.modo = 'caido';
        const app = appFresca();
        for (let i = 0; i < 20; i += 1) {
            const r = await llamar(app, 'GET', AUTH, { token: validToken });
            assert.equal(r.status, 503);
            assert.deepEqual(r.json, { success: false, error: MENSAJE_503 });
        }
        assert.equal(jwksControl.peticiones, 1);
        assert.deepEqual(jwksControl.uris, [JWKS_URI]);
    });

    test('registra una línea por cada 503, sin token, URI ni cabeceras', async (t) => {
        const logs = t.mock.method(console, 'error', () => {});
        jwksControl.modo = 'caido';
        const app = appFresca();
        for (let i = 0; i < 3; i += 1) await llamar(app, 'GET', AUTH, { token: validToken });
        assert.equal(logs.mock.callCount(), 3);
        const nombres = logs.mock.calls.map((c) => c.arguments[1]);
        assert.deepEqual(nombres, ['FetchError', 'WaitPeriodNotYetEndedJwkError', 'WaitPeriodNotYetEndedJwkError']);
        for (const llamada of logs.mock.calls) {
            const texto = llamada.arguments.join(' ');
            assert.ok(!texto.includes(validToken) && !texto.includes('amazonaws') && !texto.toLowerCase().includes('bearer'));
        }
    });

    test('/healthcheck y una ruta pública siguen respondiendo', async (t) => {
        t.mock.method(console, 'error', () => {});
        jwksControl.modo = 'caido';
        const app = appFresca();
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 503);
        assert.equal((await llamar(app, 'GET', '/healthcheck')).status, 200);
        assert.equal((await llamar(app, 'GET', '/api/v1/list-files')).status, 200);
    });

    test('un token sin cabecera sigue dando 401 No token provided (no consulta el JWKS)', async () => {
        jwksControl.modo = 'caido';
        const r = await llamar(appFresca(), 'GET', AUTH);
        assert.equal(r.status, 401);
        assert.equal(r.json.error, 'No token provided');
        assert.equal(jwksControl.peticiones, 0);
    });

    test('recuperación: pasada la espera de 10 s y con el JWKS de vuelta, el mismo token da 200', async (t) => {
        t.mock.method(console, 'error', () => {});
        t.mock.timers.enable({ apis: ['setTimeout'] });
        jwksControl.modo = 'caido';
        const app = appFresca();
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 503);
        jwksControl.modo = 'ok';
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 503, 'dentro de la espera sigue en 503');
        assert.equal(jwksControl.peticiones, 1);
        t.mock.timers.tick(10_000);
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        assert.equal(jwksControl.peticiones, 2);
    });
});

describe('Cognito: caché caliente con el JWKS caído', () => {
    test('un token con kid cacheado se sigue verificando sin ir a la red', async () => {
        const app = appFresca();
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        assert.equal(jwksControl.peticiones, 1);
        jwksControl.modo = 'caido';
        for (let i = 0; i < 5; i += 1) assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        assert.equal(jwksControl.peticiones, 1);
    });
});

describe('Cognito: límite de peticiones al JWKS con un kid desconocido (criterio 5)', () => {
    test('(a) 20 peticiones seguidas con el mismo kid desconocido y sin caché hacen como mucho 1 petición', async (t) => {
        t.mock.method(console, 'error', () => {});
        const app = appFresca();
        const estados = [];
        for (let i = 0; i < 20; i += 1) {
            const token = kidDesconocido(0);
            const r = await llamar(app, 'GET', AUTH, { token });
            estados.push(r.status);
            assert.deepEqual(Object.keys(r.json).sort(), ['error', 'success']);
            for (const prohibido of [token, 'kid-desconocido', 'jwks', 'amazonaws']) assert.ok(!r.text.includes(prohibido));
        }
        assert.ok(jwksControl.peticiones <= 1, `peticiones: ${jwksControl.peticiones}`);
        assert.equal(estados[0], 401);
        assert.ok(estados.slice(1).every((s) => s === 503), `estados: ${estados}`);
    });

    test('(b) con la caché caliente, 20 peticiones con un kid desconocido hacen como mucho 1 petición más que la de calentar', async (t) => {
        t.mock.method(console, 'error', () => {});
        const app = appFresca();
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        const calentar = jwksControl.peticiones;
        for (let i = 0; i < 20; i += 1) await llamar(app, 'GET', AUTH, { token: kidDesconocido(0) });
        assert.ok(jwksControl.peticiones - calentar <= 1, `peticiones tras calentar: ${jwksControl.peticiones - calentar}`);
    });

    test('(c) 20 peticiones con un kid distinto cada una hacen como mucho 1 petición (la penalización es por URI)', async (t) => {
        t.mock.method(console, 'error', () => {});
        const app = appFresca();
        const estados = [];
        for (let i = 0; i < 20; i += 1) estados.push((await llamar(app, 'GET', AUTH, { token: kidDesconocido(i) })).status);
        assert.ok(jwksControl.peticiones <= 1, `peticiones: ${jwksControl.peticiones}`);
        assert.equal(estados[0], 401);
        assert.ok(estados.slice(1).every((s) => s === 503), `estados: ${estados}`);
    });

    test('un kid desconocido penaliza solo a los kid NUEVOS: el kid cacheado sigue en 200 y un kid nuevo da 503 dentro de la espera', async (t) => {
        t.mock.method(console, 'error', () => {});
        const app = appFresca();
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        assert.equal((await llamar(app, 'GET', AUTH, { token: kidDesconocido(0) })).status, 401);
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        assert.equal((await llamar(app, 'GET', AUTH, { token: kidDesconocido(1) })).status, 503);
    });

    test('tras una rotación de claves, un kid nuevo publicado en el JWKS se acepta pasada la espera', async (t) => {
        t.mock.method(console, 'error', () => {});
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const app = appFresca();
        assert.equal((await llamar(app, 'GET', AUTH, { token: validToken })).status, 200);
        const nuevo = { ...jwksControl.jwks.keys[0], kid: 'kid-rotado' };
        assert.equal((await llamar(app, 'GET', AUTH, { token: firmar(claimsAcceso(), { kid: 'kid-rotado' }) })).status, 401);
        jwksControl.jwks = { keys: [jwksControl.jwks.keys[0], nuevo] };
        assert.equal((await llamar(app, 'GET', AUTH, { token: firmar(claimsAcceso(), { kid: 'kid-rotado' }) })).status, 503);
        t.mock.timers.tick(10_000);
        assert.equal((await llamar(app, 'GET', AUTH, { token: firmar(claimsAcceso(), { kid: 'kid-rotado' }) })).status, 200);
    });
});
