// Interpretación única del nombre de versión (AAAA-MM-DD_vN.xlsx): parseo y elección de la última versión (A8). Funciones puras.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersionName, latestVersionFile } = require('../functions/versionName');

const f = (name) => ({ name, key: `data/X/${name}` });

test('parseVersionName devuelve fecha y versión entera', () => {
    assert.deepEqual(parseVersionName('2026-10-05_v12.xlsx'), { date: '2026-10-05', version: 12 });
    assert.deepEqual(parseVersionName('2026-10-05_v007.xlsx'), { date: '2026-10-05', version: 7 });
});
test('parseVersionName devuelve null con nombres no estándar', () => {
    for (const nombre of ['notas.xlsx', '2026-10-05_v1.XLSX', '2026-10-05_v1.xlsx.bak', 'x2026-10-05_v1.xlsx', '2026-10-05_v.xlsx', '']) {
        assert.equal(parseVersionName(nombre), null, nombre);
    }
});
test('latestVersionFile: _v10 gana a _v9 (orden numérico, no alfabético)', () => {
    assert.equal(latestVersionFile([f('2026-10-05_v9.xlsx'), f('2026-10-05_v10.xlsx')]).name, '2026-10-05_v10.xlsx');
    assert.equal(latestVersionFile([f('2026-10-05_v10.xlsx'), f('2026-10-05_v9.xlsx')]).name, '2026-10-05_v10.xlsx');
});
test('latestVersionFile: la fecha más reciente gana aunque tenga N menor', () => {
    assert.equal(latestVersionFile([f('2026-10-06_v1.xlsx'), f('2026-10-05_v9.xlsx')]).name, '2026-10-06_v1.xlsx');
});
test('latestVersionFile ignora los nombres no estándar', () => {
    assert.equal(latestVersionFile([f('zzz.xlsx'), f('2026-10-05_v1.xlsx')]).name, '2026-10-05_v1.xlsx');
});
test('latestVersionFile devuelve null con [] o solo nombres no estándar', () => {
    assert.equal(latestVersionFile([]), null);
    assert.equal(latestVersionFile([f('zzz.xlsx'), f('notas.txt')]), null);
});
test('latestVersionFile: _v7 y _v007 dan el mismo ganador con las dos permutaciones', () => {
    const a = f('2026-10-05_v7.xlsx');
    const b = f('2026-10-05_v007.xlsx');
    assert.equal(latestVersionFile([a, b]).name, latestVersionFile([b, a]).name);
    assert.equal(latestVersionFile([a, b]).name, '2026-10-05_v7.xlsx');
});
