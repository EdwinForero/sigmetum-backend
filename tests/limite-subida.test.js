// M6: límite de tamaño de los ficheros subidos (10 MB en /upload, 5 MB en /upload-image). El máximo aceptado es exacto:
// MAX - 1 y MAX pasan el límite de multer; MAX + 1 da 400 con un mensaje fijo y sin llegar a S3.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { appNueva, reiniciar, validToken, spyTotal, calls } = require('./helpers/simulados');
const { conFirma } = require('./helpers/imagenes');

const PREFIX = '/api/v1';
const MB = 1024 * 1024;
const MENSAJE = 'File exceeds the maximum allowed size';

const app = appNueva();
beforeEach(reiniciar);

const subir = (ruta, bytes, nombre, extra = {}) => {
    let req = request(app).post(`${PREFIX}${ruta}`).set('Authorization', `Bearer ${validToken}`);
    if (extra.title) req = req.field('title', extra.title);
    return req.attach('file', extra.buffer ?? Buffer.alloc(bytes, 'a'), nombre);
};

describe('M6: POST /upload (máximo 10 MB)', () => {
    const MAX = 10 * MB;
    for (const [etiqueta, bytes] of [['MAX - 1', MAX - 1], ['MAX', MAX]]) {
        test(`${etiqueta} supera multer y llega al manejador (400 por extensión)`, async () => {
            const res = await subir('/upload', bytes, 'datos.txt');
            assert.equal(res.status, 400);
            assert.equal(res.body.error, 'Only .xlsx files are allowed');
        });
    }
    test('MAX + 1 da 400 con el mensaje fijo y sin tocar S3', async () => {
        const res = await subir('/upload', MAX + 1, 'datos.xlsx');
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { success: false, error: MENSAJE });
        assert.equal(spyTotal(), 0);
    });
    test('sin token y con fichero pequeño da 401', async () => {
        const res = await request(app).post(`${PREFIX}/upload`).attach('file', Buffer.from('x'), 'datos.xlsx');
        assert.equal(res.status, 401);
    });
});

describe('M6: POST /upload-image (máximo 5 MB)', () => {
    const MAX = 5 * MB;
    for (const [etiqueta, bytes] of [['MAX - 1', MAX - 1], ['MAX', MAX]]) {
        test(`${etiqueta} da 200 y sube a S3`, async () => {
            const res = await subir('/upload-image', bytes, 'foto.jpg', { title: 'titulo', buffer: conFirma('jpg', bytes) });
            assert.equal(res.status, 200);
            assert.equal(calls.s3Other, 1);
        });
    }
    test('MAX + 1 da 400 con el mensaje fijo y sin tocar S3', async () => {
        const res = await subir('/upload-image', MAX + 1, 'foto.jpg', { title: 'titulo' });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { success: false, error: MENSAJE });
        assert.equal(spyTotal(), 0);
    });
    test('sin token y con fichero pequeño da 401', async () => {
        const res = await request(app).post(`${PREFIX}/upload-image`).attach('file', Buffer.from('x'), 'foto.jpg');
        assert.equal(res.status, 401);
    });
});
