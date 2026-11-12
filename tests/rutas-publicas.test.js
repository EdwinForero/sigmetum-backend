// Criterio 1 del antiguo script de verificación de rutas (retirado): las siete rutas públicas responden sin token (nunca 401).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, nextIp, reiniciar, seed, spyTotal } = require('./helpers/simulados');

const app = appNueva();
beforeEach(reiniciar);

const publicas = [
    ['POST', '/send-email', 400, {}], ['GET', '/get-image?imageKey=foto.jpg', 200], ['GET', '/list-images', 200],
    ['GET', '/list-terms', 200], ['GET', '/list-files', 200], ['GET', '/get-data/data/active/Malaga.json', 200],
    ['GET', '/get-merged-data', 200],
];

test('la lista de rutas públicas tiene las siete rutas', () => {
    assert.equal(publicas.length, 7);
});

// La lista de destinatarios (data/contact/recipients.json) es privada: no sale como provincia ni por la lectura pública.
test('GET /list-files no agrupa data/contact/ como provincia', async () => {
    seed.list = [
        { name: 'recipients.json', key: 'data/contact/recipients.json' },
        { name: '2026-10-01_v1.xlsx', key: 'data/Málaga/2026-10-01_v1.xlsx' },
    ];
    const r = await llamar(app, 'GET', '/api/v1/list-files', { ip: nextIp() });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json.data), ['Málaga']);
    assert.ok(!JSON.stringify(r.json).includes('recipients.json'));
});

// Caracterización (ya pasaba antes de la lista de destinatarios): isValidGetDataKey solo deja pasar versiones y activos.
test('GET /get-data/data/contact/recipients.json da 400 sin llamar a S3', async () => {
    const r = await llamar(app, 'GET', '/api/v1/get-data/data/contact/recipients.json', { ip: nextIp() });
    assert.equal(r.status, 400);
    assert.equal(spyTotal(), 0);
});

for (const [method, path, esperado, body] of publicas) {
    test(`sin token ${method} ${path}`, async () => {
        const r = await llamar(app, method, `/api/v1${path}`, { body, ip: nextIp() });
        assert.notEqual(r.status, 401);
        assert.equal(r.status, esperado, `${r.status} ${r.json?.error ?? ''}`.trim());
    });
}
