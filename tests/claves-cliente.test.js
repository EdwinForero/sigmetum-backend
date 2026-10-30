// Criterio 14 del antiguo script de verificación de rutas (retirado): claves del cliente en upload/confirm, update-file y delete-file
// (formato, NFC, sin tocar S3). Los nombres de los casos son los mismos que los del script.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, argsLog, llamar, reiniciar, seed, spyTotal, validToken } = require('./helpers/simulados');

const PREFIX = '/api/v1';
const app = appNueva();
beforeEach(reiniciar);

const buena = 'data/Málaga/2026-10-28_v1.xlsx';
const nfdKey = `data/${'Málaga'.normalize('NFD')}/2026-10-28_v1.xlsx`;
const rutas = [
    ['POST /upload/confirm (confirmar)', '/upload/confirm', (k) => ({ draftKey: k, confirmed: true }), 'draftKey', 'getBuffer'],
    ['POST /upload/confirm (cancelar)', '/upload/confirm', (k) => ({ draftKey: k, confirmed: false }), 'draftKey', 'del'],
    ['POST /update-file', '/update-file', (k) => ({ fileName: k }), 'fileName', 'getBuffer'],
    ['POST /delete-file', '/delete-file', (k) => ({ fileName: k }), 'fileName', 'del'],
];
const invalidas = [
    ['data/active/2026-10-28_v1.xlsx', 'data/active/2026-10-28_v1.xlsx'], ['data/terms/x.xlsx', 'data/terms/x.xlsx'],
    ['data/a/b/2026-10-28_v1.xlsx', 'data/a/b/2026-10-28_v1.xlsx'], ['x/Málaga/...', 'x/Málaga/2026-10-28_v1.xlsx'],
    ['data/Málaga/x.json', 'data/Málaga/x.json'], ['data/Málaga/../active/...', 'data/Málaga/../active/2026-10-28_v1.xlsx'],
    ['provincia en NFD', nfdKey], ['más de 120 caracteres', `data/Málaga/${'x'.repeat(120)}.xlsx`],
    ['provincia __proto__', 'data/__proto__/2026-10-28_v1.xlsx'], ['sin extensión', 'data/Málaga/2026-10-28_v1'],
    ['sin prefijo data/', 'Málaga/2026-10-28_v1.xlsx'], ['provincia vacía', 'data//2026-10-28_v1.xlsx'],
];
const ausentes = [123, ['data/Málaga/2026-10-28_v1.xlsx'], {}, '', null];

test('las listas de casos del criterio 14 no están vacías', () => {
    assert.ok(rutas.length > 0);
    assert.ok(invalidas.length > 0);
    assert.ok(ausentes.length > 0);
});

for (const [n, ruta, cuerpo, campo, log] of rutas) {
    test(`${n}: clave válida llega a S3 intacta`, async () => {
        // Con una versión estándar restante, borrar regenera el activo (plan 'regenerate'): un solo borrado de la clave del cliente.
        if (log === 'del') seed.list = [{ name: '2026-10-27_v1.xlsx', key: 'data/Málaga/2026-10-27_v1.xlsx' }];
        const r = await llamar(app, 'POST', `${PREFIX}${ruta}`, { token: validToken, body: cuerpo(buena) });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(argsLog[log].length, 1);
        assert.equal(argsLog[log][0][0], buena);
    });
    for (const [descr, clave] of invalidas) {
        test(`${n}: 400 con ${descr}`, async () => {
            const x = await llamar(app, 'POST', `${PREFIX}${ruta}`, { token: validToken, body: cuerpo(clave) });
            assert.ok(x.status === 400 && x.json?.error === `Invalid ${campo}`, `${x.status} ${x.json?.error}`);
            assert.equal(spyTotal(), 0, `llamadas a S3/SMTP=${spyTotal()}`);
        });
    }
    for (const valor of ausentes) {
        test(`${n}: ${JSON.stringify(valor)} mantiene ${campo} is required`, async () => {
            const x = await llamar(app, 'POST', `${PREFIX}${ruta}`, { token: validToken, body: cuerpo(valor) });
            assert.ok(x.status === 400 && x.json?.error === `${campo} is required`, `${x.status} ${x.json?.error}`);
            assert.equal(spyTotal(), 0, `llamadas a S3/SMTP=${spyTotal()}`);
        });
    }
}
