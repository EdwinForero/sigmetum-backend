// Caracterización de la regla de la versión activa (M14): fija, por HTTP, lo que hoy hacen /delete-file, /upload/confirm,
// /update-file y /upload con la app REAL, el aws/awsS3connect.js REAL y un S3 con estado en memoria (sin red).
// No carga helpers/simulados. Los helpers de helpers/excel se llaman SIEMPRE con token explícito.
// Debe pasar igual antes y después del refactor: no se adapta a él. Excepción: las pruebas de borradores (POST /upload con
// celdas vacías, /upload/confirm y la rareza del punto 8) cambian a propósito por A2 y A9 (borradores en data/drafts/).
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
const { convertExcelToJson } = require('../functions/convertExcelToJson');

// pageSize amplio: con pocos objetos cada listado es de una sola página y el orden de llamadas es estable.
const s3 = crearS3Simulado({ pageSize: 50 });
let app;

const BASE = 'data/Sevilla';
const BORRADORES = 'data/drafts/Sevilla';
const ACTIVA = 'data/active/Sevilla.json';
const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CLAVE_BORRADOR = new RegExp(`^${BORRADORES}/${UUID_RE}\\.xlsx$`);
const CENTINELA = '[{"Municipio":"centinela"}]';
const token = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });
const auth = (req, t = token) => req.set('Authorization', `Bearer ${t}`);
const post = (ruta, cuerpo) => auth(request(app).post(`/api/v1/${ruta}`)).send(cuerpo);

const fila = (municipio, hueco = false) => {
    const f = fullRow('Sevilla');
    f[1] = municipio;
    if (hueco) f[2] = null; // Altitud Media vacía: borrador con celdas vacías
    return f;
};
const sembrarVersion = async (nombre, municipio) => s3.sembrar(`${BASE}/${nombre}`, await makeXlsx([fila(municipio)]));
const municipiosDelActivo = () => JSON.parse(s3.leer(ACTIVA).toString()).map((r) => r.Municipio);
const operaciones = () => s3.llamadas.map((c) => `${c.op} ${c.key}`);
const sobreActiva = (op) => s3.llamadas.filter((c) => c.op === op && c.key === ACTIVA);
const lecturas = () => s3.llamadas.filter((c) => c.op === 'Get').map((c) => c.key);

// Instante simulado para POST /upload; el token lleva ese instante como iat (como tests/fecha-utc.test.js).
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

describe('POST /delete-file', () => {
    test('de la última (_v9, _v10, _v11 del mismo día): el activo se regenera desde _v10', async () => {
        await sembrarVersion(`${DIA}_v9.xlsx`, 'v9');
        await sembrarVersion(`${DIA}_v10.xlsx`, 'v10');
        await sembrarVersion(`${DIA}_v11.xlsx`, 'v11');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('delete-file', { fileName: `${BASE}/${DIA}_v11.xlsx` });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: 'File deleted successfully.' });
        assert.equal(s3.existe(`${BASE}/${DIA}_v11.xlsx`), false);
        assert.deepEqual(municipiosDelActivo(), ['v10']);
        assert.deepEqual(lecturas(), [`${BASE}/${DIA}_v10.xlsx`]);
        assert.equal(sobreActiva('Delete').length, 0);
    });
    test('de una antigua: el activo queda con el contenido de la última', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'antigua');
        await sembrarVersion('2026-10-02_v1.xlsx', 'media');
        await sembrarVersion('2026-10-03_v1.xlsx', 'ultima');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.deepEqual(municipiosDelActivo(), ['ultima']);
        assert.deepEqual(lecturas(), [`${BASE}/2026-10-03_v1.xlsx`]);
        assert.deepEqual(s3.claves(`${BASE}/`), [`${BASE}/2026-10-02_v1.xlsx`, `${BASE}/2026-10-03_v1.xlsx`]);
    });
    test('de la única: se borra el activo', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'unica');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.equal(s3.existe(ACTIVA), false);
        assert.deepEqual(s3.claves(`${BASE}/`), []);
        assert.equal(sobreActiva('Delete').length, 1);
        assert.equal(sobreActiva('Put').length, 0);
    });
    test('con restos manual.xlsx y ninguna versión estándar: el activo no se toca (ni Put ni Delete)', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'a borrar');
        s3.sembrar(`${BASE}/manual.xlsx`, 'no es un xlsx real');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        assert.equal(sobreActiva('Put').length, 0);
        assert.equal(sobreActiva('Delete').length, 0);
        assert.deepEqual(lecturas(), []);
    });
    test('con restos notas.txt y ningún .xlsx: se borra el activo', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'a borrar');
        s3.sembrar(`${BASE}/notas.txt`, 'texto');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.equal(s3.existe(ACTIVA), false);
        assert.equal(sobreActiva('Delete').length, 1);
    });
    test('orden de llamadas: Delete (archivo), List, Get (última), Put (activo)', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'a borrar');
        await sembrarVersion('2026-10-02_v1.xlsx', 'queda');
        s3.sembrar(ACTIVA, CENTINELA);
        await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.deepEqual(operaciones(), [
            `Delete ${BASE}/2026-10-01_v1.xlsx`, `List ${BASE}/`, `Get ${BASE}/2026-10-02_v1.xlsx`, `Put ${ACTIVA}`,
        ]);
    });
    test('orden de llamadas al borrar la única: Delete (archivo), List, Delete (activo)', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'unica');
        s3.sembrar(ACTIVA, CENTINELA);
        await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.deepEqual(operaciones(), [`Delete ${BASE}/2026-10-01_v1.xlsx`, `List ${BASE}/`, `Delete ${ACTIVA}`]);
    });
    test('Delete correcto y Get que falla: 500 con envoltorio sin texto interno, archivo borrado, activo intacto y sin Put', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'a borrar');
        await sembrarVersion('2026-10-02_v1.xlsx', 'queda');
        s3.sembrar(ACTIVA, CENTINELA);
        s3.alEnviar((llamada) => { if (llamada.op === 'Get') throw new Error('fallo interno de prueba'); });
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.equal(res.status, 500);
        assert.equal(res.body.success, false);
        assert.equal(typeof res.body.error, 'string');
        assert.ok(!res.body.error.includes('interno'));
        assert.equal(s3.existe(`${BASE}/2026-10-01_v1.xlsx`), false);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        assert.equal(s3.llamadas.filter((c) => c.op === 'Put').length, 0);
    });
});

describe('POST /update-file', () => {
    test('escribe el activo con JSON.stringify(datos, null, 2), ContentType application/json y la secuencia Get, Put', async () => {
        const xlsx = await makeXlsx([fila('elegida'), fila('otra, con coma')]);
        s3.sembrar(`${BASE}/2026-10-01_v1.xlsx`, xlsx);
        const { processedData } = await convertExcelToJson(xlsx);
        const res = await post('update-file', { fileName: `${BASE}/2026-10-01_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: 'Active version updated successfully.' });
        assert.equal(s3.leer(ACTIVA).toString(), JSON.stringify(processedData, null, 2));
        assert.equal(s3.contentType(ACTIVA), 'application/json');
        assert.deepEqual(operaciones(), [`Get ${BASE}/2026-10-01_v1.xlsx`, `Put ${ACTIVA}`]);
    });
});

const ID1 = '123e4567-e89b-42d3-a456-426614174000';
const sembrarBorrador = async (id, municipio) => {
    s3.sembrar(`${BORRADORES}/${id}.xlsx`, await makeXlsx([fila(municipio)]));
    return `${BORRADORES}/${id}.xlsx`;
};

describe('POST /upload/confirm', () => {
    test('confirmar: crea la versión sobre las reales, regenera el activo desde ella y borra el borrador (orden de llamadas)', async (t) => {
        congelar(t);
        const borrador = await sembrarBorrador(ID1, 'borrador');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('upload/confirm', { confirmed: true, draftKey: borrador });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: 'Files uploaded successfully after confirmation.' });
        assert.deepEqual(municipiosDelActivo(), ['borrador']);
        assert.ok(s3.existe(`${BASE}/${DIA}_v1.xlsx`));
        assert.equal(s3.existe(borrador), false);
        assert.deepEqual(operaciones(), [
            `List ${BORRADORES}/`, `Get ${borrador}`, `List ${BASE}/`, `Put ${BASE}/${DIA}_v1.xlsx`, `Put ${ACTIVA}`, `Delete ${borrador}`,
        ]);
    });
    test('cancelar: solo List y Delete del borrador; versiones y activo intactos', async () => {
        await sembrarVersion('2026-10-01_v1.xlsx', 'queda');
        s3.sembrar(ACTIVA, CENTINELA);
        const borrador = await sembrarBorrador(ID1, 'borrador');
        const res = await post('upload/confirm', { confirmed: false, draftKey: borrador });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: 'Upload cancelled. Draft removed.' });
        assert.equal(s3.existe(borrador), false);
        assert.deepEqual(operaciones(), [`List ${BORRADORES}/`, `Delete ${borrador}`]);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        assert.deepEqual(s3.claves(`${BASE}/`), [`${BASE}/2026-10-01_v1.xlsx`]);
        assert.equal(sobreActiva('Put').length + sobreActiva('Delete').length, 0);
    });
});

// A9: el borrador no es una versión, así que cancelar ya no regenera el activo ni borra versiones (antes, rareza del punto 8).
describe('A9: cancelar un borrador no toca las versiones ni el activo', () => {
    test('variante 1: el activo puesto en una versión antigua con update-file sigue igual tras subir y cancelar un borrador', async (t) => {
        congelar(t);
        await sembrarVersion('2026-10-03_v1.xlsx', 'antigua');
        await sembrarVersion('2026-10-04_v1.xlsx', 'reciente');
        s3.sembrar(ACTIVA, CENTINELA);

        const elegida = await post('update-file', { fileName: `${BASE}/2026-10-03_v1.xlsx` });
        assert.equal(elegida.status, 200);
        assert.deepEqual(municipiosDelActivo(), ['antigua']);

        const subida = await subir(app, [fila('borrador', true)], tokenDelInstante);
        assert.equal(subida.status, 400);
        assert.match(subida.json.data.draftKey, CLAVE_BORRADOR);
        assert.deepEqual(municipiosDelActivo(), ['antigua'], 'subir un borrador no toca el activo');

        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: subida.json.data.draftKey });
        assert.equal(cancelado.status, 200);
        assert.equal(s3.existe(subida.json.data.draftKey), false);
        assert.deepEqual(municipiosDelActivo(), ['antigua'], 'el cancel ya no sobrescribe la elección');
        assert.deepEqual(s3.claves(`${BASE}/`), [`${BASE}/2026-10-03_v1.xlsx`, `${BASE}/2026-10-04_v1.xlsx`]);
    });
    test('variante 2: el segundo borrador sustituye al primero y cancelarlo no deja el activo con la fila incompleta', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);

        const primera = await subir(app, [fila('borrador-1', true)], tokenDelInstante);
        assert.equal(primera.status, 400);
        assert.match(primera.json.data.draftKey, CLAVE_BORRADOR);
        const segunda = await subir(app, [fila('borrador-2', true)], tokenDelInstante);
        assert.equal(segunda.status, 400);
        assert.match(segunda.json.data.draftKey, CLAVE_BORRADOR);
        assert.notEqual(segunda.json.data.draftKey, primera.json.data.draftKey);
        assert.equal(s3.existe(primera.json.data.draftKey), false, 'la subida posterior descarta el borrador previo');
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA, 'subir borradores no toca el activo');

        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: segunda.json.data.draftKey });
        assert.equal(cancelado.status, 200);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA, 'el activo no pasa a ser un borrador sin confirmar');
        assert.deepEqual(s3.claves(`${BASE}/`), []);
        assert.deepEqual(s3.claves(`${BORRADORES}/`), []);
    });
});

describe('POST /upload', () => {
    test('varias versiones del mismo día y de otros días: _v9 y _v10 dan _v11, sin contar otros días', async (t) => {
        congelar(t);
        await sembrarVersion(`${DIA}_v9.xlsx`, 'v9');
        await sembrarVersion(`${DIA}_v10.xlsx`, 'v10');
        await sembrarVersion('2026-10-04_v50.xlsx', 'ayer');
        await sembrarVersion('2026-10-06_v77.xlsx', 'mañana');
        const r = await subir(app, [fila('nueva')], tokenDelInstante);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.data.key, `${BASE}/${DIA}_v11.xlsx`);
        assert.ok(s3.existe(`${BASE}/${DIA}_v11.xlsx`));
    });
    test('solo versiones de otros días: la primera del día es _v1', async (t) => {
        congelar(t);
        await sembrarVersion('2026-10-04_v50.xlsx', 'ayer');
        const r = await subir(app, [fila('nueva')], tokenDelInstante);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.data.key, `${BASE}/${DIA}_v1.xlsx`);
    });
    test('sin celdas vacías: dos Put (el xlsx y el activo) sin ContentType, tras un List y con un List final de borradores', async (t) => {
        congelar(t);
        const r = await subir(app, [fila('completa')], tokenDelInstante);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.deepEqual(r.json, { success: true, data: { message: 'Files uploaded successfully', key: `${BASE}/${DIA}_v1.xlsx` } });
        assert.deepEqual(operaciones(), [`List ${BASE}/`, `Put ${BASE}/${DIA}_v1.xlsx`, `Put ${ACTIVA}`, `List ${BORRADORES}/`]);
        assert.equal(s3.contentType(`${BASE}/${DIA}_v1.xlsx`), undefined);
        assert.equal(s3.contentType(ACTIVA), undefined);
        const { processedData } = await convertExcelToJson(s3.leer(`${BASE}/${DIA}_v1.xlsx`));
        assert.equal(s3.leer(ACTIVA).toString(), JSON.stringify(processedData, null, 2));
        assert.deepEqual(municipiosDelActivo(), ['completa']);
    });
    test('con celdas vacías: un solo Put (el borrador en data/drafts), 400 con draftKey, sin versión nueva y el activo intacto', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        s3.llamadas.length = 0;
        const r = await subir(app, [fila('incompleta', true)], tokenDelInstante);
        assert.equal(r.status, 400);
        assert.equal(r.json.error, 'Some rows have empty fields.');
        const { draftKey } = r.json.data;
        assert.match(draftKey, CLAVE_BORRADOR);
        assert.deepEqual(operaciones(), [`Put ${draftKey}`, `List ${BORRADORES}/`]);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        assert.ok(s3.existe(draftKey));
        assert.deepEqual(s3.claves(`${BASE}/`), [], 'el borrador no cuenta como versión');
    });
});
