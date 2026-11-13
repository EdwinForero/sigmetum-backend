// Flujo de extremo a extremo upload -> confirm -> update-file -> delete-file con la app REAL, el aws/awsS3connect.js REAL y un
// S3 con estado en memoria que pagina de 2 en 2 (sin red). Provincia Sevilla. No carga helpers/simulados.
require('./helpers/entorno');
// Credenciales ficticias (no empiezan por AKIA): el cliente nunca llega a firmar porque send está parcheado.
process.env.AWS_ACCESS_KEY_ID = 'ficticia-id-de-prueba';
process.env.AWS_SECRET_ACCESS_KEY = 'ficticia-clave-de-prueba';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { validToken } = require('./helpers/cognito');
const { fullRow, makeXlsx, subir } = require('./helpers/excel');
const { crearS3Simulado } = require('./helpers/s3-con-estado');

const s3 = crearS3Simulado({ pageSize: 2 });
let app;

const BASE = 'data/Sevilla';
const BORRADORES = 'data/drafts/Sevilla';
const ACTIVA = 'data/active/Sevilla.json';
const CLAVE_BORRADOR = /^data\/drafts\/Sevilla\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xlsx$/;
const CENTINELA = '[{"Municipio":"centinela"}]';
const token = validToken;
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
        const r = await subir(app, [fila('Écija'), fila('Osuna')], token);
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
    test('con celdas vacías: 400 con draftKey en data/drafts, el borrador queda guardado fuera de las versiones y el activo centinela no cambia', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        const r = await subir(app, [fila('Incompleta', true)], token);
        assert.equal(r.status, 400);
        assert.equal(r.json.success, false);
        assert.match(r.json.data.draftKey, CLAVE_BORRADOR);
        assert.ok(s3.existe(r.json.data.draftKey));
        assert.deepEqual(s3.claves(`${BASE}/`), [], 'el borrador no es una versión');
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(datos.body.data, [{ Municipio: 'centinela' }]);
    });
    test('segunda subida con celdas vacías: un único borrador y el draftKey anterior ya no existe', async (t) => {
        congelar(t);
        const primera = await subir(app, [fila('Uno', true)], token);
        const segunda = await subir(app, [fila('Dos', true)], token);
        assert.equal(primera.status, 400);
        assert.equal(segunda.status, 400);
        assert.notEqual(primera.json.data.draftKey, segunda.json.data.draftKey);
        assert.deepEqual(s3.claves(`${BORRADORES}/`), [segunda.json.data.draftKey]);
    });
    test('subida completa con un borrador previo: el prefijo de borradores queda vacío', async (t) => {
        congelar(t);
        const incompleta = await subir(app, [fila('Uno', true)], token);
        assert.equal(incompleta.status, 400);
        assert.equal(s3.claves(`${BORRADORES}/`).length, 1);
        const completa = await subir(app, [fila('Completa')], token);
        assert.equal(completa.status, 200, JSON.stringify(completa.json));
        assert.deepEqual(s3.claves(`${BORRADORES}/`), []);
        assert.deepEqual(municipiosDelActivo(), ['Completa']);
    });
    test('segunda subida con varias versiones (_v9 y _v10 del mismo día, más otros días): da _v11 (el orden por texto fallaría)', async (t) => {
        congelar(t);
        await sembrarVersion(`${DIA}_v9.xlsx`, 'v9');
        await sembrarVersion(`${DIA}_v10.xlsx`, 'v10');
        await sembrarVersion('2026-10-04_v3.xlsx', 'ayer');
        await sembrarVersion('2026-10-03_v1.xlsx', 'antes de ayer');
        await sembrarVersion('2026-10-06_v8.xlsx', 'mañana');
        const r = await subir(app, [fila('nueva')], token);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.data.key, `${BASE}/${DIA}_v11.xlsx`);
        assert.deepEqual(municipiosDelActivo(), ['nueva']);
    });
});

describe('confirm, cancel y update-file', () => {
    test('confirm: se crea la versión _v1, el activo se regenera desde ella y el borrador desaparece', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        const subida = await subir(app, [fila('Borrador', true)], token);
        assert.equal(subida.status, 400);
        const confirmado = await post('upload/confirm', { confirmed: true, draftKey: subida.json.data.draftKey });
        assert.equal(confirmado.status, 200);
        assert.ok(s3.existe(`${BASE}/${DIA}_v1.xlsx`));
        assert.equal(s3.existe(subida.json.data.draftKey), false);
        assert.deepEqual(municipiosDelActivo(), ['Borrador']);
        const datos = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(datos.body.data.map((x) => x.Municipio), ['Borrador']);
    });
    test('confirm con versiones previas del día: la versión nueva es la siguiente (_v3 tras _v1 y _v2)', async (t) => {
        congelar(t);
        await sembrarVersion(`${DIA}_v1.xlsx`, 'uno');
        await sembrarVersion(`${DIA}_v2.xlsx`, 'dos');
        const subida = await subir(app, [fila('Borrador', true)], token);
        assert.equal(subida.status, 400);
        const confirmado = await post('upload/confirm', { confirmed: true, draftKey: subida.json.data.draftKey });
        assert.equal(confirmado.status, 200);
        assert.deepEqual(s3.claves(`${BASE}/`), [`${BASE}/${DIA}_v1.xlsx`, `${BASE}/${DIA}_v2.xlsx`, `${BASE}/${DIA}_v3.xlsx`]);
        assert.deepEqual(municipiosDelActivo(), ['Borrador']);
    });
    test('cancel: el borrador se borra y el activo y las versiones no se tocan (A9)', async (t) => {
        congelar(t);
        await sembrarVersion('2026-10-01_v1.xlsx', 'anterior');
        s3.sembrar(ACTIVA, CENTINELA);
        const subida = await subir(app, [fila('Borrador', true)], token);
        assert.equal(subida.status, 400);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: subida.json.data.draftKey });
        assert.equal(cancelado.status, 200);
        assert.equal(s3.existe(subida.json.data.draftKey), false);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
        assert.deepEqual(s3.claves(`${BASE}/`), [`${BASE}/2026-10-01_v1.xlsx`]);
    });
    test('cancel del único borrador: no hay versiones y no se borra el activo', async (t) => {
        congelar(t);
        s3.sembrar(ACTIVA, CENTINELA);
        const subida = await subir(app, [fila('Borrador', true)], token);
        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: subida.json.data.draftKey });
        assert.equal(cancelado.status, 200);
        assert.deepEqual(s3.claves(`${BASE}/`), []);
        assert.deepEqual(s3.claves(`${BORRADORES}/`), []);
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
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

describe('GET /get-data con una versión .xlsx (convierte a JSON y exige token)', () => {
    const getVersion = (ruta, tokenDePrueba = token) => request(app).get(`/api/v1/${ruta}`).set('Authorization', `Bearer ${tokenDePrueba}`);
    const RUTA_V1 = `get-data/${BASE}/${DIA}_v1.xlsx`;
    const MENSAJE_404 = 'The requested file does not exist in storage';

    test('con token: la versión responde igual que el activo y que el JSON guardado, con la lista de especies limpia', async (t) => {
        congelar(t);
        const filaConEspecies = fila('Écija');
        filaConEspecies[10] = 'A, B , ,C';
        const r = await subir(app, [filaConEspecies, fila('Osuna')], token);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        const version = await getVersion(RUTA_V1);
        assert.equal(version.status, 200, JSON.stringify(version.body));
        const activo = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(version.body, activo.body);
        assert.deepEqual(version.body.data, JSON.parse(s3.leer(ACTIVA).toString()));
        assert.deepEqual(version.body.data[0]['Especies Características'], ['A', 'B', 'C']);
    });
    test('versión confirmada desde un borrador con celda vacía: igual que el activo y sin la clave vacía', async (t) => {
        congelar(t);
        const subida = await subir(app, [fila('Borrador', true)], token);
        assert.equal(subida.status, 400);
        const confirmado = await post('upload/confirm', { confirmed: true, draftKey: subida.json.data.draftKey });
        assert.equal(confirmado.status, 200);
        const version = await getVersion(RUTA_V1);
        assert.equal(version.status, 200, JSON.stringify(version.body));
        const activo = await getDatos('get-data/data/active/Sevilla.json');
        assert.deepEqual(version.body, activo.body);
        assert.equal('Altitud Media' in version.body.data[0], false);
    });
    test('provincia con tilde y la clave pedida con encodeURI: 200 igual que el activo', async (t) => {
        congelar(t);
        const r = await subir(app, [fullRow('Málaga')], token);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        const version = await getVersion(encodeURI(`get-data/data/Málaga/${DIA}_v1.xlsx`));
        assert.equal(version.status, 200, JSON.stringify(version.body));
        const activo = await getDatos(encodeURI('get-data/data/active/Málaga.json'));
        assert.equal(activo.status, 200);
        assert.deepEqual(version.body, activo.body);
        assert.deepEqual(version.body.data, JSON.parse(s3.leer('data/active/Málaga.json').toString()));
    });
    test('la versión .xlsx autenticada lleva Cache-Control: no-store y el activo .json no', async (t) => {
        congelar(t);
        const r = await subir(app, [fila('Écija')], token);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        const version = await getVersion(RUTA_V1);
        assert.equal(version.status, 200, JSON.stringify(version.body));
        assert.equal(version.headers['cache-control'], 'no-store');
        const activo = await getDatos('get-data/data/active/Sevilla.json');
        assert.equal(activo.status, 200);
        assert.notEqual(activo.headers['cache-control'], 'no-store');
    });
    test('versión inexistente: 404 con el cuerpo de siempre (regresión)', async () => {
        const res = await getVersion(RUTA_V1);
        assert.equal(res.status, 404);
        assert.deepEqual(res.body, { success: false, error: MENSAJE_404 });
    });
    test('archivo que no es un libro de Excel: 422 con mensaje público y el motivo en el log', async () => {
        s3.sembrar(`${BASE}/${DIA}_v1.xlsx`, Buffer.from('no es un libro'));
        const res = await getVersion(RUTA_V1);
        assert.equal(res.status, 422);
        assert.deepEqual(res.body, { success: false, error: 'The stored file is not a readable Excel workbook' });
        const textos = console.error.mock.calls.map((c) => c.arguments.map(String).join(' ')).join(' | ');
        assert.match(textos, /422/);
    });
    test('AccessDenied de S3 al leer la versión: 404 como siempre, no 422', async () => {
        s3.sembrar(`${BASE}/${DIA}_v1.xlsx`, await makeXlsx([fila('X')]));
        s3.alEnviar((llamada) => {
            if (llamada.op === 'Get') throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied', Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        });
        const res = await getVersion(RUTA_V1);
        assert.equal(res.status, 404);
        assert.deepEqual(res.body, { success: false, error: MENSAJE_404 });
    });
});
