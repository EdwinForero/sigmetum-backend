// Criterio 15 del antiguo script de verificación de rutas (retirado): prefijo con barra en los listados, sobre el aws/awsS3connect.js REAL con
// S3Client.prototype.send parcheado (sin red). Este archivo no carga helpers/simulados: no inyecta los espías de S3.
// Los nombres de los casos son los mismos que los del script.
const { TEST_SECRET } = require('./helpers/entorno');
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { fullRow, makeXlsx, subir } = require('./helpers/excel');

const claves = [
    'data/active/Málaga.json', 'data/activos/Otra.json', 'data/Santa Cruz/2026-10-01_v1.xlsx', 'data/Santa Cruz de Tenerife/2026-10-05_v3.xlsx',
];
const prefijos = [];
const leidas = [];
const escritas = [];
let realAws;
let realNext;
let app;
let enviar;

before(async () => {
    const xlsx = await makeXlsx([fullRow('Santa Cruz')]);
    enviar = mock.method(S3Client.prototype, 'send', async function send(command) {
        if (command instanceof ListObjectsV2Command) {
            prefijos.push(command.input.Prefix);
            return { Contents: claves.filter((k) => k.startsWith(command.input.Prefix)).map((Key) => ({ Key, Size: 10 })) };
        }
        if (command instanceof GetObjectCommand) {
            leidas.push(command.input.Key);
            return { Body: Readable.from([command.input.Key.endsWith('.xlsx') ? xlsx : Buffer.from('[]')]) };
        }
        escritas.push(`${command.constructor.name} ${command.input.Key}`);
        return {};
    });
    realAws = require('../aws/awsS3connect.js');
    realNext = require('../functions/getNextVersion.js');
    app = require('../app');
});
after(() => enviar.mock.restore());
beforeEach(() => { prefijos.length = 0; leidas.length = 0; escritas.length = 0; });

const ultimo = () => prefijos[prefijos.length - 1];
const token = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });

test('el módulo real está cargado y S3Client.send está parcheado (no hay red)', () => {
    assert.equal(typeof realAws.getMergedDataInS3Folder, 'function');
    assert.notEqual(S3Client.prototype.send, undefined);
    assert.equal(enviar.mock.calls.length, 0);
});

test("getMergedDataInS3Folder('data/active') lista con barra final", async () => {
    await realAws.getMergedDataInS3Folder('data/active');
    assert.equal(ultimo(), 'data/active/');
});
test('getMergedDataInS3Folder no lee data/activos/', async () => {
    await realAws.getMergedDataInS3Folder('data/active');
    assert.deepEqual(leidas, ['data/active/Málaga.json']);
});
test("listFilesInS3Folder('data/') no duplica la barra", async () => {
    await realAws.listFilesInS3Folder('data/');
    assert.equal(ultimo(), 'data/');
});
test('listar Santa Cruz solo ve sus archivos', async () => {
    const lista = await realAws.listFilesInS3Folder('data/Santa Cruz');
    assert.ok(lista.length === 1 && lista[0].key === 'data/Santa Cruz/2026-10-01_v1.xlsx', JSON.stringify(lista));
});
test('getNextVersion de Santa Cruz no cuenta Santa Cruz de Tenerife', async () => {
    const lista = await realAws.listFilesInS3Folder('data/Santa Cruz');
    const { version } = realNext.getNextVersion('Santa Cruz', lista, new Date('2026-10-05T12:00:00Z'));
    assert.ok(version === 1 && ultimo() === 'data/Santa Cruz/', `version=${version} prefijo=${ultimo()}`);
});
test('deleteFileFromS3 de Santa Cruz solo considera sus archivos', async () => {
    const res = await request(app).post('/api/v1/delete-file').set('Authorization', `Bearer ${token}`).send({ fileName: 'data/Santa Cruz/2026-10-02_v2.xlsx' });
    assert.equal(res.status, 200);
    assert.ok(ultimo() === 'data/Santa Cruz/' && leidas.length === 1 && leidas[0] === 'data/Santa Cruz/2026-10-01_v1.xlsx',
        `prefijo=${ultimo()} leidas=${JSON.stringify(leidas)} escritas=${JSON.stringify(escritas)}`);
});

test('POST /upload de Santa Cruz lista con barra final y no cuenta Santa Cruz de Tenerife', async (t) => {
    const instante = new Date('2026-10-05T12:00:00Z');
    // Token firmado FUERA del mock de Date, con el instante simulado como iat: así sigue vigente bajo el mock.
    const tokenDelInstante = jwt.sign({ userId: 1, iat: Math.floor(instante.getTime() / 1000) }, TEST_SECRET, { expiresIn: '1h' });
    t.mock.timers.enable({ apis: ['Date'], now: instante });
    const r = await subir(app, [fullRow('Santa Cruz')], tokenDelInstante);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(prefijos, ['data/Santa Cruz/', 'data/drafts/Santa Cruz/']); // versiones y, al final, borradores previos
    // Si el prefijo perdiera la barra, contaría data/Santa Cruz de Tenerife/2026-10-05_v3.xlsx y daría otra versión.
    assert.equal(r.json.data.key, 'data/Santa Cruz/2026-10-05_v1.xlsx');
});
