// Robustez de S3 (A5/D5, A6, A8, M7, M10) sobre el aws/awsS3connect.js REAL con S3Client.prototype.send parcheado (sin red).
// Este archivo no carga helpers/simulados: construye la app por su cuenta y no inyecta los espías de S3.
const { TEST_SECRET } = require('./helpers/entorno');
// Credenciales ficticias (no empiezan por AKIA) para que la firma de URLs no consulte ningún proveedor.
process.env.AWS_ACCESS_KEY_ID = 'ficticia-id-de-prueba';
process.env.AWS_SECRET_ACCESS_KEY = 'ficticia-clave-de-prueba';

const path = require('node:path');
const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { fullRow, makeXlsx } = require('./helpers/excel');
const {
    S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const ROOT = path.join(__dirname, '..');
let realAws;
let app;
let enviar;
// Estado mutable que guía las respuestas de `send`; se reinicia en beforeEach.
let estado;
const nuevoEstado = () => ({
    list: () => ({ Contents: [] }),
    get: () => ({ Body: Readable.from([Buffer.from('[]')]) }),
    put: () => ({}),
    del: () => ({}),
    llamadas: [],
});

const awsError = (name, Code, status = 400) => Object.assign(new Error(`${name} interno de prueba`), { name, Code, $fault: 'client', $metadata: { httpStatusCode: status } });
// Fallo de red de Node: `code` en minúscula, sin $metadata.
const errorRed = (code) => Object.assign(new Error(`${code} interno de prueba`), { name: 'Error', code });
const cuerpo = (texto) => ({ Body: Readable.from([Buffer.from(texto)]) });
const puts = () => estado.llamadas.filter((c) => c instanceof PutObjectCommand);
const token = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });

before(() => {
    enviar = mock.method(S3Client.prototype, 'send', async function send(command) {
        estado.llamadas.push(command);
        if (command instanceof ListObjectsV2Command) return estado.list(command);
        if (command instanceof GetObjectCommand) return estado.get(command);
        if (command instanceof PutObjectCommand) return estado.put(command);
        if (command instanceof DeleteObjectCommand) return estado.del(command);
        return {};
    });
    realAws = require('../aws/awsS3connect.js');
    for (const modulo of ['routes/auth.js', 'routes/content.js', 'app.js']) delete require.cache[path.join(ROOT, modulo)];
    app = require('../app');
});
after(() => enviar.mock.restore());
beforeEach((t) => {
    estado = nuevoEstado();
    t.mock.method(console, 'error', () => {});
});

const listados = () => estado.llamadas.filter((c) => c instanceof ListObjectsV2Command);

// ─── A5 + M10: objeto real, paginación con guardia y galería vacía ───────────────────────────────

describe('listado paginado y objeto real', () => {
    const dosPaginas = () => {
        estado.list = (command) => (command.input.ContinuationToken === 'tok1'
            ? { Contents: [{ Key: 'gallery/b.png', Size: 5 }], IsTruncated: false }
            : { Contents: [{ Key: 'gallery/a.png', Size: 5 }], IsTruncated: true, NextContinuationToken: 'tok1' });
    };
    const soloEnvuelto = { Contents: [{ Key: 'gallery/', Size: 0 }, { Key: 'gallery/vacio.png', Size: 0 }, { Key: 'gallery/real.png', Size: 7 }] };

    test('listFilesInS3Folder recorre dos páginas con ContinuationToken', async () => {
        dosPaginas();
        const lista = await realAws.listFilesInS3Folder('gallery');
        assert.deepEqual(lista, [{ name: 'a.png', key: 'gallery/a.png' }, { name: 'b.png', key: 'gallery/b.png' }]);
        assert.equal(listados().length, 2);
        assert.equal(listados()[1].input.ContinuationToken, 'tok1');
    });
    test('getPresignedUrlsFromS3Folder recorre dos páginas con ContinuationToken', async () => {
        dosPaginas();
        const lista = await realAws.getPresignedUrlsFromS3Folder('gallery');
        assert.deepEqual(lista.map((f) => f.fileName), ['a.png', 'b.png']);
        assert.equal(listados().length, 2);
        assert.equal(listados()[1].input.ContinuationToken, 'tok1');
    });
    for (const [nombre, fn] of [['listFilesInS3Folder', 'listFilesInS3Folder'], ['getPresignedUrlsFromS3Folder', 'getPresignedUrlsFromS3Folder']]) {
        test(`${nombre} rechaza un token de continuación repetido`, async () => {
            estado.list = () => ({ Contents: [{ Key: 'gallery/a.png', Size: 5 }], IsTruncated: true, NextContinuationToken: 'igual' });
            await assert.rejects(() => realAws[fn]('gallery'));
            assert.ok(listados().length <= 3, `llamadas=${listados().length}`);
        });
        test(`${nombre} rechaza IsTruncated sin NextContinuationToken`, async () => {
            estado.list = () => ({ Contents: [{ Key: 'gallery/a.png', Size: 5 }], IsTruncated: true });
            await assert.rejects(() => realAws[fn]('gallery'));
        });
        test(`${nombre} continúa si una página intermedia no trae Contents`, async () => {
            estado.list = (command) => {
                const t = command.input.ContinuationToken;
                if (t === 't2') return { Contents: [{ Key: 'gallery/c.png', Size: 5 }], IsTruncated: false };
                if (t === 't1') return { IsTruncated: true, NextContinuationToken: 't2' };
                return { Contents: [{ Key: 'gallery/a.png', Size: 5 }], IsTruncated: true, NextContinuationToken: 't1' };
            };
            const lista = await realAws[fn]('gallery');
            assert.equal(lista.length, 2);
            assert.equal(listados().length, 3);
        });
    }
    test('listFilesInS3Folder excluye el marcador de carpeta y los objetos de tamaño 0', async () => {
        estado.list = () => soloEnvuelto;
        assert.deepEqual(await realAws.listFilesInS3Folder('gallery'), [{ name: 'real.png', key: 'gallery/real.png' }]);
    });
    test('getPresignedUrlsFromS3Folder excluye el marcador de carpeta y los objetos de tamaño 0', async () => {
        estado.list = () => soloEnvuelto;
        const lista = await realAws.getPresignedUrlsFromS3Folder('gallery');
        assert.deepEqual(lista.map((f) => f.fileName), ['real.png']);
    });
    test('formato intacto: { name, key } y { fileName, url }', async () => {
        estado.list = () => ({ Contents: [{ Key: 'gallery/sub/x.png', Size: 3 }] });
        assert.deepEqual(await realAws.listFilesInS3Folder('gallery'), [{ name: 'x.png', key: 'gallery/sub/x.png' }]);
        const [item] = await realAws.getPresignedUrlsFromS3Folder('gallery');
        assert.deepEqual(Object.keys(item).sort(), ['fileName', 'url']);
        assert.equal(item.fileName, 'sub/x.png');
        assert.match(item.url, /^https:\/\//);
    });
});

describe('GET /list-images con el aws real', () => {
    test('galería vacía: 200 con data []', async () => {
        estado.list = () => ({ Contents: [] });
        const res = await request(app).get('/api/v1/list-images');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: [] });
    });
    test('listado ausente: 200 con data []', async () => {
        estado.list = () => ({});
        const res = await request(app).get('/api/v1/list-images');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: [] });
    });
    test('solo el marcador de carpeta: 200 con data []', async () => {
        estado.list = () => ({ Contents: [{ Key: 'gallery/', Size: 0 }] });
        const res = await request(app).get('/api/v1/list-images');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: [] });
    });
    test('AccessDenied: 500 por next(error)', async () => {
        estado.list = () => { throw awsError('AccessDenied', 'AccessDenied', 403); };
        const res = await request(app).get('/api/v1/list-images');
        assert.equal(res.status, 500);
        assert.equal(res.body.success, false);
        assert.equal(typeof res.body.error, 'string');
        assert.ok(!res.body.error.includes('interno de prueba'));
    });
});

// ─── A6: solo NoSuchKey es «no existe» ───────────────────────────────────────────────────────────

describe('getTextJsonS3 y glosario', () => {
    const fallos = [
        ['AccessDenied', () => { throw awsError('AccessDenied', 'AccessDenied', 403); }],
        ['NoSuchBucket (404)', () => { throw awsError('NoSuchBucket', 'NoSuchBucket', 404); }],
        ['error de red', () => { throw Object.assign(new Error('ECONNRESET interno de prueba'), { name: 'Error', code: 'ECONNRESET' }); }],
        ['5xx', () => { throw awsError('InternalError', 'InternalError', 500); }],
        ['cuerpo no JSON', () => cuerpo('esto no es json')],
        ['cuerpo vacío', () => cuerpo('')],
        ['JSON que no es un array ({})', () => cuerpo('{}')],
        ['JSON null', () => cuerpo('null')],
    ];

    test('NoSuchKey por name devuelve []', async () => {
        estado.get = () => { throw awsError('NoSuchKey', undefined, 404); };
        assert.deepEqual(await realAws.getTextJsonS3('t.json', 'data/terms'), []);
    });
    test('NoSuchKey por Code devuelve []', async () => {
        estado.get = () => { throw awsError('Error', 'NoSuchKey', 404); };
        assert.deepEqual(await realAws.getTextJsonS3('t.json', 'data/terms'), []);
    });
    test('un array válido se devuelve tal cual', async () => {
        estado.get = () => cuerpo('[{"term":"a"}]');
        assert.deepEqual(await realAws.getTextJsonS3('t.json', 'data/terms'), [{ term: 'a' }]);
    });

    for (const [nombre, fallo] of fallos) {
        describe(nombre, () => {
            beforeEach(() => { estado.get = fallo; });

            test('getTextJsonS3 rechaza', async () => {
                await assert.rejects(() => realAws.getTextJsonS3('t.json', 'data/terms'));
            });
            test('uploadTextToJsonS3 rechaza y no escribe', async () => {
                await assert.rejects(() => realAws.uploadTextToJsonS3('x', 't.json', 'data/terms'));
                assert.equal(puts().length, 0);
            });
            test('deleteTermFromS3 rechaza y no escribe', async () => {
                await assert.rejects(() => realAws.deleteTermFromS3('x', 't.json', 'data/terms'));
                assert.equal(puts().length, 0);
            });
            test('GET /list-terms: 500 con envoltorio y sin texto interno', async () => {
                const res = await request(app).get('/api/v1/list-terms');
                assert.equal(res.status, 500);
                assert.equal(res.body.success, false);
                assert.equal(typeof res.body.error, 'string');
                assert.ok(!res.body.error.includes('interno de prueba'));
            });
            test('POST /upload-term: 500 sin PutObject', async () => {
                const res = await request(app).post('/api/v1/upload-term').set('Authorization', `Bearer ${token}`).send({ term: 'x' });
                assert.equal(res.status, 500);
                assert.equal(res.body.success, false);
                assert.equal(typeof res.body.error, 'string');
                assert.ok(!res.body.error.includes('interno de prueba'));
                assert.equal(puts().length, 0);
            });
            test('DELETE /delete-term: 500 sin PutObject', async () => {
                const res = await request(app).delete('/api/v1/delete-term').set('Authorization', `Bearer ${token}`).send({ term: 'x' });
                assert.equal(res.status, 500);
                assert.equal(res.body.success, false);
                assert.equal(typeof res.body.error, 'string');
                assert.ok(!res.body.error.includes('interno de prueba'));
                assert.equal(puts().length, 0);
            });
        });
    }

    describe('con NoSuchKey (glosario aún no creado)', () => {
        beforeEach(() => { estado.get = () => { throw awsError('NoSuchKey', 'NoSuchKey', 404); }; });

        test('uploadTextToJsonS3 escribe un PutObject con [{ term }]', async () => {
            await realAws.uploadTextToJsonS3('nuevo', 't.json', 'data/terms');
            assert.equal(puts().length, 1);
            assert.equal(puts()[0].input.Key, 'data/terms/t.json');
            assert.deepEqual(JSON.parse(puts()[0].input.Body), [{ term: 'nuevo' }]);
        });
        test('GET /list-terms: 200 con data []', async () => {
            const res = await request(app).get('/api/v1/list-terms');
            assert.equal(res.status, 200);
            assert.deepEqual(res.body, { success: true, data: [] });
        });
    });
});

// ─── M7: lecturas en paralelo con orden determinista ─────────────────────────────────────────────

describe('getMergedDataInS3Folder', () => {
    const claves = ['data/active/A.json', 'data/active/B.json', 'data/active/C.json', 'data/active/D.json'];
    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    beforeEach(() => { estado.list = () => ({ Contents: claves.map((Key) => ({ Key, Size: 10 })) }); });

    test('lee en paralelo (más de una lectura simultánea)', async () => {
        let activas = 0;
        let maximo = 0;
        estado.get = async (command) => {
            activas += 1;
            maximo = Math.max(maximo, activas);
            await esperar(20);
            activas -= 1;
            return cuerpo(JSON.stringify([{ k: command.input.Key }]));
        };
        await realAws.getMergedDataInS3Folder('data/active');
        assert.ok(maximo > 1, `máximo simultáneo=${maximo}`);
    });
    test('el resultado sigue el orden del listado, no el de finalización', async () => {
        const retraso = { 'data/active/A.json': 60, 'data/active/B.json': 40, 'data/active/C.json': 20, 'data/active/D.json': 1 };
        estado.get = async (command) => {
            await esperar(retraso[command.input.Key]);
            return cuerpo(JSON.stringify([{ k: command.input.Key }]));
        };
        const datos = await realAws.getMergedDataInS3Folder('data/active');
        assert.deepEqual(datos.map((d) => d.k), claves);
    });
    test('si una lectura falla, rechaza sin datos parciales', async () => {
        estado.get = async (command) => {
            if (command.input.Key === 'data/active/C.json') throw awsError('InternalError', 'InternalError', 500);
            return cuerpo('[{"ok":1}]');
        };
        await assert.rejects(() => realAws.getMergedDataInS3Folder('data/active'));
    });
});

// ─── A8: deleteFileFromS3 con orden numérico y tres casos ────────────────────────────────────────

describe('deleteFileFromS3 y getNextVersion', () => {
    const base = 'data/Sevilla';
    const activa = 'data/active/Sevilla.json';
    const lista = (...nombres) => { estado.list = () => ({ Contents: nombres.map((n) => ({ Key: `${base}/${n}`, Size: 10 })) }); };
    const sobreActiva = (Clase) => estado.llamadas.filter((c) => c instanceof Clase && c.input.Key === activa);
    let xlsx;
    before(async () => { xlsx = await makeXlsx([fullRow('Sevilla')]); });
    beforeEach(() => {
        estado.get = () => ({ Body: Readable.from([xlsx]) });
    });

    test('(a) con _v9 y _v10 regenera el activo desde _v10', async () => {
        lista('2026-10-05_v9.xlsx', '2026-10-05_v10.xlsx');
        await realAws.deleteFileFromS3(`${base}/2026-10-05_v11.xlsx`);
        const lecturas = estado.llamadas.filter((c) => c instanceof GetObjectCommand).map((c) => c.input.Key);
        assert.deepEqual(lecturas, [`${base}/2026-10-05_v10.xlsx`]);
        const escrituras = sobreActiva(PutObjectCommand);
        assert.equal(escrituras.length, 1);
        assert.ok(Array.isArray(JSON.parse(escrituras[0].input.Body)));
        assert.equal(sobreActiva(DeleteObjectCommand).length, 0);
    });
    test('(b) solo .xlsx no estándar: no toca el activo', async () => {
        lista('manual.xlsx');
        await realAws.deleteFileFromS3(`${base}/2026-10-05_v1.xlsx`);
        assert.equal(sobreActiva(PutObjectCommand).length, 0);
        assert.equal(sobreActiva(DeleteObjectCommand).length, 0);
    });
    test('(c) sin ningún .xlsx: borra el activo', async () => {
        lista('notas.txt');
        await realAws.deleteFileFromS3(`${base}/2026-10-05_v1.xlsx`);
        assert.equal(sobreActiva(DeleteObjectCommand).length, 1);
        assert.equal(sobreActiva(PutObjectCommand).length, 0);
    });
    test('getNextVersion con _v9 y _v10 del mismo día da 11', async () => {
        lista('2026-10-05_v9.xlsx', '2026-10-05_v10.xlsx');
        const { getNextVersion } = require('../functions/getNextVersion');
        const { version } = await getNextVersion('Sevilla', new Date('2026-10-05T12:00:00Z'));
        assert.equal(version, 11);
    });
});

// ─── B5: delete-image y delete-term propagan el error original a errorHandler ────────────────────

describe('B5 delete-image y delete-term', () => {
    const auth = (req) => req.set('Authorization', `Bearer ${token}`);
    // Cada ruta hace fallar la operación de S3 que usa: delete-image borra un objeto; delete-term lee el glosario.
    const rutas = [
        ['DELETE /delete-image', (fallo) => { estado.del = fallo; }, () => auth(request(app).delete('/api/v1/delete-image')).send({ imageKey: 'foto.jpg' })],
        ['DELETE /delete-term', (fallo) => { estado.get = fallo; }, () => auth(request(app).delete('/api/v1/delete-term')).send({ term: 'x' })],
    ];
    const fallos = [
        ['AccessDenied', () => awsError('AccessDenied', 'AccessDenied', 403), 'Access denied to storage'],
        ['NoSuchBucket', () => awsError('NoSuchBucket', 'NoSuchBucket', 404), 'Storage bucket is not configured correctly'],
        ['red (ECONNREFUSED)', () => errorRed('ECONNREFUSED'), 'Storage connection error'],
        ['sin código', () => new Error('secreto interno'), 'Internal server error'],
    ];

    for (const [ruta, sembrar, pedir] of rutas) {
        for (const [nombre, crear, texto] of fallos) {
            test(`${ruta} con ${nombre}: 500 ${texto} sin texto interno`, async () => {
                sembrar(() => { throw crear(); });
                const res = await pedir();
                assert.equal(res.status, 500);
                assert.deepEqual(res.body, { success: false, error: texto });
                assert.ok(!res.body.error.includes('interno'));
            });
        }
    }

    test('deleteImageFromS3 rechaza con el error original', async () => {
        const original = awsError('AccessDenied', 'AccessDenied', 403);
        estado.del = () => { throw original; };
        await assert.rejects(() => realAws.deleteImageFromS3('gallery', 'foto.jpg'), (e) => e === original && e.name === 'AccessDenied' && e.Code === 'AccessDenied');
    });
    test('deleteTermFromS3 rechaza con el error original', async () => {
        const original = awsError('AccessDenied', 'AccessDenied', 403);
        estado.get = () => { throw original; };
        await assert.rejects(() => realAws.deleteTermFromS3('x', 't.json', 'data/terms'), (e) => e === original && e.name === 'AccessDenied' && e.Code === 'AccessDenied');
        assert.equal(puts().length, 0);
    });
    test('deleteTermFromS3 rechaza con el error de escritura original', async () => {
        const original = awsError('AccessDenied', 'AccessDenied', 403);
        estado.get = () => cuerpo('[{"term":"x"}]');
        estado.put = () => { throw original; };
        await assert.rejects(() => realAws.deleteTermFromS3('x', 't.json', 'data/terms'), (e) => e === original);
    });

    test('delete-image con S3 correcto: 200 y un solo DeleteObject sobre gallery/<clave>', async () => {
        const res = await auth(request(app).delete('/api/v1/delete-image')).send({ imageKey: 'foto.jpg' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: 'Image deleted successfully' });
        const borrados = estado.llamadas.filter((c) => c instanceof DeleteObjectCommand);
        assert.equal(borrados.length, 1);
        assert.equal(borrados[0].input.Key, 'gallery/foto.jpg');
    });
    test('delete-term con S3 correcto: 200 y un solo PutObject sin el término', async () => {
        estado.get = () => cuerpo('[{"term":"x"},{"term":"y"}]');
        const res = await auth(request(app).delete('/api/v1/delete-term')).send({ term: 'x' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, data: 'Term deleted successfully' });
        assert.equal(puts().length, 1);
        assert.deepEqual(JSON.parse(puts()[0].input.Body), [{ term: 'y' }]);
    });

    test('los 400 de validación no cambian y no llaman a S3', async () => {
        const a = await auth(request(app).delete('/api/v1/delete-image')).send({});
        const b = await auth(request(app).delete('/api/v1/delete-image')).send({ imageKey: '../x.jpg' });
        const c = await auth(request(app).delete('/api/v1/delete-term')).send({});
        assert.deepEqual([a.status, b.status, c.status], [400, 400, 400]);
        assert.equal(estado.llamadas.length, 0);
    });
});

// ─── B9: NoSuchKey responde 404 en errorHandler (global) ─────────────────────────────────────────

describe('B9 NoSuchKey a 404', () => {
    const auth = (req) => req.set('Authorization', `Bearer ${token}`);
    const CLAVE = 'data/Sevilla/2026-10-05_v1.xlsx';
    const MENSAJE = 'The requested file does not exist in storage';
    const faltaObjeto = (error) => () => { throw error; };
    const rutas = [
        ['GET /get-data/<clave>', () => request(app).get('/api/v1/get-data/data/active/Sevilla.json')],
        ['POST /update-file', () => auth(request(app).post('/api/v1/update-file')).send({ fileName: CLAVE })],
        ['POST /upload/confirm (confirmar)', () => auth(request(app).post('/api/v1/upload/confirm')).send({ confirmed: true, draftKey: CLAVE })],
    ];
    const variantes = [
        ['name y Code', () => awsError('NoSuchKey', 'NoSuchKey', 404)],
        ['solo name', () => awsError('NoSuchKey', undefined, 404)],
        ['solo Code', () => awsError('Error', 'NoSuchKey', 404)],
    ];

    for (const [ruta, pedir] of rutas) {
        for (const [variante, crear] of variantes) {
            test(`${ruta} con NoSuchKey (${variante}): 404 con cuerpo exacto`, async () => {
                estado.get = faltaObjeto(crear());
                const res = await pedir();
                assert.equal(res.status, 404);
                assert.deepEqual(res.body, { success: false, error: MENSAJE });
                assert.ok(!JSON.stringify(res.body).includes('Sevilla') && !JSON.stringify(res.body).includes('interno de prueba'));
            });
        }
    }

    describe('en carrera (el objeto desaparece entre el listado y la lectura)', () => {
        test('GET /get-merged-data: 404', async () => {
            estado.list = () => ({ Contents: [{ Key: 'data/active/Sevilla.json', Size: 10 }] });
            estado.get = faltaObjeto(awsError('NoSuchKey', 'NoSuchKey', 404));
            const res = await request(app).get('/api/v1/get-merged-data');
            assert.equal(res.status, 404);
            assert.deepEqual(res.body, { success: false, error: MENSAJE });
        });
        test('POST /delete-file: el borrado ocurre y la lectura posterior da 404', async () => {
            estado.list = () => ({ Contents: [{ Key: 'data/Sevilla/2026-10-04_v1.xlsx', Size: 10 }] });
            estado.get = faltaObjeto(awsError('NoSuchKey', 'NoSuchKey', 404));
            const res = await auth(request(app).post('/api/v1/delete-file')).send({ fileName: CLAVE });
            assert.equal(res.status, 404);
            assert.deepEqual(res.body, { success: false, error: MENSAJE });
            assert.ok(estado.llamadas.some((c) => c instanceof DeleteObjectCommand && c.input.Key === CLAVE));
        });
        test('POST /upload/confirm al cancelar: 404', async () => {
            estado.list = () => ({ Contents: [{ Key: 'data/Sevilla/2026-10-04_v1.xlsx', Size: 10 }] });
            estado.get = faltaObjeto(awsError('NoSuchKey', 'NoSuchKey', 404));
            const res = await auth(request(app).post('/api/v1/upload/confirm')).send({ confirmed: false, draftKey: CLAVE });
            assert.equal(res.status, 404);
            assert.deepEqual(res.body, { success: false, error: MENSAJE });
        });
    });

    describe('lo que no cambia (ya pasaba antes de B9)', () => {
        test('DELETE /delete-image de una clave inexistente: 200', async () => {
            const res = await auth(request(app).delete('/api/v1/delete-image')).send({ imageKey: 'no-existe.jpg' });
            assert.equal(res.status, 200);
        });
        test('POST /delete-file de una clave inexistente sin carrera: 200', async () => {
            const res = await auth(request(app).post('/api/v1/delete-file')).send({ fileName: CLAVE });
            assert.equal(res.status, 200);
        });
        test('GET /get-image: 200 con imageUrl y sin llamadas a S3', async () => {
            const res = await request(app).get('/api/v1/get-image?imageKey=a.jpg');
            assert.equal(res.status, 200);
            assert.equal(typeof res.body.data.imageUrl, 'string');
            assert.equal(estado.llamadas.length, 0);
        });
        describe('glosario inexistente (A6 captura NoSuchKey dentro de aws/)', () => {
            beforeEach(() => { estado.get = faltaObjeto(awsError('NoSuchKey', 'NoSuchKey', 404)); });
            test('delete-term: 200 con un solo PutObject con []', async () => {
                const res = await auth(request(app).delete('/api/v1/delete-term')).send({ term: 'x' });
                assert.equal(res.status, 200);
                assert.equal(puts().length, 1);
                assert.deepEqual(JSON.parse(puts()[0].input.Body), []);
            });
            test('upload-term: 200 con un solo PutObject con [{ term }]', async () => {
                const res = await auth(request(app).post('/api/v1/upload-term')).send({ term: 'x' });
                assert.equal(res.status, 200);
                assert.equal(puts().length, 1);
                assert.deepEqual(JSON.parse(puts()[0].input.Body), [{ term: 'x' }]);
            });
            test('list-terms: 200 con []', async () => {
                const res = await request(app).get('/api/v1/list-terms');
                assert.equal(res.status, 200);
                assert.deepEqual(res.body, { success: true, data: [] });
            });
        });
        for (const [nombre, crear, texto] of [
            ['NoSuchBucket', () => awsError('NoSuchBucket', 'NoSuchBucket', 404), 'Storage bucket is not configured correctly'],
            ['AccessDenied', () => awsError('AccessDenied', 'AccessDenied', 403), 'Access denied to storage'],
            ['red', () => errorRed('ECONNREFUSED'), 'Storage connection error'],
            ['name Foo con solo $metadata 404', () => awsError('Foo', undefined, 404), 'Internal server error'],
        ]) {
            test(`get-data con ${nombre}: 500 ${texto}`, async () => {
                estado.get = faltaObjeto(crear());
                const res = await request(app).get('/api/v1/get-data/data/active/Sevilla.json');
                assert.equal(res.status, 500);
                assert.deepEqual(res.body, { success: false, error: texto });
            });
        }
    });
});
