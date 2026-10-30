// Criterios 2 y 3 del antiguo script de verificación de rutas (retirado): límite de 5 peticiones por IP y validación de POST /send-email
// (anónimo). Los nombres de los casos son los mismos que los del script.
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, isEnvelopeError, nextIp, reiniciar, calls, validToken } = require('./helpers/simulados');

const URL = '/api/v1/send-email';
const validMail = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };

beforeEach(reiniciar);

// Criterio 2: el límite se prueba como una secuencia sobre una IP; los resultados se capturan en `before` porque
// los contadores globales se reinician entre tests.
describe('criterio 2: límite de 5 peticiones por IP (anónimo)', () => {
    const app = appNueva();
    const r = {};

    before(async () => {
        reiniciar();
        const ipA = nextIp();
        const ipB = nextIp();
        r.statuses = [];
        for (let i = 1; i <= 5; i += 1) r.statuses.push((await llamar(app, 'POST', URL, { body: validMail, ip: ipA })).status);
        r.enviadosTras5 = calls.sendMail;
        r.sexto = await llamar(app, 'POST', URL, { body: validMail, ip: ipA });
        r.sextoToken = await llamar(app, 'POST', URL, { token: validToken, body: validMail, ip: ipA });
        r.enviadosTras6 = calls.sendMail;
        r.otraIp = await llamar(app, 'POST', URL, { body: validMail, ip: ipB });

        const ipC = nextIp();
        r.malos = [];
        for (let i = 1; i <= 5; i += 1) r.malos.push((await llamar(app, 'POST', URL, { body: {}, ip: ipC })).status);
        r.trasMalos = await llamar(app, 'POST', URL, { body: validMail, ip: ipC });
    });

    test('cinco peticiones anónimas válidas dan 200', () => {
        assert.equal(r.statuses.length, 5);
        assert.ok(r.statuses.every((s) => s === 200), r.statuses.join(','));
    });
    test('sendMail cuenta 5', () => assert.equal(r.enviadosTras5, 5));
    test('la sexta anónima da 429 con envoltorio', () => {
        assert.equal(r.sexto.status, 429);
        assert.ok(isEnvelopeError(r.sexto), JSON.stringify(r.sexto.json));
    });
    test('con token válido la misma IP sigue limitada', () => assert.equal(r.sextoToken.status, 429));
    test('la sexta no envía correo', () => assert.equal(r.enviadosTras6, 5));
    test('otra IP sí pasa', () => assert.equal(r.otraIp.status, 200));
    test('cinco cuerpos inválidos dan 400', () => {
        assert.equal(r.malos.length, 5);
        assert.ok(r.malos.every((s) => s === 400), r.malos.join(','));
    });
    test('los 400 cuentan para el límite', () => assert.equal(r.trasMalos.status, 429));
});

// Criterio 3: validación del cuerpo. Los caracteres de cabecera peligrosos van como escapes.
const sin = (campo) => { const m = { ...validMail }; delete m[campo]; return m; };
const con = (campo, valor) => ({ ...validMail, [campo]: valor });
const invalidos = [
    ['sin username', sin('username')], ['sin email', sin('email')], ['sin subject', sin('subject')], ['sin message', sin('message')],
    ['username número', con('username', 5)], ['email array', con('email', ['a@b.co'])],
    ['subject objeto', con('subject', { a: 1 })], ['message número', con('message', 7)],
    ['username vacío', con('username', '')], ['subject solo espacios', con('subject', '   ')], ['message solo espacios', con('message', ' \t ')],
    ['correo abc', con('email', 'abc')], ['correo con espacio', con('email', 'a b@c.d')], ['correo con dos destinatarios', con('email', 'a@b.c,d@e.f')],
    ['correo de 255 caracteres', con('email', `${'a'.repeat(243)}@example.com`)],
    ['username de 101', con('username', 'a'.repeat(101))], ['subject de 151', con('subject', 'a'.repeat(151))],
    ['message de 2001', con('message', 'a'.repeat(2001))],
    ['salto de línea en username', con('username', 'Ana\nBcc: x@y.z')], ['salto de línea en subject', con('subject', 'Hola\r\nBcc: x@y.z')],
    ['salto de línea en email', con('email', 'ana@example.com\nBcc: x@y.z')],
    ['U+2028 en username', con('username', 'Ana\u{2028}Bcc')], ['U+2029 en username', con('username', 'Ana\u{2029}Bcc')],
    ['U+2028 en subject', con('subject', 'Hola\u{2028}Bcc')], ['U+2029 en subject', con('subject', 'Hola\u{2029}Bcc')],
    ['U+2028 en email', con('email', 'ana\u{2028}@example.com')], ['U+0085 en subject', con('subject', 'Hola\x85Bcc')],
    ['NUL en username', con('username', 'Ana\x00')], ['NUL en email', con('email', 'ana\x00@example.com')],
    ['NUL en subject', con('subject', 'Hola\x00')], ['NUL en message', con('message', 'Hola\x00')],
    ['BEL en username', con('username', 'Ana\x07')], ['BEL en email', con('email', 'ana\x07@example.com')],
    ['BEL en subject', con('subject', 'Hola\x07')], ['BEL en message', con('message', 'Hola\x07')],
    ['correo con paréntesis', con('email', 'a(b)@example.com')], ['correo con comilla simple', con('email', "o'brien@example.com")],
    ['correo con barra invertida', con('email', 'a\\b@example.com')], ['correo con dos puntos', con('email', 'a:b@example.com')],
];
const validos = [
    ['cuerpo válido', validMail],
    ['límites exactos (100, 254, 150, 2000)', {
        username: 'a'.repeat(100), email: `${'a'.repeat(242)}@example.com`, subject: 'a'.repeat(150), message: 'a'.repeat(2000),
    }],
    ['campos con espacios alrededor', { username: ' Ana ', email: ' ana@example.com ', subject: ' Hola ', message: ' Texto ' }],
    ['message con \\n, \\r\\n y \\t', { ...validMail, message: 'Línea 1\nLínea 2\r\n\tSangrada' }],
    ['correo con +tag y subdominio', { ...validMail, email: 'nombre+tag@sub.dominio.es' }],
    ['correo a@b.com', { ...validMail, email: 'a@b.com' }],
];

describe('criterio 3: validación de /send-email (anónimo)', () => {
    const app = appNueva();

    test('las listas de casos de /send-email no están vacías', () => {
        assert.ok(invalidos.length > 0);
        assert.ok(validos.length > 0);
    });

    // Los casos con U+2028, U+2029, U+0085 y los demás controles llevan el carácter esperado en la cadena enviada.
    test('los casos de caracteres de cabecera contienen el carácter esperado', () => {
        const esperado = { 'U+2028': '\u{2028}', 'U+2029': '\u{2029}', 'U+0085': '\x85', NUL: '\x00', BEL: '\x07' };
        for (const [nombre, body] of invalidos) {
            const clave = Object.keys(esperado).find((k) => nombre.startsWith(`${k} en `));
            if (!clave) continue;
            assert.ok(Object.values(body).some((v) => typeof v === 'string' && v.includes(esperado[clave])), nombre);
        }
    });

    for (const [nombre, body] of invalidos) {
        test(nombre, async () => {
            const r = await llamar(app, 'POST', URL, { body, ip: nextIp() });
            assert.equal(r.status, 400, `status=${r.status}`);
            assert.ok(isEnvelopeError(r));
            assert.equal(calls.sendMail, 0);
        });
    }

    test('sin cuerpo', async () => {
        const r = await llamar(app, 'POST', URL, { ip: nextIp() });
        assert.equal(r.status, 400);
        assert.equal(r.json?.success, false);
    });

    for (const [nombre, body] of validos) {
        test(nombre, async () => {
            const r = await llamar(app, 'POST', URL, { body, ip: nextIp() });
            assert.equal(r.status, 200, `status=${r.status}`);
            assert.equal(r.json?.success, true);
            assert.equal(calls.sendMail, 1);
        });
    }
});
