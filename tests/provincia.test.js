// Criterio 12 del antiguo script de verificación de rutas (retirado): validación del nombre de provincia (A4), sin red.
// Los nombres de los casos son los mismos que los del script.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getProvinciaNameError: nombre, validateProvincia: filas } = require('../functions/validateProvincia');

const validas = ['Activos', 'Málaga', 'Santa Cruz de Tenerife', 'A Coruña', 'Illes Balears', 'Castellón-Castelló'];
const rechazadas = ['a/b', 'a\\b', '..', 'a1', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'active', 'terms', 'drafts',
    'Active', 'Terms', 'Activeness', 'Termsx', 'Terms2', 'a  b', ' a', 'a ', '-a', 'a-', 'a- b', 'Alicante/Alacant', 'a.b', 'a'.repeat(51), 5, ['a'], {}];
const casos = [
    ['ausente', [{}], 'Province is required'], ['vacía', [{ Provincia: '' }], 'Province is required'], ['solo espacios', [{ Provincia: '  ' }], 'Province is required'],
    ['sin filas', [], 'Province is required'], ['primera fila sin provincia', [{}, { Provincia: 'Málaga' }], 'Province is required'],
    ['número', [{ Provincia: 5 }], 'Province is not valid'], ['array', [{ Provincia: ['a', 'b'] }], 'Province is not valid'],
    ['51 letras', [{ Provincia: 'a'.repeat(51) }], 'Province is not valid'], ['reservada', [{ Provincia: 'terms' }], 'Province is reserved'],
    ['dos provincias', [{ Provincia: 'Málaga' }, { Provincia: 'Sevilla' }], 'Excel contains more than one province'],
    ['otra fila con array', [{ Provincia: 'Málaga' }, { Provincia: ['Málaga', 'Sevilla'] }], 'Excel contains more than one province'],
    ['otra fila con número', [{ Provincia: 'Málaga' }, { Provincia: 5 }], 'Excel contains more than one province'],
];

test('las listas de casos de provincia no están vacías', () => {
    assert.ok(validas.length > 0);
    assert.ok(rechazadas.length > 0);
    assert.ok(casos.length > 0);
});

for (const v of validas) {
    test(`válida ${v}`, () => assert.equal(nombre(v), null));
}
for (const v of rechazadas) {
    test(`getProvinciaNameError rechaza ${JSON.stringify(v)?.slice(0, 20)}`, () => assert.equal(typeof nombre(v), 'string'));
}
test('50 letras es válido', () => assert.equal(nombre('a'.repeat(50)), null));
test('reservada da Province is reserved', () => {
    assert.equal(nombre('active'), 'Province is reserved');
    assert.equal(nombre('drafts'), 'Province is reserved');
});
for (const [n, rows, esperado] of casos) {
    test(`validateProvincia ${n}`, () => assert.equal(filas(rows).error, esperado));
}

const nfc = 'Málaga';
const nfd = 'Ma\u{301}laga';
test('recorta espacios', () => assert.equal(filas([{ Provincia: ' Málaga ' }]).provincia, nfc));
test('la forma NFD se resuelve a NFC', () => {
    assert.notEqual(nfd, nfc);
    assert.equal(nfd.normalize('NFC'), nfc);
    assert.equal(filas([{ Provincia: nfd }]).provincia, nfc);
});
test('otra fila igual tras NFC y trim es la misma provincia', () => assert.equal(filas([{ Provincia: nfc }, { Provincia: ` ${nfd} ` }]).provincia, nfc));
test('otra fila sin la clave se ignora', () => assert.equal(filas([{ Provincia: nfc }, { Municipio: 'x' }]).provincia, nfc));
test('Málaga y Malaga siguen distintas', () => assert.equal(filas([{ Provincia: nfc }, { Provincia: 'Malaga' }]).error, 'Excel contains more than one province'));
