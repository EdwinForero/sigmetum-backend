// Primitivos de aws/ (M14): deleteFileFromS3 y putJsonToS3 solo hacen I/O de una clave, sobre el aws/awsS3connect.js REAL con
// un S3 con estado en memoria (sin red). No carga helpers/simulados.
require('./helpers/entorno');
// Credenciales ficticias (no empiezan por AKIA): el cliente nunca llega a firmar porque send está parcheado.
process.env.AWS_ACCESS_KEY_ID = 'ficticia-id-de-prueba';
process.env.AWS_SECRET_ACCESS_KEY = 'ficticia-clave-de-prueba';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { crearS3Simulado } = require('./helpers/s3-con-estado');

const s3 = crearS3Simulado({ pageSize: 50 });
let aws;

before(() => {
    s3.instalar();
    aws = require('../aws/awsS3connect');
});
after(() => s3.restaurar());
beforeEach((t) => {
    s3.reiniciar();
    t.mock.method(console, 'error', () => {});
});

describe('deleteFileFromS3 (primitivo de clave arbitraria)', () => {
    for (const clave of ['data/Sevilla/2026-10-05_v1.xlsx', 'data/active/Sevilla.json']) {
        test(`${clave}: un único DeleteObject, sin listar, leer ni escribir`, async () => {
            s3.sembrar(clave, 'x');
            s3.sembrar('data/Sevilla/otra.xlsx', 'y');
            await aws.deleteFileFromS3(clave);
            assert.deepEqual(s3.llamadas, [{ op: 'Delete', key: clave }]);
            assert.equal(s3.existe(clave), false);
            assert.equal(s3.existe('data/Sevilla/otra.xlsx'), true);
        });
    }
    test('un fallo de S3 se relanza con el error original y se registra en console.error', async () => {
        const original = Object.assign(new Error('AccessDenied interno de prueba'), { name: 'AccessDenied', Code: 'AccessDenied' });
        s3.alEnviar(() => { throw original; });
        await assert.rejects(() => aws.deleteFileFromS3('data/Sevilla/2026-10-05_v1.xlsx'), (e) => e === original);
        assert.ok(console.error.mock.calls.length >= 1);
    });
});

describe('putJsonToS3', () => {
    test('un Put con Body JSON.stringify(data, null, 2) y ContentType application/json', async () => {
        const datos = [{ Municipio: 'a', n: 1 }, { Municipio: 'b', n: 2 }];
        await aws.putJsonToS3('data/active/Sevilla.json', datos);
        assert.deepEqual(s3.llamadas, [{ op: 'Put', key: 'data/active/Sevilla.json' }]);
        assert.equal(s3.leer('data/active/Sevilla.json').toString('utf8'), JSON.stringify(datos, null, 2));
        assert.equal(s3.contentType('data/active/Sevilla.json'), 'application/json');
    });
    test('sobrescribe el objeto existente', async () => {
        s3.sembrar('data/active/Sevilla.json', '[]');
        await aws.putJsonToS3('data/active/Sevilla.json', [{ a: 1 }]);
        assert.equal(s3.leer('data/active/Sevilla.json').toString('utf8'), JSON.stringify([{ a: 1 }], null, 2));
    });
    test('un fallo de S3 se relanza con el error original y se registra en console.error', async () => {
        const original = Object.assign(new Error('InternalError interno de prueba'), { name: 'InternalError', Code: 'InternalError' });
        s3.alEnviar(() => { throw original; });
        await assert.rejects(() => aws.putJsonToS3('data/active/Sevilla.json', []), (e) => e === original);
        assert.ok(console.error.mock.calls.length >= 1);
    });
});

describe('updateFileS3 ya no existe', () => {
    // Comprobación auxiliar: la cobertura de la activación está en la caracterización por HTTP.
    test('aws/ no exporta updateFileS3', () => {
        assert.equal(aws.updateFileS3, undefined);
    });
});
