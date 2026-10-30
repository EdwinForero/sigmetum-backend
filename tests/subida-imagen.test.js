// M5: POST /upload-image valida el tipo (extensión, MIME exacto y firma del contenido) y el título antes de tocar S3.
// S3 simulado (tests/helpers/simulados.js). Escapes de control y Unicode escritos como \x.. o \u{...}.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { appNueva, reiniciar, validToken, spyTotal, calls, argsLog } = require('./helpers/simulados');
const { imagenes, conFirma } = require('./helpers/imagenes');
const { isValidImageKey } = require('../functions/validateImageKey');
const { IMAGE_UPLOAD_TYPES } = require('../config/s3Paths');

const PREFIX = '/api/v1';
const MSG_TIPO = 'Image type not allowed';
const MSG_TITULO = 'Image title is not valid';
const MSG_FIRMA = 'File content does not match the image type';
const MSG_REQUERIDO = 'File and title are required';

const app = appNueva();
beforeEach(reiniciar);

const JPG = imagenes.jpg;
const MIME_JPG = 'image/jpeg';

// Sube un fichero a /upload-image. Con `sinTitle: true` no manda el campo title.
const subir = (opciones = {}) => {
    const { title = 'foto', buf = JPG, filename = 'foto.jpg', contentType = MIME_JPG } = opciones;
    let req = request(app).post(`${PREFIX}/upload-image`).set('Authorization', `Bearer ${validToken}`);
    if (!('sinTitle' in opciones)) req = req.field('title', title);
    return req.attach('file', buf, { filename, contentType });
};

// Multipart a mano para poder mandar la parte del fichero con el Content-Type vacío o ausente.
const subirRaw = (cabeceraTipo) => {
    const b = 'XXXBOUNDARYXXX';
    const cuerpo = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="title"\r\n\r\nfoto\r\n`),
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="foto.jpg"\r\n${cabeceraTipo}\r\n`),
        JPG,
        Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    return request(app).post(`${PREFIX}/upload-image`).set('Authorization', `Bearer ${validToken}`)
        .set('Content-Type', `multipart/form-data; boundary=${b}`).send(cuerpo);
};

const sinReflejo = (res, ...textos) => {
    for (const t of textos) assert.ok(!JSON.stringify(res.body).includes(t), `la respuesta refleja ${JSON.stringify(t)}`);
};
const claveRelativa = (res) => res.body.data.key.replace(/^gallery\//, '');

describe('M5 C1: tipo no permitido (extensión o MIME)', () => {
    const casos = [
        ['a.bmp', 'a.bmp', 'image/bmp', JPG],
        ['a.svg', 'a.svg', 'image/svg+xml', JPG],
        ['a.heic', 'a.heic', 'image/heic', JPG],
        ['sin extensión', 'foto', MIME_JPG, JPG],
        ['a.png con image/jpeg', 'a.png', MIME_JPG, imagenes.png],
        ['a.jpg con image/png', 'a.jpg', 'image/png', JPG],
        ['a.jpg con image/jpg', 'a.jpg', 'image/jpg', JPG],
        ['a.jpg con application/octet-stream', 'a.jpg', 'application/octet-stream', JPG],
        ['extensión constructor', 'a.constructor', MIME_JPG, JPG],
        ['extensión __proto__', 'a.__proto__', MIME_JPG, JPG],
    ];
    for (const [etiqueta, filename, contentType, buf] of casos) {
        test(`${etiqueta}: 400 ${MSG_TIPO}, sin S3 y sin reflejar nombre ni MIME`, async () => {
            const res = await subir({ filename, contentType, buf });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { success: false, error: MSG_TIPO });
            assert.equal(spyTotal(), 0);
            sinReflejo(res, filename, contentType);
        });
    }
    for (const [etiqueta, cabecera] of [['MIME vacío', 'Content-Type: \r\n'], ['sin cabecera Content-Type', '']]) {
        test(`${etiqueta} en la parte del fichero: 400 ${MSG_TIPO} y sin S3`, async () => {
            const res = await subirRaw(cabecera);
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { success: false, error: MSG_TIPO });
            assert.equal(spyTotal(), 0);
        });
    }
});

describe('M5 C2: el contenido no corresponde al tipo', () => {
    const casos = [
        ['texto con nombre .jpg', Buffer.from('esto es texto, no una imagen'), 'a.jpg', MIME_JPG],
        ['PNG real declarado como .jpg', imagenes.png, 'a.jpg', MIME_JPG],
        ['WebP con RIFF pero sin WEBP', Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WAVE')]), 'a.webp', 'image/webp'],
        ['buffer más corto que la firma PNG', imagenes.png.subarray(0, 4), 'a.png', 'image/png'],
        ['buffer vacío', Buffer.alloc(0), 'a.jpg', MIME_JPG],
    ];
    for (const [etiqueta, buf, filename, contentType] of casos) {
        test(`${etiqueta}: 400 ${MSG_FIRMA} y sin S3`, async () => {
            const res = await subir({ buf, filename, contentType });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { success: false, error: MSG_FIRMA });
            assert.equal(spyTotal(), 0);
        });
    }
});

describe('M5 C3: ficheros válidos', () => {
    const validos = [
        ['jpg', 'jpg', imagenes.jpg, 'image/jpeg'],
        ['jpeg', 'jpeg', imagenes.jpg, 'image/jpeg'],
        ['png', 'png', imagenes.png, 'image/png'],
        ['gif (GIF87a)', 'gif', imagenes.gif87, 'image/gif'],
        ['gif (GIF89a)', 'gif', imagenes.gif89, 'image/gif'],
        ['webp', 'webp', imagenes.webp, 'image/webp'],
    ];
    for (const [etiqueta, ext, buf, contentType] of validos) {
        test(`${etiqueta}: 200 con data.key y clave válida`, async () => {
            const res = await subir({ title: 'mi foto', buf, filename: `x.${ext}`, contentType });
            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.data.key, `gallery/mi_foto.${ext}`);
            assert.ok(isValidImageKey(claveRelativa(res)));
            assert.equal(calls.s3Other, 1);
        });
    }
    for (const mime of ['image/jpeg', 'IMAGE/JPEG']) {
        test(`a.JPG con ${mime}: extensión en minúsculas y clave válida sin el prefijo`, async () => {
            const res = await subir({ title: 'Foto', filename: 'a.JPG', contentType: mime });
            assert.equal(res.status, 200);
            assert.equal(res.body.data.key, 'gallery/Foto.jpg');
            assert.ok(isValidImageKey(claveRelativa(res)));
        });
    }
});

describe('M5 C4: título', () => {
    const invalidos = [
        ['barra', 'a/b'], ['barra invertida', 'a\\b'], ['doble punto', 'a..b'], ['NUL', 'a\x00b'], ['BEL', 'a\x07b'],
        ['solo espacios', '   '], ['solo puntos', '...'], ['coma', 'a,b'], ['apóstrofo', "a'b"],
    ];
    for (const [etiqueta, title] of invalidos) {
        test(`${etiqueta}: 400 ${MSG_TITULO}, sin S3 y sin reflejar el título`, async () => {
            const res = await subir({ title });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { success: false, error: MSG_TITULO });
            assert.equal(spyTotal(), 0);
            sinReflejo(res, title.trim() || 'foto.jpg');
        });
    }

    const largos = [
        ['196 caracteres con .jpg (clave de 200)', 196, 'jpg', 200],
        ['197 caracteres con .jpg (clave de 201)', 197, 'jpg', 400],
        ['195 caracteres con .jpeg (clave de 200)', 195, 'jpeg', 200],
        ['196 caracteres con .jpeg (clave de 201)', 196, 'jpeg', 400],
        ['195 caracteres con .webp (clave de 200)', 195, 'webp', 200],
        ['196 caracteres con .webp (clave de 201)', 196, 'webp', 400],
    ];
    for (const [etiqueta, largo, ext, esperado] of largos) {
        test(`longitud: ${etiqueta} da ${esperado}`, async () => {
            const buf = ext === 'webp' ? imagenes.webp : JPG;
            const res = await subir({ title: 'a'.repeat(largo), buf, filename: `x.${ext}`, contentType: ext === 'webp' ? 'image/webp' : MIME_JPG });
            assert.equal(res.status, esperado);
            if (esperado === 200) assert.equal(claveRelativa(res).length, 200);
            else assert.deepEqual(res.body, { success: false, error: MSG_TITULO });
        });
    }

    const validos = [
        ['espacios en los extremos', '  foto  ', 'foto.jpg'],
        ['espacios internos', 'mi  foto bonita', 'mi_foto_bonita.jpg'],
        ['tildes y ñ', 'Año Ñandú Canción', 'Año_Ñandú_Canción.jpg'],
        ['mayúsculas', 'FOTO Grande', 'FOTO_Grande.jpg'],
        ['NFD', 'Cafe\u{301}', 'Cafe\u{301}.jpg'],
        ['tabulador interno', 'a\tb', 'a_b.jpg'],
        ['salto de línea interno', 'a\nb', 'a_b.jpg'],
        ['punto final', 'Fig.', 'Fig.jpg'],
    ];
    for (const [etiqueta, title, esperada] of validos) {
        test(`${etiqueta}: 200 y clave saneada`, async () => {
            const res = await subir({ title });
            assert.equal(res.status, 200);
            assert.equal(res.body.data.key, `gallery/${esperada}`);
            assert.ok(isValidImageKey(claveRelativa(res)));
        });
    }
});

describe('M5 C5: nunca 200 con una clave que get-image/delete-image rechazarían', () => {
    const titulos = [
        'foto', ' foto ', 'a/b', 'a\\b', '..', 'a..b', '.', 'Fig.', '...', '\x00', 'a\x07b', 'a\tb', 'Año', 'Cafe\u{301}', '日本語',
        'a,b', "a'b", 'a:b', 'a!b', 'a&b', 'a#b', 'a?b', 'a%b', '(x)+y-z_w', '-x', '_x', '+x', '(x', '.x', 'a b/c', '\u{200B}x',
        '\u{85}x', '\u{A0}x', '\u{3000}x', '😀', 'a'.repeat(196), 'a'.repeat(300),
    ];
    const extensiones = [['jpg', MIME_JPG, JPG], ['jpeg', MIME_JPG, JPG], ['png', 'image/png', imagenes.png], ['gif', 'image/gif', imagenes.gif89], ['webp', 'image/webp', imagenes.webp]];
    for (const title of titulos) {
        test(`título ${JSON.stringify(title.length > 20 ? `${title.slice(0, 10)}...(${title.length})` : title)}`, async () => {
            for (const [ext, contentType, buf] of extensiones) {
                reiniciar();
                const res = await subir({ title, buf, filename: `x.${ext}`, contentType });
                if (res.status === 200) {
                    assert.ok(isValidImageKey(claveRelativa(res)), `clave inválida con 200: ${res.body.data.key}`);
                    assert.equal(calls.s3Other, 1);
                } else {
                    assert.equal(res.status, 400);
                    assert.equal(spyTotal(), 0);
                }
            }
        });
    }
});

describe('M5 C6: lo que recibe S3', () => {
    test('ContentType canónico, clave final y buffer original', async () => {
        const buf = conFirma('jpg', 64);
        const res = await subir({ title: 'Mi Foto', buf, filename: 'a.JPG', contentType: 'IMAGE/JPEG' });
        assert.equal(res.status, 200);
        assert.equal(argsLog.image.length, 1);
        const [file, ruta, clave] = argsLog.image[0];
        assert.equal(file.mimetype, 'image/jpeg');
        assert.ok(Buffer.from(file.buffer).equals(buf));
        assert.equal(ruta, 'gallery');
        assert.equal(clave, 'Mi_Foto.jpg');
        assert.equal(res.body.data.key, `gallery/${clave}`);
    });
    for (const [ext, contentType, buf, canonico] of [['png', 'image/png', imagenes.png, 'image/png'], ['gif', 'image/gif', imagenes.gif87, 'image/gif'], ['webp', 'image/webp', imagenes.webp, 'image/webp'], ['jpeg', MIME_JPG, JPG, 'image/jpeg']]) {
        test(`${ext}: mimetype enviado a S3 es ${canonico}`, async () => {
            const res = await subir({ buf, filename: `a.${ext}`, contentType });
            assert.equal(res.status, 200);
            assert.equal(argsLog.image[0][0].mimetype, canonico);
        });
    }
});

describe('M5 C7: los mensajes 400 nuevos', () => {
    test('son distintos entre sí y de File and title are required, y no reflejan MIME, título ni nombre', async () => {
        const tipo = await subir({ filename: 'secreto.bmp', contentType: 'image/bmp', title: 'titulo-privado' });
        const titulo = await subir({ title: 'titulo/privado', filename: 'secreto.jpg' });
        const firma = await subir({ title: 'titulo-privado', filename: 'secreto.jpg', buf: Buffer.from('texto') });
        const mensajes = [tipo, titulo, firma].map((r) => r.body.error);
        assert.deepEqual(mensajes, [MSG_TIPO, MSG_TITULO, MSG_FIRMA]);
        assert.equal(new Set([...mensajes, MSG_REQUERIDO]).size, 4);
        for (const r of [tipo, titulo, firma]) sinReflejo(r, 'secreto', 'titulo', 'image/bmp', 'image/jpeg');
    });
});

describe('M5 C8: regresión', () => {
    test('sin file: 400 File and title are required', async () => {
        const res = await request(app).post(`${PREFIX}/upload-image`).set('Authorization', `Bearer ${validToken}`).field('title', 'foto');
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { success: false, error: MSG_REQUERIDO });
        assert.equal(spyTotal(), 0);
    });
    test('sin title: 400 File and title are required', async () => {
        const res = await subir({ sinTitle: true });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { success: false, error: MSG_REQUERIDO });
        assert.equal(spyTotal(), 0);
    });
    test('otro nombre de campo: 400 File upload error: Unexpected field', async () => {
        const res = await request(app).post(`${PREFIX}/upload-image`).set('Authorization', `Bearer ${validToken}`)
            .field('title', 'foto').attach('otro', JPG, { filename: 'a.jpg', contentType: MIME_JPG });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'File upload error: Unexpected field');
    });
    test('más de 5 MB: 400 con el mensaje fijo y sin S3', async () => {
        const res = await subir({ buf: conFirma('jpg', 5 * 1024 * 1024 + 1) });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { success: false, error: 'File exceeds the maximum allowed size' });
        assert.equal(spyTotal(), 0);
    });
    test('sin token: 401', async () => {
        const res = await request(app).post(`${PREFIX}/upload-image`).field('title', 'foto').attach('file', JPG, { filename: 'a.jpg', contentType: MIME_JPG });
        assert.equal(res.status, 401);
        assert.equal(spyTotal(), 0);
    });
    test('clave repetida: dos 200 (sobrescritura silenciosa)', async () => {
        const a = await subir({ title: 'repetida' });
        const b = await subir({ title: 'repetida' });
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        assert.equal(a.body.data.key, b.body.data.key);
        assert.equal(argsLog.image.length, 2);
    });
});

describe('M5 C9: ida y vuelta con get-image y delete-image', () => {
    test('la clave devuelta (sin gallery/) la aceptan GET /get-image y DELETE /delete-image', async () => {
        const res = await subir({ title: 'Año Nuevo (1)', filename: 'x.PNG', contentType: 'image/png', buf: imagenes.png });
        assert.equal(res.status, 200);
        const imageKey = claveRelativa(res);
        const get = await request(app).get(`${PREFIX}/get-image?imageKey=${encodeURIComponent(imageKey)}`);
        assert.equal(get.status, 200);
        const del = await request(app).delete(`${PREFIX}/delete-image`).set('Authorization', `Bearer ${validToken}`).send({ imageKey });
        assert.equal(del.status, 200);
    });
});

describe('M5: orden de comprobaciones', () => {
    test('tipo no permitido y título no válido a la vez: Image type not allowed', async () => {
        const res = await subir({ title: 'a/b', filename: 'a.bmp', contentType: 'image/bmp' });
        assert.deepEqual(res.body, { success: false, error: MSG_TIPO });
    });
    test('título no válido y firma incorrecta a la vez: Image title is not valid', async () => {
        const res = await subir({ title: 'a/b', buf: Buffer.from('texto') });
        assert.deepEqual(res.body, { success: false, error: MSG_TITULO });
    });
});

describe('M5: coherencia de IMAGE_UPLOAD_TYPES con la regla de lectura', () => {
    test('existe y cada extensión pasa isValidImageKey', () => {
        assert.ok(IMAGE_UPLOAD_TYPES, 'IMAGE_UPLOAD_TYPES no está definida');
        const extensiones = Object.keys(IMAGE_UPLOAD_TYPES);
        assert.deepEqual(extensiones.sort(), ['gif', 'jpeg', 'jpg', 'png', 'webp']);
        for (const ext of extensiones) assert.ok(isValidImageKey(`a.${ext}`), `a.${ext}`);
    });
});
