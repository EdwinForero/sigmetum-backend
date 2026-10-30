// Pruebas del propio doble de S3 con estado (tests/helpers/s3-con-estado.js), con el aws/awsS3connect.js REAL.
require('./helpers/entorno');
// Credenciales ficticias (no empiezan por AKIA): el cliente nunca llega a firmar porque send está parcheado.
process.env.AWS_ACCESS_KEY_ID = 'ficticia-id-de-prueba';
process.env.AWS_SECRET_ACCESS_KEY = 'ficticia-clave-de-prueba';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    S3, S3Client, ListObjectsV2Command, GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { crearS3Simulado } = require('./helpers/s3-con-estado');

const s3Doble = crearS3Simulado({ pageSize: 2 });
const cliente = new S3({ region: 'us-east-1' });
const Bucket = () => process.env.AWS_BUCKET_NAME;
let realAws;

const leerTexto = async (Key) => {
    const data = await cliente.getObject({ Bucket: Bucket(), Key });
    const trozos = [];
    for await (const trozo of data.Body) trozos.push(trozo);
    return Buffer.concat(trozos).toString('utf8');
};

before(() => {
    s3Doble.instalar();
    realAws = require('../aws/awsS3connect.js');
});
after(() => s3Doble.restaurar());
beforeEach(() => s3Doble.reiniciar());

describe('put, get y delete', () => {
    test('put guarda el cuerpo y get lo devuelve', async () => {
        await cliente.putObject({ Bucket: Bucket(), Key: 'data/a.txt', Body: 'hola' });
        assert.ok(s3Doble.existe('data/a.txt'));
        assert.equal(s3Doble.leer('data/a.txt').toString(), 'hola');
        assert.equal(await leerTexto('data/a.txt'), 'hola');
    });
    test('put guarda un Buffer y el ContentType', async () => {
        await cliente.putObject({ Bucket: Bucket(), Key: 'data/b.json', Body: Buffer.from('[1]'), ContentType: 'application/json' });
        assert.equal(s3Doble.contentType('data/b.json'), 'application/json');
        assert.deepEqual(s3Doble.leer('data/b.json'), Buffer.from('[1]'));
    });
    test('sin ContentType queda sin definir', async () => {
        await cliente.putObject({ Bucket: Bucket(), Key: 'data/c.bin', Body: Buffer.from('x') });
        assert.equal(s3Doble.contentType('data/c.bin'), undefined);
    });
    test('el Body se puede leer dos veces (un Readable nuevo por llamada)', async () => {
        s3Doble.sembrar('data/d.txt', 'dos lecturas');
        assert.equal(await leerTexto('data/d.txt'), 'dos lecturas');
        assert.equal(await leerTexto('data/d.txt'), 'dos lecturas');
    });
    test('get de una clave inexistente lanza NoSuchKey con name, Code y 404', async () => {
        await assert.rejects(() => cliente.getObject({ Bucket: Bucket(), Key: 'data/no.txt' }), (e) => e.name === 'NoSuchKey'
            && e.Code === 'NoSuchKey' && e.$metadata.httpStatusCode === 404);
    });
    test('delete borra y es idempotente', async () => {
        s3Doble.sembrar('data/e.txt', 'x');
        await cliente.deleteObject({ Bucket: Bucket(), Key: 'data/e.txt' });
        assert.equal(s3Doble.existe('data/e.txt'), false);
        await cliente.deleteObject({ Bucket: Bucket(), Key: 'data/e.txt' });
        assert.equal(s3Doble.existe('data/e.txt'), false);
    });
    test('un bucket distinto del configurado falla', async () => {
        await assert.rejects(() => cliente.putObject({ Bucket: 'otro-bucket', Key: 'data/x.txt', Body: 'x' }), (e) => e.name === 'NoSuchBucket');
        assert.equal(s3Doble.existe('data/x.txt'), false);
    });
    test('las llamadas quedan registradas en orden como { op, key }', async () => {
        await cliente.putObject({ Bucket: Bucket(), Key: 'data/f.txt', Body: 'x' });
        await cliente.getObject({ Bucket: Bucket(), Key: 'data/f.txt' });
        await cliente.listObjectsV2({ Bucket: Bucket(), Prefix: 'data/' });
        await cliente.deleteObject({ Bucket: Bucket(), Key: 'data/f.txt' });
        assert.deepEqual(s3Doble.llamadas, [
            { op: 'Put', key: 'data/f.txt' }, { op: 'Get', key: 'data/f.txt' },
            { op: 'List', key: 'data/' }, { op: 'Delete', key: 'data/f.txt' },
        ]);
    });
    test('reiniciar vacía los objetos y el registro', async () => {
        s3Doble.sembrar('data/g.txt', 'x');
        await cliente.getObject({ Bucket: Bucket(), Key: 'data/g.txt' });
        s3Doble.reiniciar();
        assert.deepEqual(s3Doble.claves(), []);
        assert.deepEqual(s3Doble.llamadas, []);
    });
    test('alEnviar puede hacer fallar una operación concreta y la operación no se ejecuta', async () => {
        s3Doble.alEnviar((llamada) => { if (llamada.op === 'Put') throw new Error('fallo inyectado'); });
        await assert.rejects(() => cliente.putObject({ Bucket: Bucket(), Key: 'data/h.txt', Body: 'x' }), /fallo inyectado/);
        assert.equal(s3Doble.existe('data/h.txt'), false);
        assert.deepEqual(s3Doble.llamadas, [{ op: 'Put', key: 'data/h.txt' }]);
    });
});

describe('listado', () => {
    test('el prefijo filtra con startsWith: data/Santa Cruz/ no incluye data/Santa Cruz de Tenerife/', async () => {
        s3Doble.sembrar('data/Santa Cruz/a.xlsx', 'x');
        s3Doble.sembrar('data/Santa Cruz de Tenerife/b.xlsx', 'x');
        assert.deepEqual(s3Doble.claves('data/Santa Cruz/'), ['data/Santa Cruz/a.xlsx']);
        const lista = await realAws.listFilesInS3Folder('data/Santa Cruz');
        assert.deepEqual(lista, [{ name: 'a.xlsx', key: 'data/Santa Cruz/a.xlsx' }]);
        const sinBarra = await cliente.listObjectsV2({ Bucket: Bucket(), Prefix: 'data/Santa Cruz' });
        assert.equal(sinBarra.Contents.length, 2);
    });
    test('las claves salen en orden binario (mayúsculas antes que minúsculas, y por unidades UTF-8)', () => {
        for (const k of ['data/b', 'data/a', 'data/B', 'data/_', 'data/\u{e9}', 'data/z']) s3Doble.sembrar(k, 'x');
        assert.deepEqual(s3Doble.claves('data/'), ['data/B', 'data/_', 'data/a', 'data/b', 'data/z', 'data/\u{e9}']);
    });
    test('el orden del texto "_v10" frente a "_v9" es el binario (10 antes que 9)', async () => {
        s3Doble.sembrar('data/Sevilla/2026-10-05_v9.xlsx', 'x');
        s3Doble.sembrar('data/Sevilla/2026-10-05_v10.xlsx', 'x');
        const lista = await realAws.listFilesInS3Folder('data/Sevilla');
        assert.deepEqual(lista.map((f) => f.name), ['2026-10-05_v10.xlsx', '2026-10-05_v9.xlsx']);
    });
    test('Size es el número de bytes del cuerpo', async () => {
        s3Doble.sembrar('data/s.txt', 'abc');
        s3Doble.sembrar('data/t.txt', '\u{e9}');
        const pagina = await cliente.listObjectsV2({ Bucket: Bucket(), Prefix: 'data/' });
        assert.deepEqual(pagina.Contents, [{ Key: 'data/s.txt', Size: 3 }, { Key: 'data/t.txt', Size: 2 }]);
    });
    test('la última página no trae NextContinuationToken y la intermedia sí', async () => {
        for (const k of ['data/1', 'data/2', 'data/3']) s3Doble.sembrar(k, 'x');
        const p1 = await cliente.listObjectsV2({ Bucket: Bucket(), Prefix: 'data/' });
        assert.equal(p1.IsTruncated, true);
        assert.equal(typeof p1.NextContinuationToken, 'string');
        const p2 = await cliente.listObjectsV2({ Bucket: Bucket(), Prefix: 'data/', ContinuationToken: p1.NextContinuationToken });
        assert.equal(p2.IsTruncated, false);
        assert.equal('NextContinuationToken' in p2, false);
        assert.deepEqual(p2.Contents.map((c) => c.Key), ['data/3']);
    });
    for (const pageSize of [1, 2]) {
        test(`el listFilesInS3Folder real recorre todas las páginas con pageSize ${pageSize}`, async () => {
            const propio = crearS3Simulado({ pageSize });
            s3Doble.restaurar();
            propio.instalar();
            try {
                for (const n of [1, 2, 3, 4, 5]) propio.sembrar(`data/Sevilla/2026-10-05_v${n}.xlsx`, 'x');
                propio.sembrar('data/Otra/2026-10-05_v1.xlsx', 'x');
                const lista = await realAws.listFilesInS3Folder('data/Sevilla');
                assert.equal(lista.length, 5);
                const listados = propio.llamadas.filter((c) => c.op === 'List').length;
                assert.equal(listados, Math.ceil(5 / pageSize));
            } finally {
                propio.restaurar();
                s3Doble.instalar();
            }
        });
    }
    test('el marcador de carpeta y el objeto de 0 bytes existen en el doble pero el listado real los excluye', async () => {
        s3Doble.sembrar('data/Sevilla/', '');
        s3Doble.sembrar('data/Sevilla/vacio.xlsx', '');
        s3Doble.sembrar('data/Sevilla/real.xlsx', 'x');
        assert.ok(s3Doble.existe('data/Sevilla/'));
        const crudo = await cliente.listObjectsV2({ Bucket: Bucket(), Prefix: 'data/Sevilla/' });
        // pageSize 2: la primera página trae el marcador (0 bytes) y real.xlsx; vacio.xlsx (0 bytes) va en la segunda.
        assert.deepEqual(crudo.Contents, [{ Key: 'data/Sevilla/', Size: 0 }, { Key: 'data/Sevilla/real.xlsx', Size: 1 }]);
        assert.equal(crudo.IsTruncated, true);
        assert.deepEqual(s3Doble.claves('data/Sevilla/'), ['data/Sevilla/', 'data/Sevilla/real.xlsx', 'data/Sevilla/vacio.xlsx']);
        assert.equal(s3Doble.leer('data/Sevilla/vacio.xlsx').length, 0);
        const lista = await realAws.listFilesInS3Folder('data/Sevilla');
        assert.deepEqual(lista, [{ name: 'real.xlsx', key: 'data/Sevilla/real.xlsx' }]);
    });
});

describe('instalación', () => {
    test('send está parcheado y las órdenes son las del SDK', () => {
        assert.ok(S3Client.prototype.send.mock, 'send debe ser un mock');
        assert.ok(new ListObjectsV2Command({ Bucket: 'b' }) instanceof ListObjectsV2Command);
        assert.ok(new GetObjectCommand({ Bucket: 'b', Key: 'k' }) instanceof GetObjectCommand);
    });
});
