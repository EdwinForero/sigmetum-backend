// B6: los limitadores de login (10) y de send-email (5) se declaran con `limit` (no con `max`). El comportamiento
// del límite de send-email ya se prueba en send-email.test.js.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appNueva, llamar, nextIp, ROOT } = require('./helpers/simulados');

const app = appNueva();
const MENSAJE = 'Too many login attempts. Please try again in 15 minutes.';
const mail = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };

describe('B6: limitador de login', () => {
    const r = {};
    before(async () => {
        const ip = nextIp();
        r.statuses = [];
        for (let i = 1; i <= 10; i += 1) {
            r.ultima = await llamar(app, 'POST', '/api/v1/log', { body: { username: 'nadie', password: 'x' }, ip });
            r.statuses.push(r.ultima.status);
        }
        r.once = await llamar(app, 'POST', '/api/v1/log', { body: { username: 'nadie', password: 'x' }, ip });
    });
    test('las 10 primeras dan 401 y la 11.ª da 429 con el mensaje', () => {
        assert.ok(r.statuses.every((s) => s === 401), r.statuses.join(','));
        assert.equal(r.once.status, 429);
        assert.equal(r.once.json.error, MENSAJE);
    });
    test('cabeceras ratelimit-limit 10 y ratelimit-policy 10;w=900', () => {
        assert.equal(r.ultima.headers['ratelimit-limit'], '10');
        assert.equal(r.ultima.headers['ratelimit-policy'], '10;w=900');
    });
});

describe('B6: limitador de send-email', () => {
    test('cabeceras ratelimit-limit 5 y ratelimit-policy 5;w=900', async () => {
        const res = await llamar(app, 'POST', '/api/v1/send-email', { body: mail, ip: nextIp() });
        assert.equal(res.headers['ratelimit-limit'], '5');
        assert.equal(res.headers['ratelimit-policy'], '5;w=900');
    });
});

describe('B6: estilo', () => {
    for (const archivo of ['routes/auth.js', 'routes/content.js']) {
        test(`${archivo} no usa la opción max`, () => {
            const codigo = fs.readFileSync(path.join(ROOT, archivo), 'utf8');
            assert.ok(!/\bmax\s*:/.test(codigo));
        });
    }
});
