// B6: el limitador de send-email (5) se declara con `limit` (no con `max`). El comportamiento
// del límite de send-email ya se prueba en send-email.test.js.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appNueva, llamar, nextIp, ROOT } = require('./helpers/simulados');

const app = appNueva();
const mail = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };

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
