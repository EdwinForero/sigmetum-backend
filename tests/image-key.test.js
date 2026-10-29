// Criterios 4 y 5 del antiguo script de verificación de rutas (retirado): imageKey en GET /get-image (anónimo) y DELETE /delete-image
// (token válido). Con un imageKey inválido no se llama a S3. Los nombres de los casos son los mismos que los del script.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, isEnvelopeError, reiniciar, calls, validToken } = require('./helpers/simulados');

const app = appNueva();
beforeEach(reiniciar);

const encode = encodeURIComponent;
// [nombre, imageKey para el cuerpo del DELETE]; la query del GET sale de la misma clave.
const invalidos = [
    ['../x.jpg', '../x.jpg'], ['a/../b.jpg', 'a/../b.jpg'], ['/a.jpg', '/a.jpg'], ['a//b.jpg', 'a//b.jpg'],
    ['a b.jpg (espacio)', 'a b.jpg'], ['a\\b.jpg (barra invertida)', 'a\\b.jpg'], ['carácter de control', 'a\x01b.jpg'],
    ['201 caracteres', `${'a'.repeat(197)}.jpg`], ['a.txt', 'a.txt'], ['sin extensión', 'a'], ['.hidden.jpg', '.hidden.jpg'],
    ['a/.hidden.jpg', 'a/.hidden.jpg'], ['termina en barra', 'a/'],
    ['marca combinante inicial', '\u{301}a.jpg'], ['marca combinante inicial de segmento', 'a/\u{301}b.jpg'], ['foto (1).jpg con espacio', 'foto (1).jpg'],
].map(([nombre, key]) => ({ nombre, key, query: `imageKey=${encode(key)}` }));
invalidos.push(
    { nombre: 'a%2e%2e/b.jpg (llega como a../b.jpg)', key: 'a../b.jpg', query: 'imageKey=a%2e%2e/b.jpg' },
    { nombre: 'array imageKey=a&imageKey=b', key: ['a', 'b'], query: 'imageKey=a&imageKey=b' },
    { nombre: 'número', key: 123, query: null },
);
const validos = [
    'foto.jpg', 'sub/foto-1_2.PNG', 'a.webp', 'b.gif', 'c.jpeg', 'Año/árbol-ñandú.jpg', 'foto(1).jpg', 'a+b.png',
    'Café.jpg', 'Año/arbol-nandu.jpg',
    `${'a'.repeat(196)}.jpg`,
];

test('las listas de casos de imageKey no están vacías', () => {
    assert.ok(invalidos.length > 0);
    assert.ok(validos.length > 0);
});

test('los casos de marca combinante llevan el escape esperado', () => {
    assert.equal(invalidos.find((c) => c.nombre === 'marca combinante inicial').key.codePointAt(0), 0x301);
    assert.equal(invalidos.find((c) => c.nombre === 'marca combinante inicial de segmento').key.codePointAt(2), 0x301);
});

for (const { nombre, key, query } of invalidos) {
    if (query !== null) {
        test(`GET inválido ${nombre}`, async () => {
            const r = await llamar(app, 'GET', `/api/v1/get-image?${query}`);
            assert.equal(r.status, 400, `status=${r.status}`);
            assert.ok(isEnvelopeError(r));
            assert.equal(calls.getPresigned, 0);
        });
    }
    test(`DELETE inválido ${nombre}`, async () => {
        const r = await llamar(app, 'DELETE', '/api/v1/delete-image', { token: validToken, body: { imageKey: key } });
        assert.equal(r.status, 400, `status=${r.status}`);
        assert.ok(isEnvelopeError(r));
        assert.equal(calls.deleteImage, 0);
    });
}

for (const key of validos) {
    test(`GET válido ${key.slice(0, 40)}`, async () => {
        const g = await llamar(app, 'GET', `/api/v1/get-image?imageKey=${encode(key)}`);
        assert.equal(g.status, 200);
        assert.ok(g.json?.data?.imageUrl);
        assert.equal(calls.getPresigned, 1);
    });
    test(`DELETE válido ${key.slice(0, 40)}`, async () => {
        const d = await llamar(app, 'DELETE', '/api/v1/delete-image', { token: validToken, body: { imageKey: key } });
        assert.equal(d.status, 200);
        assert.equal(d.json?.success, true);
        assert.equal(calls.deleteImage, 1);
    });
}

test('GET sin imageKey mantiene el mensaje', async () => {
    const r = await llamar(app, 'GET', '/api/v1/get-image');
    assert.equal(r.status, 400);
    assert.equal(r.json?.error, 'imageKey is required');
});
test('DELETE sin imageKey mantiene el mensaje', async () => {
    const r = await llamar(app, 'DELETE', '/api/v1/delete-image', { token: validToken, body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.json?.error, 'imageKey is required');
});
test('DELETE sin token da 401 (es protegida)', async () => {
    const r = await llamar(app, 'DELETE', '/api/v1/delete-image', { body: { imageKey: 'foto.jpg' } });
    assert.equal(r.status, 401);
});
