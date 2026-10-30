// Criterio 10 del antiguo script de verificación de rutas (retirado): errores controlados y CORS. El cliente nunca recibe el texto de un
// error interno ni el origen rechazado; el detalle solo va al registro. Los nombres de los casos son los del script,
// salvo el caso estático de app.js, que ahora comprueba el comportamiento real del warn.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { appNueva, llamar, inject, nextIp, reiniciar, validToken } = require('./helpers/simulados');

const PREFIX = '/api/v1';
const app = appNueva();
beforeEach(reiniciar);

// Captura console.error y console.warn (sin escribir en la salida) y devuelve el registro de líneas.
const capturar = (t) => {
    const registro = [];
    const guardar = (...args) => { registro.push(args.map(String).join(' ')); };
    t.mock.method(console, 'error', guardar);
    t.mock.method(console, 'warn', guardar);
    return registro;
};
const sinTexto = (r, texto) => !JSON.stringify(r.json ?? {}).includes(texto);
const resumenCaso = (r) => `${r.status} ${JSON.stringify(r.json)}`;
const conCodigo = (mensaje, props) => Object.assign(new Error(mensaje), props);
const sembrar = async (error, extra = {}) => {
    inject.getTextJson = error;
    try { return await llamar(app, 'GET', `${PREFIX}/list-terms`, extra); } finally { inject.getTextJson = null; }
};
const borrar = async (ruta, cuerpo, campo, valor) => {
    inject[campo] = valor;
    try { return await llamar(app, 'DELETE', `${PREFIX}${ruta}`, { token: validToken, body: cuerpo }); } finally { inject[campo] = null; }
};

const mapeados = [
    ['NoSuchKey', 'The requested file does not exist in storage'], ['NoSuchBucket', 'Storage bucket is not configured correctly'],
    ['AccessDenied', 'Access denied to storage'], ['NetworkingError', 'Storage connection error'], ['ECONNREFUSED', 'Storage connection error'],
];

test('la lista de errores mapeados del criterio 10 no está vacía', () => assert.ok(mapeados.length > 0));

// 10a. Error sin status y sin mapear: texto genérico; el detalle solo va al registro.
test('a. error sin status da 500 Internal server error sin el texto original', async (t) => {
    capturar(t);
    const r = await sembrar(new Error('secreto interno xyz'));
    assert.ok(r.status === 500 && r.json?.error === 'Internal server error' && sinTexto(r, 'secreto'), resumenCaso(r));
});
test('a. el registro conserva el mensaje real', async (t) => {
    const registro = capturar(t);
    await sembrar(new Error('secreto interno xyz'));
    assert.ok(registro.some((linea) => linea.includes('secreto interno xyz')), 'no se registró');
});

// 10b. 5xx explícito.
test('b. status 503 se conserva con Internal server error', async (t) => {
    capturar(t);
    const r = await sembrar(conCodigo('secreto 503', { status: 503 }));
    assert.ok(r.status === 503 && r.json?.error === 'Internal server error' && sinTexto(r, 'secreto'), resumenCaso(r));
});

// 10c. Mapeados de almacenamiento: conservan su texto.
for (const [code, texto] of mapeados) {
    test(`c. ${code} conserva su texto`, async (t) => {
        capturar(t);
        const r = await sembrar(conCodigo(`detalle ${code}`, { code }));
        assert.ok(r.status === 500 && r.json?.error === texto, resumenCaso(r));
    });
}

// 10d. Otro 4xx de librería: texto fijo.
test('d. status 422 da Bad request sin el texto original', async (t) => {
    capturar(t);
    const r = await sembrar(conCodigo('secreto 422', { status: 422 }));
    assert.ok(r.status === 422 && r.json?.error === 'Bad request' && sinTexto(r, 'secreto'), resumenCaso(r));
});

// 10e. MulterError real: campo inesperado (LIMIT_UNEXPECTED_FILE).
test('e. MulterError (campo inesperado) da 400 File upload error: Unexpected field', async (t) => {
    capturar(t);
    const res = await request(app).post(`${PREFIX}/upload-image`).set('Authorization', `Bearer ${validToken}`).attach('otro', Buffer.from('contenido'), 'a.jpg');
    assert.ok(res.status === 400 && res.body?.error === 'File upload error: Unexpected field', `${res.status} ${JSON.stringify(res.body)}`);
});

// 10f. delete-image y delete-term no reflejan el error del SDK.
test('f. delete-image fallido da 500 Internal server error sin el texto del SDK', async (t) => {
    capturar(t);
    const r = await borrar('/delete-image', { imageKey: 'foto.jpg' }, 'deleteImage', new Error('secreto del sdk'));
    assert.ok(r.status === 500 && r.json?.error === 'Internal server error' && sinTexto(r, 'secreto'), resumenCaso(r));
});
test('f. delete-term fallido da 500 Internal server error sin el texto del SDK', async (t) => {
    capturar(t);
    const r = await borrar('/delete-term', { term: 'x' }, 'deleteTerm', new Error('secreto del sdk'));
    assert.ok(r.status === 500 && r.json?.error === 'Internal server error' && sinTexto(r, 'secreto'), resumenCaso(r));
});
test('f. el registro conserva el texto del SDK', async (t) => {
    const registro = capturar(t);
    await borrar('/delete-image', { imageKey: 'foto.jpg' }, 'deleteImage', new Error('secreto del sdk'));
    assert.ok(registro.some((linea) => linea.includes('secreto del sdk')), 'no se registró');
});

// 10g. Cuerpo mayor que el límite de express.json (100 KB): 413 con texto fijo.
test('g. cuerpo de más de 100 KB da 413 Payload too large', async (t) => {
    capturar(t);
    const r = await llamar(app, 'POST', `${PREFIX}/send-email`, {
        rawBody: JSON.stringify({ message: 'a'.repeat(110 * 1024) }), headers: { 'Content-Type': 'application/json' }, ip: nextIp(),
    });
    assert.ok(r.status === 413 && r.json?.error === 'Payload too large', resumenCaso(r));
});

// 10h. El origen rechazado no vuelve al cliente; solo el 403 y el warn aportan evidencia (404 y 500 no reflejan el origen).
const evil = 'http://evil-xyz.example';
test('h. 403 de CORS sin el origen en el cuerpo', async (t) => {
    capturar(t);
    const r = await llamar(app, 'GET', `${PREFIX}/list-terms`, { headers: { Origin: evil } });
    assert.ok(r.status === 403 && r.json?.error === 'Origin not allowed' && sinTexto(r, 'evil-'), resumenCaso(r));
});
test('h. el warn registra el origen rechazado', async (t) => {
    const registro = capturar(t);
    await llamar(app, 'GET', `${PREFIX}/list-terms`, { headers: { Origin: evil } });
    assert.ok(registro.some((linea) => linea.includes('CORS') && linea.includes(evil)), 'el warn no contiene el origen');
});
// Sustituye al caso estático del script: el warn de app.js real lleva el origen entre comillas JSON (neutraliza comillas del cliente).
test('h. app.js registra el origen rechazado truncado con JSON.stringify (comportamiento)', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    const conComillas = 'http://a"b.example';
    await llamar(app, 'GET', `${PREFIX}/list-terms`, { headers: { Origin: conComillas } });
    const llamadas = warn.mock.calls.map((c) => c.arguments);
    assert.deepEqual(llamadas, [['CORS: origin not allowed:', JSON.stringify(conComillas)]]);
});
test('h. 404 sin el origen (no aporta evidencia)', async (t) => {
    capturar(t);
    const r = await llamar(app, 'GET', `${PREFIX}/no-existe`, { headers: { Origin: 'http://localhost' } });
    assert.ok(sinTexto(r, 'evil-'), resumenCaso(r));
});
test('h. 500 sin el origen (no aporta evidencia)', async (t) => {
    capturar(t);
    const r = await sembrar(new Error('fallo sembrado'), { headers: { Origin: 'http://localhost' } });
    assert.ok(sinTexto(r, 'evil-'), resumenCaso(r));
});

// 10i. Origin muy largo: el warn lo trunca a 200 caracteres y el cuerpo del 403 no refleja nada.
const largo = `http://${'a'.repeat(5000)}.example`;
test('i. Origin de 5000 caracteres: 403 sin reflejar el origen', async (t) => {
    capturar(t);
    const r = await llamar(app, 'GET', `${PREFIX}/list-terms`, { headers: { Origin: largo } });
    assert.ok(r.status === 403 && r.json?.error === 'Origin not allowed' && sinTexto(r, 'aaaa'), resumenCaso(r));
});
test('i. el warn trunca el origen largo (conserva 200 caracteres y descarta el resto)', async (t) => {
    const registro = capturar(t);
    await llamar(app, 'GET', `${PREFIX}/list-terms`, { headers: { Origin: largo } });
    const lineaWarn = registro.find((linea) => linea.includes('CORS')) ?? '';
    assert.ok(lineaWarn.includes('a'.repeat(100)) && !lineaWarn.includes('a'.repeat(201)) && lineaWarn.length < 400, `longitud del warn: ${lineaWarn.length}`);
});

// 10j. delete-image / delete-term con un error sin texto (B5: aws/ lanza): 500 genérico y la línea de registro de errorHandler.
test('j. delete-image sin texto de error da 500 Internal server error', async (t) => {
    capturar(t);
    const r = await borrar('/delete-image', { imageKey: 'foto.jpg' }, 'deleteImage', new Error());
    assert.ok(r.status === 500 && r.json?.error === 'Internal server error', resumenCaso(r));
});
test('j. el registro de delete-image lleva la línea de errorHandler', async (t) => {
    const registro = capturar(t);
    await borrar('/delete-image', { imageKey: 'foto.jpg' }, 'deleteImage', new Error());
    assert.ok(registro.some((linea) => linea.includes('[DELETE] /api/v1/delete-image → 500')), 'el registro no contiene la línea de errorHandler');
});
test('j. delete-term sin texto de error da 500 Internal server error', async (t) => {
    capturar(t);
    const r = await borrar('/delete-term', { term: 'x' }, 'deleteTerm', new Error());
    assert.ok(r.status === 500 && r.json?.error === 'Internal server error', resumenCaso(r));
});
test('j. el registro de delete-term lleva la línea de errorHandler', async (t) => {
    const registro = capturar(t);
    await borrar('/delete-term', { term: 'x' }, 'deleteTerm', new Error());
    assert.ok(registro.some((linea) => linea.includes('[DELETE] /api/v1/delete-term → 500')), 'el registro no contiene la línea de errorHandler');
});

// B9: NoSuchKey del SDK (por name o por Code) da 404 con texto fijo; un status propio manda; NoSuchBucket sigue en 500.
const MENSAJE_NO_EXISTE = 'The requested file does not exist in storage';
const errorSdk = (name, Code, status) => Object.assign(new Error(`secreto ${name}`), { name, Code, $fault: 'client', $metadata: { httpStatusCode: status } });

test('B9. NoSuchKey por name con $metadata 404 da 404 con el texto fijo', async (t) => {
    capturar(t);
    const r = await sembrar(errorSdk('NoSuchKey', undefined, 404));
    assert.ok(r.status === 404 && r.json?.error === MENSAJE_NO_EXISTE && sinTexto(r, 'secreto'), resumenCaso(r));
});
test('B9. NoSuchKey por Code da 404 con el texto fijo', async (t) => {
    capturar(t);
    const r = await sembrar(errorSdk('Error', 'NoSuchKey', 404));
    assert.ok(r.status === 404 && r.json?.error === MENSAJE_NO_EXISTE && sinTexto(r, 'secreto'), resumenCaso(r));
});
for (const status of [503, 400]) {
    test(`B9. NoSuchKey con status propio ${status} conserva ese estado`, async (t) => {
        capturar(t);
        const r = await sembrar(conCodigo('secreto status', { name: 'NoSuchKey', status }));
        assert.ok(r.status === status && sinTexto(r, 'secreto'), resumenCaso(r));
    });
}
test('B9. NoSuchKey con statusCode propio 400 conserva ese estado', async (t) => {
    capturar(t);
    const r = await sembrar(conCodigo('secreto statusCode', { name: 'NoSuchKey', statusCode: 400 }));
    assert.ok(r.status === 400 && sinTexto(r, 'secreto'), resumenCaso(r));
});
test('B9. NoSuchBucket con $metadata 404 sigue en 500', async (t) => {
    capturar(t);
    const r = await sembrar(errorSdk('NoSuchBucket', 'NoSuchBucket', 404));
    assert.ok(r.status === 500 && r.json?.error === 'Storage bucket is not configured correctly', resumenCaso(r));
});
test('B9. NoSuchKey con code en minúscula sigue en 500 con el texto mapeado (límite conocido)', async (t) => {
    capturar(t);
    const r = await sembrar(conCodigo('secreto code', { code: 'NoSuchKey' }));
    assert.ok(r.status === 500 && r.json?.error === MENSAJE_NO_EXISTE, resumenCaso(r));
});
test('B9. la ruta inexistente sigue dando 404 Not found', async (t) => {
    capturar(t);
    const r = await llamar(app, 'GET', `${PREFIX}/no-existe`);
    assert.ok(r.status === 404 && r.json?.error === 'Not found', resumenCaso(r));
});

// B5: delete-image y delete-term pasan el error original a errorHandler (código, estado y texto mapeado).
const rutasBorrado = [['/delete-image', { imageKey: 'foto.jpg' }, 'deleteImage'], ['/delete-term', { term: 'x' }, 'deleteTerm']];
for (const [ruta, cuerpo, campo] of rutasBorrado) {
    test(`B5. ${ruta} con AccessDenied da 500 Access denied to storage`, async (t) => {
        capturar(t);
        const r = await borrar(ruta, cuerpo, campo, conCodigo('secreto sdk', { Code: 'AccessDenied' }));
        assert.ok(r.status === 500 && r.json?.error === 'Access denied to storage' && sinTexto(r, 'secreto'), resumenCaso(r));
    });
    test(`B5. ${ruta} con NoSuchKey da 404 con el texto fijo`, async (t) => {
        capturar(t);
        const r = await borrar(ruta, cuerpo, campo, errorSdk('NoSuchKey', 'NoSuchKey', 404));
        assert.ok(r.status === 404 && r.json?.error === MENSAJE_NO_EXISTE && sinTexto(r, 'secreto'), resumenCaso(r));
    });
    test(`B5. ${ruta} con S3 correcto da 200`, async () => {
        const r = await borrar(ruta, cuerpo, campo, null);
        assert.ok(r.status === 200 && r.json?.success === true, resumenCaso(r));
    });
}
