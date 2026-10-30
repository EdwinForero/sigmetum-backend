// Borradores de POST /upload en su propio prefijo (A2 y A9): data/drafts/<provincia>/<uuid>.xlsx. Con la app REAL, el
// aws/awsS3connect.js REAL y un S3 con estado en memoria (sin red). Provincia Sevilla. No carga helpers/simulados.
// Cubre la separación de claves entre rutas, el ciclo de vida del borrador y los errores de cada paso.
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
const { getProvinciaNameError } = require('../functions/validateProvincia');
const { isValidDraftKey } = require('../functions/validateDataKey');

const s3 = crearS3Simulado({ pageSize: 50 });
let app;

const BASE = 'data/Sevilla';
const BORRADORES = 'data/drafts/Sevilla';
const ACTIVA = 'data/active/Sevilla.json';
const CENTINELA = '[{"Municipio":"centinela"}]';
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const token = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });
const post = (ruta, cuerpo) => request(app).post(`/api/v1/${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo);

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
const subirIncompleta = async (municipio) => {
    const r = await subir(app, [fila(municipio, true)], tokenDelInstante);
    assert.equal(r.status, 400);
    return r.json.data.draftKey;
};

before(() => {
    s3.instalar();
    app = require('../app');
});
after(() => s3.restaurar());
beforeEach((t) => {
    s3.reiniciar();
    t.mock.method(console, 'error', () => {});
});

describe('el borrador no es una versión', () => {
    test('GET /list-files no devuelve drafts como provincia ni el Excel del borrador', async (t) => {
        congelar(t);
        await sembrarVersion('2026-10-01_v1.xlsx', 'real');
        const draftKey = await subirIncompleta('incompleta');
        const res = await request(app).get('/api/v1/list-files');
        assert.equal(res.status, 200);
        assert.deepEqual(Object.keys(res.body.data), ['Sevilla']);
        assert.deepEqual(res.body.data.Sevilla.map((f) => f.key), [`${BASE}/2026-10-01_v1.xlsx`]);
        assert.ok(!JSON.stringify(res.body).includes(draftKey));
    });
    test('POST /delete-file con un borrador presente regenera el activo desde la última versión real, sin leer el borrador', async (t) => {
        congelar(t);
        await sembrarVersion('2026-10-01_v1.xlsx', 'antigua');
        await sembrarVersion('2026-10-02_v1.xlsx', 'ultima');
        await sembrarVersion('2026-10-03_v1.xlsx', 'a borrar');
        s3.sembrar(ACTIVA, CENTINELA);
        const draftKey = await subirIncompleta('borrador');
        s3.llamadas.length = 0;
        const res = await post('delete-file', { fileName: `${BASE}/2026-10-03_v1.xlsx` });
        assert.equal(res.status, 200);
        assert.deepEqual(municipiosDelActivo(), ['ultima']);
        assert.deepEqual(s3.llamadas.filter((c) => c.op === 'Get').map((c) => c.key), [`${BASE}/2026-10-02_v1.xlsx`]);
        assert.ok(s3.existe(draftKey), 'borrar una versión no toca el borrador');
    });
    test('provincias con nombre que comparte prefijo (Sevilla y Sevilla Norte) no mezclan sus borradores', async (t) => {
        congelar(t);
        const ajeno = `data/drafts/Sevilla Norte/${UUID}.xlsx`;
        s3.sembrar(ajeno, await makeXlsx([fila('norte')]));
        const draftKey = await subirIncompleta('sevilla');
        assert.ok(s3.existe(ajeno), 'la subida de Sevilla no descarta el borrador de Sevilla Norte');
        const completa = await subir(app, [fila('completa')], tokenDelInstante);
        assert.equal(completa.status, 200);
        assert.ok(s3.existe(ajeno));
        assert.equal(s3.existe(draftKey), false);
        const cancelado = await post('upload/confirm', { confirmed: false, draftKey: ajeno });
        assert.equal(cancelado.status, 200);
        assert.equal(s3.existe(ajeno), false);
    });
    test('Drafts con mayúscula no es un nombre reservado: validateProvincia lo admite y su borrador tiene clave válida', () => {
        assert.equal(getProvinciaNameError('Drafts'), null);
        assert.equal(getProvinciaNameError('drafts'), 'Province is reserved');
        assert.equal(isValidDraftKey(`data/drafts/Drafts/${UUID}.xlsx`), true);
    });
});

describe('separación de claves entre rutas (sin llamadas a S3)', () => {
    const version = `${BASE}/2026-10-05_v1.xlsx`;
    const borrador = `${BORRADORES}/${UUID}.xlsx`;
    const malformadasDeBorrador = [
        `data/drafts/drafts/${UUID}.xlsx`, `data/drafts/../${UUID}.xlsx`,
        `data/drafts/Sevilla/x/${UUID}.xlsx`, `data/drafts/${UUID}.xlsx`,
    ];
    const malformadasDeVersion = [`data/drafts/${UUID}.xlsx`, `data/Sevilla/x/2026-10-05_v1.xlsx`, `data/../2026-10-05_v1.xlsx`];

    test('/upload/confirm rechaza una clave de versión con 400 Invalid draftKey', async () => {
        for (const confirmed of [true, false]) {
            const res = await post('upload/confirm', { confirmed, draftKey: version });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { success: false, error: 'Invalid draftKey' });
        }
        assert.equal(s3.llamadas.length, 0);
    });
    test('/update-file y /delete-file rechazan una clave de borrador con 400 Invalid fileName', async () => {
        for (const ruta of ['update-file', 'delete-file']) {
            const res = await post(ruta, { fileName: borrador });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { success: false, error: 'Invalid fileName' });
        }
        assert.equal(s3.llamadas.length, 0);
    });
    test('entradas malformadas en ambas direcciones: 400 y ninguna llamada a S3', async () => {
        for (const draftKey of malformadasDeBorrador) {
            const res = await post('upload/confirm', { confirmed: false, draftKey });
            assert.deepEqual([res.status, res.body.error], [400, 'Invalid draftKey'], draftKey);
        }
        for (const fileName of [...malformadasDeVersion, ...malformadasDeBorrador]) {
            for (const ruta of ['update-file', 'delete-file']) {
                const res = await post(ruta, { fileName });
                assert.deepEqual([res.status, res.body.error], [400, 'Invalid fileName'], `${ruta} ${fileName}`);
            }
        }
        assert.equal(s3.llamadas.length, 0);
    });
});

describe('ciclo de vida del borrador', () => {
    test('un draftKey ya descartado, cancelado o confirmado da 404 Draft not found y no deja Put ni Delete tras el List', async (t) => {
        congelar(t);
        const descartado = await subirIncompleta('uno');
        await subirIncompleta('dos');
        const cancelado = await subirIncompleta('tres');
        assert.equal((await post('upload/confirm', { confirmed: false, draftKey: cancelado })).status, 200);
        const confirmado = await subirIncompleta('cuatro');
        assert.equal((await post('upload/confirm', { confirmed: true, draftKey: confirmado })).status, 200);
        s3.sembrar(ACTIVA, CENTINELA);

        for (const draftKey of [descartado, cancelado, confirmado]) {
            for (const confirmed of [true, false]) {
                s3.llamadas.length = 0;
                const res = await post('upload/confirm', { confirmed, draftKey });
                assert.equal(res.status, 404, draftKey);
                assert.deepEqual(res.body, { success: false, error: 'Draft not found' });
                assert.deepEqual(s3.llamadas.map((c) => c.op), ['List']);
            }
        }
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
    });
    test('un Excel de borrador no convertible da 500 sin escribir ninguna versión y el borrador sigue', async (t) => {
        congelar(t);
        const draftKey = `${BORRADORES}/${UUID}.xlsx`;
        s3.sembrar(draftKey, 'esto no es un xlsx');
        s3.sembrar(ACTIVA, CENTINELA);
        const res = await post('upload/confirm', { confirmed: true, draftKey });
        assert.equal(res.status, 500);
        assert.equal(s3.llamadas.filter((c) => c.op === 'Put' || c.op === 'Delete').length, 0);
        assert.deepEqual(s3.claves(`${BASE}/`), []);
        assert.ok(s3.existe(draftKey));
        assert.equal(s3.leer(ACTIVA).toString(), CENTINELA);
    });
    test('confirmación interrumpida al escribir el activo: 500, el borrador sigue y repetirla crea la versión siguiente y lo borra', async (t) => {
        congelar(t);
        const draftKey = await subirIncompleta('borrador');
        s3.alEnviar((llamada) => { if (llamada.op === 'Put' && llamada.key === ACTIVA) throw new Error('fallo interno de prueba'); });
        const fallida = await post('upload/confirm', { confirmed: true, draftKey });
        assert.equal(fallida.status, 500);
        assert.ok(!fallida.body.error.includes('interno'));
        assert.ok(s3.existe(draftKey), 'el borrador sigue tras la interrupción');
        assert.equal(s3.existe(ACTIVA), false);

        s3.alEnviar(null);
        const repetida = await post('upload/confirm', { confirmed: true, draftKey });
        assert.equal(repetida.status, 200);
        assert.equal(s3.existe(draftKey), false);
        assert.deepEqual(s3.claves(`${BASE}/`), [`${BASE}/${DIA}_v1.xlsx`, `${BASE}/${DIA}_v2.xlsx`]);
        assert.deepEqual(municipiosDelActivo(), ['borrador']);
    });
    test('subida completa cuyo descarte de borradores falla: 200, la versión y el activo ya están escritos', async (t) => {
        congelar(t);
        const previo = await subirIncompleta('previo');
        s3.alEnviar((llamada) => { if (llamada.op === 'Delete') throw new Error('fallo interno de prueba'); });
        const res = await subir(app, [fila('completa')], tokenDelInstante);
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.deepEqual(municipiosDelActivo(), ['completa']);
        assert.ok(s3.existe(`${BASE}/${DIA}_v1.xlsx`));
        assert.ok(s3.existe(previo), 'queda un borrador viejo que limpiará una subida posterior');
    });
    test('subida con celdas vacías cuyo descarte del previo falla: 500 y el borrador nuevo ya existe', async (t) => {
        congelar(t);
        const previo = await subirIncompleta('previo');
        s3.alEnviar((llamada) => { if (llamada.op === 'Delete') throw new Error('fallo interno de prueba'); });
        const res = await subir(app, [fila('nuevo', true)], tokenDelInstante);
        assert.equal(res.status, 500);
        assert.equal(s3.claves(`${BORRADORES}/`).length, 2);
        assert.ok(s3.existe(previo));
    });
});

describe('operaciones sobre S3', () => {
    test('un ciclo completo (subir, confirmar, subir, cancelar, subir completa) solo usa List, Get, Put y Delete', async (t) => {
        congelar(t);
        const a = await subirIncompleta('a');
        assert.equal((await post('upload/confirm', { confirmed: true, draftKey: a })).status, 200);
        const b = await subirIncompleta('b');
        assert.equal((await post('upload/confirm', { confirmed: false, draftKey: b })).status, 200);
        assert.equal((await subir(app, [fila('c')], tokenDelInstante)).status, 200);
        const ops = new Set(s3.llamadas.map((c) => c.op));
        assert.deepEqual([...ops].sort(), ['Delete', 'Get', 'List', 'Put']);
    });
});
