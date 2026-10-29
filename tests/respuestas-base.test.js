// Criterio 9 del antiguo script de verificación de rutas (retirado): tokens en las rutas abiertas y respuestas base (404 con envoltorio,
// /healthcheck, OPTIONS, CORS y JSON mal formado). Los nombres de los casos son los mismos que los del script.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, isEnvelopeError, nextIp, reiniciar, validToken, invalidToken, expiredToken, TOKEN_STATES } = require('./helpers/simulados');

const PREFIX = '/api/v1';
const app = appNueva();
beforeEach(reiniciar);

// Las respuestas de error y el rechazo de CORS escriben en console.error/console.warn: se silencian en el test.
const silenciar = (t) => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
};

const ESTADOS = [['sin token', undefined], ['token válido', validToken], ['token inválido', invalidToken], ['token caducado', expiredToken]];
const es404 = (r) => r.status === 404 && /application\/json/.test(r.headers['content-type'] ?? '') && r.json?.success === false && r.json?.error === 'Not found';
const resumen = (r) => `${r.status} ${r.headers['content-type']} ${JSON.stringify(r.json)}`;
const cuerpo = (method) => (method === 'GET' ? undefined : {});

test('las listas de casos del criterio 9 no están vacías', () => {
    assert.equal(TOKEN_STATES.length, 3);
    assert.equal(ESTADOS.length, 4);
});

const abiertas = [['POST', '/send-email', {}], ['GET', '/get-image?imageKey=foto.jpg'], ['GET', '/list-images'], ['GET', '/list-terms']];
for (const [method, path, body] of abiertas) {
    for (const [estado, token] of TOKEN_STATES.slice(1)) {
        test(`${estado} ${method} ${path} responde como sin token`, async () => {
            const sinToken = await llamar(app, method, `${PREFIX}${path}`, { body, ip: nextIp() });
            const r = await llamar(app, method, `${PREFIX}${path}`, { token, body, ip: nextIp() });
            assert.notEqual(r.status, 401);
            assert.equal(r.status, sinToken.status, `${r.status} (sin token: ${sinToken.status})`);
        });
    }
}

// a. Rutas inexistentes bajo el prefijo, con todos los métodos y estados de token.
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const [estado, token] of ESTADOS) {
        test(`a. ${estado} ${method} /no-existe da 404 con envoltorio`, async () => {
            const r = await llamar(app, method, `${PREFIX}/no-existe`, { token, body: cuerpo(method) });
            assert.ok(es404(r), resumen(r));
        });
    }
}

// b. Método no definido en una ruta existente: 404, no 405, sin cabecera Allow.
for (const [method, path] of [['DELETE', '/list-terms'], ['POST', '/list-images'], ['GET', '/upload']]) {
    for (const [estado, token] of ESTADOS) {
        test(`b. ${estado} ${method} ${path} da 404 con envoltorio`, async () => {
            const r = await llamar(app, method, `${PREFIX}${path}`, { token, body: cuerpo(method) });
            assert.ok(es404(r) && !('allow' in r.headers), `${resumen(r)} allow=${r.headers.allow}`);
        });
    }
}

// c. Mensaje fijo: no refleja ruta, método ni consulta.
test('c. el error es idéntico en dos rutas distintas', async () => {
    const c1 = await llamar(app, 'GET', `${PREFIX}/no-existe/%3Cscript%3Ealert(1)%3C%2Fscript%3E?x=1`);
    const c2 = await llamar(app, 'POST', `${PREFIX}/otra-ruta-distinta`, { body: {} });
    assert.ok(es404(c1) && es404(c2) && c1.json.error === c2.json.error, `${resumen(c1)} | ${resumen(c2)}`);
});
test('c. el error no refleja la ruta ni la consulta', async () => {
    const c1 = await llamar(app, 'GET', `${PREFIX}/no-existe/%3Cscript%3Ealert(1)%3C%2Fscript%3E?x=1`);
    assert.ok(typeof c1.json?.error === 'string' && !/script|no-existe|x=1/i.test(c1.json.error), resumen(c1));
});

// d. Fuera del prefijo.
for (const path of ['/', '/otra', '/api/v2/x']) {
    test(`d. GET ${path} (fuera del prefijo) da 404 con envoltorio`, async () => {
        const r = await llamar(app, 'GET', path);
        assert.ok(es404(r), resumen(r));
    });
}

// e. /healthcheck, OPTIONS, Origin permitido y no permitido.
test('e. GET /healthcheck da 200 ok (texto, no JSON)', async () => {
    const r = await llamar(app, 'GET', '/healthcheck');
    assert.ok(r.status === 200 && r.text === 'ok' && !/json/.test(r.headers['content-type'] ?? ''), `${r.status} ${r.text}`);
});
test('e. OPTIONS con Origin permitido da 204 con CORS', async () => {
    const r = await llamar(app, 'OPTIONS', `${PREFIX}/no-existe`, { headers: { Origin: 'http://localhost', 'Access-Control-Request-Method': 'GET' } });
    assert.ok(r.status === 204 && r.headers['access-control-allow-origin'] === 'http://localhost', `${r.status} acao=${r.headers['access-control-allow-origin']}`);
});
test('e. GET /no-existe con Origin permitido lleva la cabecera CORS', async () => {
    const r = await llamar(app, 'GET', `${PREFIX}/no-existe`, { headers: { Origin: 'http://localhost' } });
    assert.equal(r.headers['access-control-allow-origin'], 'http://localhost');
});
test('e. Origin no permitido da 403 Origin not allowed sin el origen (no Not found)', async (t) => {
    silenciar(t);
    const r = await llamar(app, 'GET', `${PREFIX}/list-terms`, { headers: { Origin: 'http://otro.example' } });
    assert.ok(r.status === 403 && r.json?.success === false && r.json?.error === 'Origin not allowed' && !JSON.stringify(r.json).includes('otro.example'), resumen(r));
});
test('e. Preflight OPTIONS con Origin no permitido da 403 sin el origen', async (t) => {
    silenciar(t);
    const r = await llamar(app, 'OPTIONS', `${PREFIX}/list-terms`, { headers: { Origin: 'http://otro.example', 'Access-Control-Request-Method': 'GET' } });
    assert.ok(r.status === 403 && r.json?.error === 'Origin not allowed' && !JSON.stringify(r.json).includes('otro.example'), resumen(r));
});

// f. JSON mal formado da 400 con envoltorio y texto fijo, sin el mensaje del parser.
test('f. JSON mal formado da 400 Invalid JSON sin detalle del parser', async (t) => {
    silenciar(t);
    const r = await llamar(app, 'POST', `${PREFIX}/send-email`, { rawBody: '{', headers: { 'Content-Type': 'application/json' }, ip: nextIp() });
    assert.ok(r.status === 400 && isEnvelopeError(r) && r.json.error === 'Invalid JSON' && !/Unexpected|position/.test(r.json.error), resumen(r));
});
