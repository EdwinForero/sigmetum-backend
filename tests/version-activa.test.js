// Regla de la versión activa (M14) como funciones puras: functions/activeVersion.js y getNextVersion con el listado en memoria.
// Sin S3, sin red y sin simulados: lo que se prueba es que la regla no necesita aws/.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    provinciaFolderOf, activeKeyOf, provinciaOfKey, draftFolderOf, newDraftKeyOf, provinciaOfDraftKey, planActiveAfterDelete,
} = require('../functions/activeVersion');
const { getNextVersion } = require('../functions/getNextVersion');

const f = (name) => ({ name, key: `data/Sevilla/${name}` });

describe('provinciaFolderOf, activeKeyOf y provinciaOfKey', () => {
    test('provinciaFolderOf devuelve data/<provincia>', () => {
        assert.equal(provinciaFolderOf('Sevilla'), 'data/Sevilla');
        assert.equal(provinciaFolderOf('Santa Cruz'), 'data/Santa Cruz');
        assert.equal(provinciaFolderOf('Málaga'), 'data/Málaga');
    });
    test('activeKeyOf devuelve data/active/<provincia>.json', () => {
        assert.equal(activeKeyOf('Sevilla'), 'data/active/Sevilla.json');
        assert.equal(activeKeyOf('Málaga'), 'data/active/Málaga.json');
    });
    test('provinciaOfKey devuelve el segundo segmento de la clave', () => {
        assert.equal(provinciaOfKey('data/Sevilla/2026-10-05_v1.xlsx'), 'Sevilla');
        assert.equal(provinciaOfKey('data/Santa Cruz/2026-10-05_v1.xlsx'), 'Santa Cruz');
        assert.equal(provinciaOfKey('data/Málaga/2026-10-05_v1.xlsx'), 'Málaga');
    });
    test('provinciaOfKey y provinciaFolderOf son inversas sobre una clave de versión', () => {
        const clave = 'data/Santa Cruz/2026-10-05_v3.xlsx';
        assert.ok(clave.startsWith(`${provinciaFolderOf(provinciaOfKey(clave))}/`));
    });
    test('draftFolderOf, newDraftKeyOf y provinciaOfDraftKey: carpeta, clave con el id inyectado y provincia', () => {
        const id = '123e4567-e89b-42d3-a456-426614174000';
        assert.equal(draftFolderOf('Málaga'), 'data/drafts/Málaga');
        assert.equal(newDraftKeyOf('Málaga', id), `data/drafts/Málaga/${id}.xlsx`);
        assert.equal(provinciaOfDraftKey(newDraftKeyOf('Santa Cruz', id)), 'Santa Cruz');
    });
});

describe('planActiveAfterDelete', () => {
    test('_v10 gana a _v9: regenera desde _v10 con las dos permutaciones', () => {
        const a = planActiveAfterDelete([f('2026-10-05_v9.xlsx'), f('2026-10-05_v10.xlsx')]);
        const b = planActiveAfterDelete([f('2026-10-05_v10.xlsx'), f('2026-10-05_v9.xlsx')]);
        assert.deepEqual(a, { action: 'regenerate', key: 'data/Sevilla/2026-10-05_v10.xlsx' });
        assert.deepEqual(b, { action: 'regenerate', key: 'data/Sevilla/2026-10-05_v10.xlsx' });
    });
    test('la última vence a la antigua: regenera desde la fecha más reciente', () => {
        const plan = planActiveAfterDelete([f('2026-10-01_v5.xlsx'), f('2026-10-03_v1.xlsx'), f('2026-10-02_v9.xlsx')]);
        assert.deepEqual(plan, { action: 'regenerate', key: 'data/Sevilla/2026-10-03_v1.xlsx' });
    });
    test('una sola versión restante: regenera desde ella', () => {
        assert.deepEqual(planActiveAfterDelete([f('2026-10-01_v1.xlsx')]), { action: 'regenerate', key: 'data/Sevilla/2026-10-01_v1.xlsx' });
    });
    test('sin nada restante ([]): borra el activo', () => {
        assert.deepEqual(planActiveAfterDelete([]), { action: 'delete' });
    });
    test('solo manual.xlsx (xlsx no estándar): no toca el activo', () => {
        assert.deepEqual(planActiveAfterDelete([f('manual.xlsx')]), { action: 'keep' });
    });
    test('solo notas.txt (ningún xlsx): borra el activo', () => {
        assert.deepEqual(planActiveAfterDelete([f('notas.txt')]), { action: 'delete' });
    });
    test('la extensión .XLSX no cuenta como xlsx (sensible a mayúsculas): borra el activo', () => {
        assert.deepEqual(planActiveAfterDelete([f('MANUAL.XLSX')]), { action: 'delete' });
        assert.deepEqual(planActiveAfterDelete([f('2026-10-05_v1.XLSX')]), { action: 'delete' });
    });
    test('un xlsx no estándar junto a un txt: no toca el activo', () => {
        assert.deepEqual(planActiveAfterDelete([f('notas.txt'), f('manual.xlsx')]), { action: 'keep' });
    });
    test('una versión estándar junto a restos: regenera desde la versión', () => {
        const plan = planActiveAfterDelete([f('manual.xlsx'), f('notas.txt'), f('2026-10-04_v2.xlsx')]);
        assert.deepEqual(plan, { action: 'regenerate', key: 'data/Sevilla/2026-10-04_v2.xlsx' });
    });
});

describe('getNextVersion con el listado en memoria (síncrona y pura)', () => {
    const fecha = new Date('2026-10-05T12:00:00Z');

    test('_v9 y _v10 del mismo día dan 11 y no devuelve una promesa', () => {
        const resultado = getNextVersion('Sevilla', [f('2026-10-05_v9.xlsx'), f('2026-10-05_v10.xlsx')], fecha);
        assert.ok(!(resultado instanceof Promise), 'debe ser síncrona');
        assert.deepEqual(resultado, { version: 11, provinciaFolder: 'data/Sevilla' });
    });
    test('no cuenta otros días ni nombres no estándar', () => {
        const lista = [f('2026-10-04_v9.xlsx'), f('manual.xlsx'), f('2026-10-05_v2.xlsx')];
        assert.equal(getNextVersion('Sevilla', lista, fecha).version, 3);
    });
    test('listado vacío: versión 1', () => {
        assert.deepEqual(getNextVersion('Sevilla', [], fecha), { version: 1, provinciaFolder: 'data/Sevilla' });
    });
    test('la carpeta sale de provinciaFolderOf', () => {
        assert.equal(getNextVersion('Santa Cruz', [], fecha).provinciaFolder, provinciaFolderOf('Santa Cruz'));
    });
});
