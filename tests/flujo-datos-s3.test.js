// Flujo de extremo a extremo upload -> confirm -> update-file -> delete-file con la app REAL, el aws/awsS3connect.js REAL y un
// S3 con estado en memoria que pagina de 2 en 2 (sin red). Provincia Sevilla. No carga helpers/simulados.
require('./helpers/entorno');
// Credenciales ficticias (no empiezan por AKIA): el cliente nunca llega a firmar porque send está parcheado.
process.env.AWS_ACCESS_KEY_ID = 'ficticia-id-de-prueba';
process.env.AWS_SECRET_ACCESS_KEY = 'ficticia-clave-de-prueba';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { TEST_SECRET } = require('./helpers/entorno');
const { fullRow, makeXlsx, subir } = require('./helpers/excel');
const { crearS3Simulado } = require('./helpers/s3-con-estado');

const s3 = crearS3Simulado({ pageSize: 2 });
let app;

const BASE = 'data/Sevilla';
const ACTIVA = 'data/active/Sevilla.json';
const CENTINELA = '[{"Municipio":"centinela"}]';
const token = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });
const post = (ruta, cuerpo) => request(app).post(`/api/v1/${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo);
const getDatos = (ruta) => request(app).get(`/api/v1/${ruta}`);

const fila = (municipio, hueco = false) => {
    const f = fullRow('Sevilla');
    f[1] = municipio;
    if (hueco) f[2] = null;
    return f;
};
const sembrarVersion = async (nombre, municipio) => s3.sembrar(`${BASE}/${nombre}`, await makeXlsx([fila(municipio)]));
const municipiosDelActivo = () => JSON.parse(s3.leer(ACTIVA).toString()).map((r) => r.Municipio);

const DIA = '2026-10-05';
const instante = new Date(`${DIA}T12:00:00Z`);
const tokenDelInstante = jwt.sign({ userId: 1, iat: Math.floor(instante.getTime() / 1000) }, TEST_SECRET, { expiresIn: '1h' });
const congelar = (t) => t.mock.timers.enable({ apis: ['Date'], now: instante });

before(() => {
    s3.instalar();
    app = require('../app');
});
after(() => s3.restaurar());
beforeEach((t) => {
    s3.reiniciar();
    t.mock.method(console, 'error', () => {});
});

describe('upload', () => {
    test('sin celdas vacías: el xlsx y el activo quedan en S3 y /get-data y /get-merged-data devuelven los datos', async (t) => {
        congelar(t);
        const r = await subir(app, [fila('Écija'), fila('Osuna')], tokenDelInstante);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.data.key, `${BASE}/${DIA}_v1.xlsx`);
        assert.ok(s3.existe(`${BASE}/${DIA}_v1.xlsx`));
        assert.ok(s3.existe(ACTIVA));

        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.equal(datos.status, 200);
        assert.equal(datos.body.success, true);
        assert.deepEqual(datos.body.data.map((x) => x.Municipio), ['Écija', 'Osuna']);

        const fusion = await getDatos('get-merged-data');
        assert.equal(fusion.status, 200);
        assert.deepEqual(fusion.body.data.map((x) => x.Municipio), ['Écija', 'Osuna']);
    });
    test('/get-merged-data recorre varias páginas y reúne los activos de todas las provincias', async () => {
        s3.sembrar('data/active/Cádiz.json', '[{"Municipio":"c1"}]');
        s3.sembrar('data/active/Huelva.json', '[{"Municipio":"h1"}]');
        s3.sembrar('data/active/Sevilla.json', '[{"Municipio":"s1"}]');
        const fusion = await getDatos('get-merged-data');
        assert.equal(fusion.status, 200);
        assert.deepEqual(fusion.body.data.map((x) => x.Municipio), ['c1', 'h1', 's1']);
        assert.equal(s3.llamadas.filter((c) => c.op === 'List').length, 2);
    });
    test('con celdas vacías: 400 con draftKey, el borrador queda guardado y el activo centinela no cambia', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        const r = await subir(app, [fila('Incompleta', true)], tokenDelInstante);
        assert.equal(r.status, 400);
        assert.equal(r.json.success, false);
        assert.equal(r.json.data.draftKey, `${BASE}/${DIA}_v1.xlsx`);
        assert.ok(s3.existe(r.json.data.draftKey));
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(datos.body.data, [{ Municipio: 'centinela' }]);
    });
    test('segunda subida con varias versiones (_v9 y _v10 del mismo día, más otros días): da _v11 (el orden por texto fallaría)', async (t) => {
        congelar(t);
        await sembrarVersion(`${DIA}_v9.xlsx`, 'v9');
        await sembrarVersion(`${DIA}_v10.xlsx`, 'v10');
        await sembrarVersion('2026-10-04_v3.xlsx', 'ayer');
        await sembrarVersion('2026-10-03_v1.xlsx', 'antes de ayer');
        await sembrarVersion('2026-10-06_v8.xlsx', 'mañana');
        const r = await subir(app, [fila('nueva')], tokenDelInstante);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.data.key, `${BASE}/${DIA}_v11.xlsx`);
        assert.deepEqual(municipiosDelActivo(), ['nueva']);
    });
});

describe('confirm, cancel y update-file', () => {
    test('confirm: el activo se regenera desde el borrador', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        const subida = await subir(app, [fila('Borrador', true)], tokenDelInstante);
        assert.equal(subida.status, 400);
        const confirmado = await post('upload/confirm', { confirmed: true, draftKey: subida.json.data.draftKey });
        assert.equal(confirmado.status, 200);
        assert.deepEqual(municipiosDelActivo(), ['Borrador']);
        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(datos.body.data.map((x) => x.Municipio), ['Borrador']);
    });
    test('cancel: el borrador se borra y el activo se regenera desde la última versión restante (punto 8)', async (t) => {
        congelar(t);
        await sembrarVersion('2026-10-01_v1.xlsx', 'anterior');
        s3.sembrar(ACTIVA, CENTINELA);
        const subida = await subir(app, [fila('Borrador', true)], tokenDelInstante);
        assert.equal(subida.status, 400);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: subida.json.data.draftKey });
        assert.equal(cancelado.status, 200);
        assert.equal(s3.existe(subida.json.data.draftKey), false);
        assert.deepEqual(municipiosDelActivo(), ['anterior']);
    });
    test('cancel del único borrador: no queda ningún xlsx y se borra el activo', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        const subida = await subir(app, [fila('Borrador', true)], tokenDelInstante);
        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: subida.json.data.draftKey });
        assert.equal(cancelado.status, 200);
        assert.deepEqual(s3.claves(`${BASE}/`), []);
        assert.equal(s3.existe(ACTIVA), false);
    });
    test('update-file: el activo pasa a la versión elegida', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'primera');
        await sembrarVersion('2026-10-02_v1.xlsx', 'segunda');
        await sembrarVersion('2026-10-03_v1.xlsx', 'tercera');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('update-file', { fileName: `${BASE}/2026-10-02_v1.xlsx` });
        assert.equal(res.status, 200);
        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(datos.body.data.map((x) => x.Municipio), ['segunda']);
    });
});

describe('delete-file', () => {
    // Cinco versiones: el listado de data/Sevilla/ ocupa tres páginas de 2.
    const sembrarCinco = async () => {
        for (const n of [1, 2, 3, 4, 5]) await sembrarVersion(`2026-10-0${n}_v1.xlsx`, `d${n}`);
        s3.sembrar(ACTIVA, CENTINELA);
    };
    test('de la última: el activo se regenera desde la anterior', async () => {
        await sembrarCinco();
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-05_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.equal(s3.existe(`${BASE}/2026-10-05_v1.xlsx`), false);
        assert.deepEqual(municipiosDelActivo(), ['d4']);
    });
    test('de una antigua: el activo queda con el contenido de la última', async () => {
        await sembrarCinco();
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-02_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.equal(s3.existe(`${BASE}/2026-10-02_v1.xlsx`), false);
        assert.deepEqual(municipiosDelActivo(), ['d5']);
    });
    test('con _v9, _v10 y _v11 del mismo día: borrar _v11 deja el activo en _v10 (el orden por texto elegiría _v9)', async () => {
        await sembrarVersion(`${DIA}_v9.xlsx`, 'v9');
        await sembrarVersion(`${DIA}_v10.xlsx`, 'v10');
        await sembrarVersion(`${DIA}_v11.xlsx`, 'v11');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('delete-file', { fileName: `${BASE}/${DIA}_v11.xlsx` });
        assert.equal(res.status, 200);
        assert.deepEqual(municipiosDelActivo(), ['v10']);
    });
    test('de todas una a una: el activo se borra al quitar la última que queda', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'd1');
        await sembrarVersion('2026-10-02_v1.xlsx', 'd2');
        s3.sembrar(ACTIVA, CENTINELA);
        assert.equal((await post('delete-file', { fileName: `${BASE}/2026-10-02_v1.xlsx` })).status, 200);
        assert.deepEqual(municipiosDelActivo(), ['d1']);
        assert.equal((await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` })).status, 200);
        assert.equal(s3.existe(ACTIVA), false);
        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.equal(datos.status, 404);
    });
});
