// Criterios 2 y 3 del antiguo script de verificación de rutas (retirado): límite de 5 peticiones por IP y validación de POST /send-email
// (anónimo). Los nombres de los casos son los mismos que los del script.
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, isEnvelopeError, nextIp, reiniciar, calls, validToken, argsLog, seed, inject } = require('./helpers/simulados');
const { LIST_UNAVAILABLE_SUBJECT_PREFIX } = require('../functions/contactRecipients');

const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
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
    // M31: los caracteres de formato (\p{Cf}) en el correo dan el mensaje fijo de formato, no el de controles.
    ['U+200B en email', con('email', 'ana\u{200B}@example.com'), 'email is not valid'],
    ['U+202E en email', con('email', 'ana@exa\u{202E}mple.com'), 'email is not valid'],
    ['U+00AD en email', con('email', 'ana\u{00AD}@example.com'), 'email is not valid'],
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
    ['correo con letras Unicode normales', { ...validMail, email: 'josé.núñez@ejemplo.es' }],
    ['subject con emoji compuesto (U+200D)', { ...validMail, subject: 'Hola \u{1F469}\u{200D}\u{1F4BB}' }],
    ['subject con guion suave (U+00AD)', { ...validMail, subject: 'Co\u{00AD}operaci\u{00F3}n' }],
    ['username con ZWJ (U+200D)', { ...validMail, username: 'Ana \u{1F469}\u{200D}\u{1F4BB}' }],
    ['username con guion suave (U+00AD)', { ...validMail, username: 'Mar\u{00AD}\u{00ED}a' }],
];

describe('criterio 3: validación de /send-email (anónimo)', () => {
    const app = appNueva();

    test('las listas de casos de /send-email no están vacías', () => {
        assert.ok(invalidos.length > 0);
        assert.ok(validos.length > 0);
    });

    // Los casos con U+2028, U+2029, U+0085 y los demás controles llevan el carácter esperado en la cadena enviada.
    test('los casos de caracteres de cabecera contienen el carácter esperado', () => {
        const esperado = {
            'U+2028': '\u{2028}', 'U+2029': '\u{2029}', 'U+0085': '\x85', NUL: '\x00', BEL: '\x07', 'U+200B': '\u{200B}', 'U+202E': '\u{202E}',
        };
        for (const [nombre, body] of invalidos) {
            const clave = Object.keys(esperado).find((k) => nombre.startsWith(`${k} en `));
            if (!clave) continue;
            assert.ok(Object.values(body).some((v) => typeof v === 'string' && v.includes(esperado[clave])), nombre);
        }
    });

    for (const [nombre, body, mensaje] of invalidos) {
        test(nombre, async () => {
            const r = await llamar(app, 'POST', URL, { body, ip: nextIp() });
            assert.equal(r.status, 400, `status=${r.status}`);
            assert.ok(isEnvelopeError(r));
            if (mensaje) assert.equal(r.json.error, mensaje);
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

// Destinatarios de /send-email (BE4, BE8, BE9): la lista de data/contact/recipients.json, con EMAIL de respaldo.
// El doble de S3 (helpers/simulados.js) devuelve [] cuando el fichero no existe, como aws/ con NoSuchKey (ver s3-robustez.test.js).
describe('destinatarios de /send-email: la lista con EMAIL de respaldo', () => {
    const app = appNueva();
    const CLAVE = 'data/contact/recipients.json';
    const enviar = (body = validMail) => llamar(app, 'POST', URL, { body, ip: nextIp() });
    const registrarErrores = (t) => {
        const registros = [];
        t.mock.method(console, 'error', (...args) => { registros.push(args); });
        return registros;
    };

    test('con la lista sembrada, un solo envío con to igual al array de la lista y el resto de campos como siempre', async (t) => {
        const registros = registrarErrores(t);
        seed.textJson[CLAVE] = [{ email: 'a@x.es' }, { email: 'b@x.es' }];
        const r = await enviar();
        assert.equal(r.status, 200);
        assert.equal(calls.sendMail, 1);
        assert.deepEqual(argsLog.mail[0].to, ['a@x.es', 'b@x.es']);
        assert.equal(argsLog.mail[0].from, process.env.EMAIL);
        assert.equal(argsLog.mail[0].replyTo, 'ana@example.com');
        assert.equal(argsLog.mail[0].subject, 'Consulta - enviado por Ana<ana@example.com>');
        assert.equal(argsLog.mail[0].text, 'Hola, tengo una pregunta.');
        assert.deepEqual(registros, []);
    });
    test('una entrada no válida del fichero se descarta', async () => {
        seed.textJson[CLAVE] = [{ email: 'a@x.es' }, { email: 'mal' }, { email: 'x@y.es,z@w.es' }, { email: 'q@r.es\nBcc: s@t.es' }, { email: 5 }, { email: ' b@x.es ' }];
        assert.equal((await enviar()).status, 200);
        assert.deepEqual(argsLog.mail[0].to, ['a@x.es']);
    });
    test('las direcciones repetidas (sin distinguir mayúsculas) se envían una sola vez, con el formato de la primera (M32)', async () => {
        seed.textJson[CLAVE] = [{ email: 'a@x.es' }, { email: 'A@x.es' }, { email: 'b@x.es' }];
        assert.equal((await enviar()).status, 200);
        assert.equal(calls.sendMail, 1);
        assert.deepEqual(argsLog.mail[0].to, ['a@x.es', 'b@x.es']);
    });
    test('una entrada con \\p{Cf} del fichero se descarta (M31)', async () => {
        seed.textJson[CLAVE] = [{ email: 'a@x.es' }, { email: 'b\u{200B}@x.es' }, { email: 'c@x\u{202E}.es' }];
        assert.equal((await enviar()).status, 200);
        assert.deepEqual(argsLog.mail[0].to, ['a@x.es']);
    });
    for (const [nombre, contenido] of [['sin fichero o con la lista vacía', []], ['sin ninguna entrada válida', [{ email: 'mal' }, { email: 5 }, null]]]) {
        test(`${nombre}: to es [EMAIL], asunto sin marca y sin registro`, async (t) => {
            const registros = registrarErrores(t);
            seed.textJson[CLAVE] = contenido;
            const r = await enviar();
            assert.equal(r.status, 200);
            assert.deepEqual(argsLog.mail[0].to, [process.env.EMAIL]);
            assert.equal(argsLog.mail[0].subject, 'Consulta - enviado por Ana<ana@example.com>');
            assert.deepEqual(registros, []);
        });
    }
    const fallos = [
        ['AccessDenied (S15: también es «falta el fichero»)', Object.assign(new Error('secreto sdk 1'), { name: 'AccessDenied', Code: 'AccessDenied' }), 'AccessDenied'],
        ['JSON roto', Object.assign(new SyntaxError('secreto sdk 2 en la posición 1'), {}), 'SyntaxError'],
        ['red', Object.assign(new Error('secreto sdk 3 conexión'), { name: 'NetworkingError' }), 'NetworkingError'],
        ['error genérico', new Error('secreto sdk 4'), 'Error'],
    ];
    for (const [nombre, error, nombreEsperado] of fallos) {
        test(`si la lectura falla (${nombre}): 200, to es [EMAIL], asunto con la marca y un registro que solo lleva ${nombreEsperado}`, async (t) => {
            const registros = registrarErrores(t);
            seed.textJson[CLAVE] = [{ email: 'a@x.es' }];
            inject.getTextJson = error;
            const r = await enviar();
            assert.equal(r.status, 200);
            assert.deepEqual(r.json, { success: true, data: 'Email sent successfully.' });
            assert.equal(calls.sendMail, 1);
            assert.deepEqual(argsLog.mail[0].to, [process.env.EMAIL]);
            assert.equal(argsLog.mail[0].subject, `${LIST_UNAVAILABLE_SUBJECT_PREFIX}Consulta - enviado por Ana<ana@example.com>`);
            assert.equal(argsLog.mail[0].replyTo, 'ana@example.com');
            assert.deepEqual(registros, [['[send-email] recipient list unavailable, using EMAIL:', nombreEsperado]]);
            assert.ok(!JSON.stringify(registros).includes('secreto'));
        });
    }
    // S3 colgado: el cliente global no tiene requestTimeout, así que la lectura no rechaza nunca. /send-email corta la espera
    // (RECIPIENTS_READ_TIMEOUT_MS = 4000) y la trata como fallo de lectura. Temporizadores falsos: no se espera de verdad.
    test('si la lectura se cuelga: pasados 4 s, 200, to es [EMAIL], asunto con la marca y un registro fijo', { timeout: 5000 }, async (t) => {
        const registros = registrarErrores(t);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        seed.textJson[CLAVE] = [{ email: 'a@x.es' }];
        inject.getTextJsonEspera = new Promise(() => {});
        const pendiente = enviar();
        while (calls.s3Other === 0) await new Promise((resolve) => setImmediate(resolve));
        assert.equal(calls.sendMail, 0);
        t.mock.timers.tick(3999);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(calls.sendMail, 0, 'a los 3999 ms todavía espera');
        t.mock.timers.tick(1);
        // Sin límite la lectura nunca termina: el guardián usa el setTimeout real (capturado antes de falsear) para fallar en vez de colgarse.
        let guardian;
        const r = await Promise.race([
            pendiente,
            new Promise((_, reject) => { guardian = realSetTimeout(() => reject(new Error('la lectura colgada no se cortó')), 1500); }),
        ]).finally(() => realClearTimeout(guardian));
        assert.equal(r.status, 200);
        assert.equal(calls.sendMail, 1);
        assert.deepEqual(argsLog.mail[0].to, [process.env.EMAIL]);
        assert.equal(argsLog.mail[0].subject, `${LIST_UNAVAILABLE_SUBJECT_PREFIX}Consulta - enviado por Ana<ana@example.com>`);
        // Node 22 emite un ExperimentalWarning de MockTimers por console.error: se cuentan solo los registros de /send-email.
        const propios = registros.filter(([texto]) => String(texto).startsWith('[send-email]'));
        assert.deepEqual(propios, [['[send-email] recipient list unavailable, using EMAIL:', 'TimeoutError']]);
    });
    test('si la lectura responde a tiempo, el límite no altera el envío', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        seed.textJson[CLAVE] = [{ email: 'a@x.es' }];
        const r = await enviar();
        assert.equal(r.status, 200);
        assert.deepEqual(argsLog.mail[0].to, ['a@x.es']);
        t.mock.timers.tick(10000);
        assert.equal(calls.sendMail, 1);
    });
    test('la marca del asunto es la constante exportada', () => {
        assert.equal(LIST_UNAVAILABLE_SUBJECT_PREFIX, '[Aviso: lista de destinatarios no disponible] ');
    });
    test('un 400 de validación no lee S3', async () => {
        const r = await enviar({ ...validMail, email: 'mal' });
        assert.equal(r.status, 400);
        assert.equal(calls.s3Other, 0);
        assert.equal(calls.sendMail, 0);
    });
    test('una petición válida lee la lista una sola vez', async () => {
        await enviar();
        assert.equal(calls.s3Other, 1);
    });
});
