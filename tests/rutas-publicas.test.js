// Criterio 1 del antiguo script de verificación de rutas (retirado): las ocho rutas públicas responden sin token (nunca 401).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, isEnvelopeError, nextIp, reiniciar } = require('./helpers/simulados');

const app = appNueva();
beforeEach(reiniciar);

const publicas = [
    ['POST', '/send-email', 400, {}], ['GET', '/get-image?imageKey=foto.jpg', 200], ['GET', '/list-images', 200],
    ['GET', '/list-terms', 200], ['GET', '/list-files', 200], ['GET', '/get-data/data/active/Malaga.json', 200],
    ['GET', '/get-merged-data', 200], ['POST', '/log', 400, {}],
];

test('la lista de rutas públicas tiene las ocho rutas', () => {
    assert.equal(publicas.length, 8);
});

for (const [method, path, esperado, body] of publicas) {
    test(`sin token ${method} ${path}`, async () => {
        const r = await llamar(app, method, `/api/v1${path}`, { body, ip: nextIp() });
        assert.notEqual(r.status, 401);
        assert.equal(r.status, esperado, `${r.status} ${r.json?.error ?? ''}`.trim());
    });
}

test('POST /log llega a su manejador con envoltorio', async () => {
    const log = await llamar(app, 'POST', '/api/v1/log', { body: {} });
    assert.equal(log.status, 400);
    assert.ok(isEnvelopeError(log));
});
