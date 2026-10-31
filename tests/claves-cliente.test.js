// Criterio 14 del antiguo script de verificación de rutas (retirado): claves del cliente en upload/confirm, update-file y delete-file
// (formato, NFC, sin tocar S3). Los nombres de los casos son los mismos que los del script. Desde A2, /upload/confirm recibe una clave
// de borrador (data/drafts/...) y /update-file y /delete-file una clave de versión: cada ruta rechaza la clave de la otra.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, argsLog, llamar, reiniciar, seed, spyTotal, validToken } = require('./helpers/simulados');

const PREFIX = '/api/v1';
const app = appNueva();
beforeEach(reiniciar);

const buena = 'data/Málaga/2026-10-28_v1.xlsx';
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const borrador = `data/drafts/Málaga/${UUID}.xlsx`;
const nfdKey = `data/${'Málaga'.normalize('NFD')}/2026-10-28_v1.xlsx`;
// [nombre, ruta, cuerpo, campo, log, clave válida, claves inválidas propias de la ruta, qué devuelve el listado sembrado]
const rutas = [
    ['POST /upload/confirm (confirmar)', '/upload/confirm', (k) => ({ draftKey: k, confirmed: true }), 'draftKey', 'getBuffer', borrador, 'borrador'],
    ['POST /upload/confirm (cancelar)', '/upload/confirm', (k) => ({ draftKey: k, confirmed: false }), 'draftKey', 'del', borrador, 'borrador'],
    ['POST /update-file', '/update-file', (k) => ({ fileName: k }), 'fileName', 'getBuffer', buena, 'version'],
    ['POST /delete-file', '/delete-file', (k) => ({ fileName: k }), 'fileName', 'del', buena, 'version'],
];
// Claves del otro tipo y variantes malformadas de cada tipo (se suman a `invalidas`).
const invalidasDeBorrador = [
    ['clave de versión válida', buena], ['provincia reservada drafts', `data/drafts/drafts/${UUID}.xlsx`],
    ['provincia reservada active', `data/drafts/active/${UUID}.xlsx`], ['otra raíz', `x/drafts/Málaga/${UUID}.xlsx`],
    ['recorrido ..', `data/drafts/../${UUID}.xlsx`], ['un segmento de más', `data/drafts/Málaga/x/${UUID}.xlsx`],
    ['uuid en mayúsculas', `data/drafts/Málaga/${UUID.toUpperCase()}.xlsx`], ['provincia en NFD', `data/drafts/${'Málaga'.normalize('NFD')}/${UUID}.xlsx`],
    ['provincia con a cirílica', `data/drafts/Mál\u0430ga/${UUID}.xlsx`], ['provincia con número romano', `data/drafts/\u2160/${UUID}.xlsx`],
    ['provincia con CGJ invisible', `data/drafts/a\u034F/${UUID}.xlsx`],
];
const invalidasDeVersion = [
    ['clave de borrador válida', borrador], ['clave de borrador de otra provincia', `data/drafts/Sevilla/${UUID}.xlsx`],
    ['borrador con segmento de más', `data/drafts/Málaga/x/${UUID}.xlsx`],
    ['provincia con a cirílica', 'data/Mál\u0430ga/2026-10-28_v1.xlsx'], ['provincia con número romano', 'data/\u2160/2026-10-28_v1.xlsx'],
    ['provincia con CGJ invisible', 'data/a\u034F/2026-10-28_v1.xlsx'],
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

for (const [n, ruta, cuerpo, campo, log, valida, tipo] of rutas) {
    test(`${n}: clave válida llega a S3 intacta`, async () => {
        if (tipo === 'borrador') {
            // El borrador existe en su carpeta (el listado de existencia lo ve); confirmar y cancelar no tocan versiones ni el activo antes.
            seed.list = [{ name: `${UUID}.xlsx`, key: borrador }];
        } else if (log === 'del') {
            // Con una versión estándar restante, borrar regenera el activo (plan 'regenerate'): un solo borrado de la clave del cliente.
            seed.list = [{ name: '2026-10-27_v1.xlsx', key: 'data/Málaga/2026-10-27_v1.xlsx' }];
        }
        const r = await llamar(app, 'POST', `${PREFIX}${ruta}`, { token: validToken, body: cuerpo(valida) });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(argsLog[log].length, 1);
        assert.equal(argsLog[log][0][0], valida);
    });
    for (const [descr, clave] of [...invalidas, ...(tipo === 'borrador' ? invalidasDeBorrador : invalidasDeVersion)]) {
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

// ─── M25: GET /get-data/:path(*) valida la clave contra una lista de permitidos (versión .xlsx o activo .json) ───────────────────
const { isValidGetDataKey } = require('../functions/validateDataKey');

const activaBuena = 'data/active/Málaga.json';
const getDataValidas = [
    ['versión .xlsx', buena], ['activo .json', activaBuena], ['activo de provincia con espacio', 'data/active/Santa Cruz.json'],
];
const getDataInvalidas = [
    ['recorrido ..', 'data/../x'], ['recorrido codificado', '..%2f..%2fsecret'], ['data/terms', 'data/terms/noLatinTerms.json'],
    ['borrador', borrador], ['otra raíz', 'x/active/Málaga.json'], ['más de 120 caracteres', `data/active/${'x'.repeat(120)}.json`],
    ['provincia con a cirílica', 'data/active/Mál\u0430ga.json'], ['provincia con CGJ invisible', 'data/active/a\u034F.json'],
    ['provincia en NFD', `data/active/${'Málaga'.normalize('NFD')}.json`], ['provincia active', 'data/active/active.json'],
    ['doble extensión .json.json', 'data/active/x.json.json'], ['carpeta de provincia con .json', 'data/Málaga/x.json'],
    ['activo sin provincia', 'data/active/.json'], ['activo con segmento de más', 'data/active/Málaga/x.json'],
    ['activo con extensión .xlsx', 'data/active/Málaga.xlsx'], ['sin extensión', 'data/active/Málaga'],
];

test('isValidGetDataKey acepta versión .xlsx y activo .json', () => {
    for (const [, clave] of getDataValidas) assert.equal(isValidGetDataKey(clave), true, clave);
});
test('isValidGetDataKey rechaza lo que no es cadena y las claves inválidas', () => {
    for (const valor of [undefined, null, 123, {}, ['data/active/Málaga.json'], '']) assert.equal(isValidGetDataKey(valor), false);
    for (const [descr, clave] of getDataInvalidas) assert.equal(isValidGetDataKey(clave), false, descr);
});

for (const [descr, clave] of getDataValidas) {
    test(`GET /get-data con ${descr}: llega a S3 y responde 200`, async () => {
        const r = await llamar(app, 'GET', `${PREFIX}/get-data/${clave}`);
        assert.equal(r.status, 200, `${r.status} ${r.json?.error}`);
        assert.equal(r.json.success, true);
        assert.equal(spyTotal(), 1);
    });
}
for (const [descr, clave] of getDataInvalidas) {
    test(`GET /get-data: 400 Invalid path con ${descr}`, async () => {
        const r = await llamar(app, 'GET', `${PREFIX}/get-data/${clave}`);
        assert.equal(r.status, 400, `${r.status} ${r.json?.error}`);
        assert.deepEqual(r.json, { success: false, error: 'Invalid path' });
        assert.equal(spyTotal(), 0, `llamadas a S3/SMTP=${spyTotal()}`);
    });
}
test('GET /get-data/ con clave vacía: 400 Invalid path sin llamar a S3', async () => {
    const r = await llamar(app, 'GET', `${PREFIX}/get-data/`);
    assert.equal(r.status, 400, `${r.status} ${r.json?.error}`);
    assert.deepEqual(r.json, { success: false, error: 'Invalid path' });
    assert.equal(spyTotal(), 0);
});
