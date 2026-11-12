// Rutas de la lista de destinatarios del formulario de contacto (BE1, BE2, BE5, BE6, BE7): GET /list-recipients,
// POST /add-recipient y DELETE /delete-recipient, con S3 y SMTP simulados (helpers/simulados.js).
// Las rutas protegidas y su 401 en los tres estados de token se comprueban en rutas-protegidas.test.js.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    appNueva, llamar, isEnvelopeError, reiniciar, calls, inject, argsLog, seed, nextIp, validToken,
} = require('./helpers/simulados');

const cr = require('../functions/contactRecipients');

const PREFIX = '/api/v1';
const CLAVE = 'data/contact/recipients.json';
const validMail = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };
// El aviso se envía sin esperar: hay que dejar correr la cola antes de mirar los contadores del transporte.
const esperarAviso = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
const lista = (...emails) => emails.map((email) => ({ email }));
const sembrar = (...emails) => { seed.textJson[CLAVE] = lista(...emails); };
const errorSdk = (name) => Object.assign(new Error(`secreto interno ${name}`), { name, Code: name });

beforeEach(reiniciar);

// Llamada autorizada desde una IP propia (los limitadores no se pisan entre casos).
const llamarAutorizado = (app, method, path, body, ip = nextIp()) => llamar(app, method, `${PREFIX}${path}`, { token: validToken, body, ip });

describe('GET /list-recipients', () => {
    const app = appNueva();

    test('sin fichero devuelve una lista vacía (no EMAIL)', async () => {
        const r = await llamarAutorizado(app, 'GET', '/list-recipients');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { success: true, data: [] });
        assert.equal(calls.s3Other, 1);
        assert.deepEqual(argsLog.put, []);
    });
    test('con la lista sembrada la devuelve en su orden como [{ email }]', async () => {
        sembrar('b@x.es', 'A@x.es', 'c@x.es');
        const r = await llamarAutorizado(app, 'GET', '/list-recipients');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.data, lista('b@x.es', 'A@x.es', 'c@x.es'));
    });
    test('descarta las entradas del fichero que no son { email } de tipo cadena', async () => {
        seed.textJson[CLAVE] = [{ email: 'a@x.es', otro: 1 }, { email: 5 }, null, 'b@x.es'];
        const r = await llamarAutorizado(app, 'GET', '/list-recipients');
        assert.deepEqual(r.json.data, lista('a@x.es'));
    });
    test('no lleva limitador: doce lecturas desde la misma IP dan 200', async () => {
        const ip = nextIp();
        for (let i = 0; i < 12; i += 1) assert.equal((await llamarAutorizado(app, 'GET', '/list-recipients', undefined, ip)).status, 200);
    });
});

describe('POST /add-recipient', () => {
    const app = appNueva();
    const alta = (email, ip) => llamarAutorizado(app, 'POST', '/add-recipient', { email }, ip);

    test('un alta correcta escribe la lista completa con el correo recortado y tal como se escribió', async () => {
        sembrar('a@x.es');
        const r = await alta('  Ana.Perez@Example.COM ');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { success: true, data: 'Recipient added successfully' });
        assert.deepEqual(argsLog.put, [[CLAVE, lista('a@x.es', 'Ana.Perez@Example.COM')]]);
    });
    test('sin fichero, el alta crea la lista con un solo destinatario', async () => {
        const r = await alta('a@x.es');
        assert.equal(r.status, 200);
        assert.deepEqual(argsLog.put, [[CLAVE, lista('a@x.es')]]);
    });
    test('con 4 destinatarios se puede añadir el quinto y con 5 el sexto da 400 sin escribir', async () => {
        sembrar('a@x.es', 'b@x.es', 'c@x.es', 'd@x.es');
        assert.equal((await alta('e@x.es')).status, 200);
        assert.equal(argsLog.put.length, 1);
        const sexto = await alta('f@x.es');
        assert.equal(sexto.status, 400);
        assert.equal(sexto.json.error, 'Recipient limit reached');
        assert.equal(argsLog.put.length, 1);
    });
    const rechazos = [
        ['sin cuerpo', undefined, 'email is required'], ['email ausente', {}, 'email is required'], ['email número', { email: 5 }, 'email is required'],
        ['email vacío', { email: '   ' }, 'email is required'], ['formato inválido', { email: 'secreto(x)@ejemplo.org' }, 'email is not valid'],
        ['dos direcciones', { email: 'secreto@ejemplo.org,otro@x.es' }, 'email is not valid'],
        ['duplicado con otras mayúsculas y espacios', { email: ' A@X.ES ' }, 'Recipient already exists'],
    ];
    for (const [nombre, body, mensaje] of rechazos) {
        test(`rechazo ${nombre}: 400 ${mensaje}, sin escribir y sin enviar correo`, async () => {
            sembrar('a@x.es');
            const r = await llamarAutorizado(app, 'POST', '/add-recipient', body);
            assert.equal(r.status, 400);
            assert.ok(isEnvelopeError(r));
            assert.equal(r.json.error, mensaje);
            assert.deepEqual(argsLog.put, []);
            assert.equal(calls.sendMail, 0);
        });
    }
    test('ningún mensaje de rechazo contiene el correo recibido (BE5)', async () => {
        sembrar('secreto@ejemplo.org', 'b@x.es', 'c@x.es', 'd@x.es', 'e@x.es');
        for (const email of ['secreto@ejemplo.org', 'SECRETO@EJEMPLO.ORG', 'secreto2@ejemplo.org', 'secreto(@ejemplo.org']) {
            const r = await alta(email);
            assert.equal(r.status, 400);
            assert.ok(!r.text.toLowerCase().includes('secreto'), r.text);
        }
    });
});

describe('DELETE /delete-recipient', () => {
    const app = appNueva();
    const baja = (email, ip) => llamarAutorizado(app, 'DELETE', '/delete-recipient', { email }, ip);

    test('una baja correcta escribe la lista sin ese destinatario (sin distinguir mayúsculas ni espacios)', async () => {
        sembrar('a@x.es', 'Ana@Example.com', 'c@x.es');
        const r = await baja(' ANA@example.com ');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { success: true, data: 'Recipient deleted successfully' });
        assert.deepEqual(argsLog.put, [[CLAVE, lista('a@x.es', 'c@x.es')]]);
    });
    test('quitar uno que no existe da 404 Recipient not found sin escribir', async () => {
        sembrar('a@x.es', 'b@x.es');
        const r = await baja('secreto@ejemplo.org');
        assert.equal(r.status, 404);
        assert.equal(r.json.error, 'Recipient not found');
        assert.deepEqual(argsLog.put, []);
        assert.ok(!r.text.includes('secreto'));
    });
    test('quitar el último da 400 At least one recipient is required sin escribir', async () => {
        sembrar('a@x.es');
        const r = await baja('a@x.es');
        assert.equal(r.status, 400);
        assert.equal(r.json.error, 'At least one recipient is required');
        assert.deepEqual(argsLog.put, []);
    });
    test('sin fichero (lista vacía), quitar da 404 sin escribir', async () => {
        const r = await baja('a@x.es');
        assert.equal(r.status, 404);
        assert.equal(r.json.error, 'Recipient not found');
        assert.deepEqual(argsLog.put, []);
    });
    for (const [nombre, body] of [['sin cuerpo', undefined], ['email ausente', {}], ['email número', { email: 5 }], ['email vacío', { email: '  ' }], ['email de 255 caracteres', { email: `${'a'.repeat(250)}@x.es` }]]) {
        test(`rechazo ${nombre}: 400 sin escribir`, async () => {
            sembrar('a@x.es', 'b@x.es');
            const r = await llamarAutorizado(app, 'DELETE', '/delete-recipient', body);
            assert.equal(r.status, 400);
            assert.ok(isEnvelopeError(r));
            assert.deepEqual(argsLog.put, []);
        });
    }
});

describe('un fallo de lectura de la lista nunca se toma por lista vacía (S15 no se aplica a una lista privada)', () => {
    const app = appNueva();

    test('con AccessDenied, GET, POST y DELETE dan 500 sin escribir ni enviar correo', async () => {
        sembrar('a@x.es', 'b@x.es');
        inject.getTextJson = errorSdk('AccessDenied');
        const respuestas = [
            await llamarAutorizado(app, 'GET', '/list-recipients'),
            await llamarAutorizado(app, 'POST', '/add-recipient', { email: 'c@x.es' }),
            await llamarAutorizado(app, 'DELETE', '/delete-recipient', { email: 'a@x.es' }),
        ];
        for (const r of respuestas) {
            assert.equal(r.status, 500, `${r.status}`);
            assert.ok(isEnvelopeError(r));
            assert.ok(!r.text.includes('secreto interno'), r.text);
        }
        assert.deepEqual(argsLog.put, []);
        assert.equal(calls.sendMail, 0);
    });
});

describe('limitador de las escrituras: 10 cambios cada 15 minutos por IP', () => {
    const app = appNueva();
    const alta = (email, ip) => llamarAutorizado(app, 'POST', '/add-recipient', { email }, ip);
    const baja = (email, ip) => llamarAutorizado(app, 'DELETE', '/delete-recipient', { email }, ip);

    test('diez cambios dan 200 o 400, el undécimo da 429 sin escribir ni enviar y otra IP sigue pasando', async () => {
        sembrar('a@x.es');
        const ipA = nextIp();
        const ipB = nextIp();
        const estados = [];
        for (let i = 0; i < 6; i += 1) estados.push((await alta(`n${i}@x.es`, ipA)).status);
        for (let i = 0; i < 4; i += 1) estados.push((await baja('no-existe@x.es', ipA)).status);
        assert.equal(estados.length, 10);
        assert.ok(estados.every((s) => s === 200 || s === 400 || s === 404), estados.join(','));
        const puts = argsLog.put.length;
        const correos = calls.sendMail;

        const undecimo = await alta('z@x.es', ipA);
        assert.equal(undecimo.status, 429);
        assert.ok(isEnvelopeError(undecimo), JSON.stringify(undecimo.json));
        assert.equal(undecimo.headers['ratelimit-limit'], '10');
        assert.equal((await baja('a@x.es', ipA)).status, 429, 'alta y baja comparten el mismo limitador');
        assert.equal(argsLog.put.length, puts);
        assert.equal(calls.sendMail, correos);

        assert.equal((await baja('a@x.es', ipB)).status, 200, 'otra IP sigue pasando (la lista tiene 5: la baja es posible)');
    });
    test('los 400 también cuentan para el límite', async () => {
        const ip = nextIp();
        for (let i = 0; i < 10; i += 1) assert.equal((await llamarAutorizado(app, 'POST', '/add-recipient', {}, ip)).status, 400);
        assert.equal((await llamarAutorizado(app, 'POST', '/add-recipient', { email: 'a@x.es' }, ip)).status, 429);
    });
    test('una petición sin token no consume el límite de una IP (tokenAuth va primero)', async () => {
        const ip = nextIp();
        for (let i = 0; i < 12; i += 1) assert.equal((await llamar(app, 'POST', `${PREFIX}/add-recipient`, { body: { email: 'a@x.es' }, ip })).status, 401);
        assert.equal((await alta('a@x.es', ip)).status, 200);
    });
});

describe('aviso por correo a los destinatarios anteriores (BE10 a BE14)', () => {
    const app = appNueva();
    const alta = (email, ip) => llamarAutorizado(app, 'POST', '/add-recipient', { email }, ip);
    const baja = (email, ip) => llamarAutorizado(app, 'DELETE', '/delete-recipient', { email }, ip);
    const destinatarios = () => argsLog.mail.map((m) => m.to);

    test('un alta avisa a cada destinatario anterior, uno por envío, y no al añadido', async () => {
        sembrar('a@x.es', 'b@x.es');
        assert.equal((await alta('nuevo@x.es')).status, 200);
        await esperarAviso();
        assert.equal(calls.sendMail, 2);
        assert.deepEqual(destinatarios(), ['a@x.es', 'b@x.es']);
        for (const m of argsLog.mail) {
            assert.equal(m.from, process.env.EMAIL);
            assert.equal(typeof m.subject, 'string');
            assert.equal(typeof m.text, 'string');
        }
    });
    test('una baja avisa a todos los anteriores, también al quitado', async () => {
        sembrar('a@x.es', 'b@x.es', 'c@x.es');
        assert.equal((await baja('B@x.es')).status, 200);
        await esperarAviso();
        assert.equal(calls.sendMail, 3);
        assert.deepEqual(destinatarios(), ['a@x.es', 'b@x.es', 'c@x.es']);
    });
    test('si la lista anterior estaba vacía o no existía, el aviso va a EMAIL', async () => {
        assert.equal((await alta('primero@x.es')).status, 200);
        await esperarAviso();
        assert.deepEqual(destinatarios(), [process.env.EMAIL]);
    });
    const rechazos = [
        ['alta duplicada', () => alta('A@X.es')], ['alta con formato inválido', () => alta('mal')], ['alta sin cuerpo', () => llamarAutorizado(app, 'POST', '/add-recipient')],
        ['baja de uno inexistente', () => baja('z@x.es')], ['baja del último', () => baja('a@x.es')],
    ];
    for (const [nombre, hacer] of rechazos) {
        test(`${nombre}: no se envía ningún aviso`, async () => {
            sembrar('a@x.es');
            const r = await hacer();
            assert.ok(r.status === 400 || r.status === 404, `${r.status}`);
            await esperarAviso();
            assert.equal(calls.sendMail, 0);
        });
    }
    test('el sexto destinatario (400) y las lecturas no envían aviso', async () => {
        sembrar('a@x.es', 'b@x.es', 'c@x.es', 'd@x.es', 'e@x.es');
        assert.equal((await alta('f@x.es')).status, 400);
        assert.equal((await llamarAutorizado(app, 'GET', '/list-recipients')).status, 200);
        await esperarAviso();
        assert.equal(calls.sendMail, 0);
    });

    test('el aviso lleva el tipo de cambio, la dirección enmascarada y la fecha UTC, y ninguna dirección completa (BE12)', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T10:30:00Z') });
        sembrar('b@x.es', 'otro@y.es');
        assert.equal((await alta('ana.garcia@example.com')).status, 200);
        await esperarAviso();
        assert.equal(argsLog.mail.length, 2);
        for (const m of argsLog.mail) {
            assert.match(m.subject, /alta/i);
            assert.ok(m.text.includes('a***@example.com'), m.text);
            assert.ok(m.text.includes('2026-11-12 10:30 UTC'), m.text);
            for (const completa of ['ana.garcia', 'b@x.es', 'otro@y.es', process.env.EMAIL]) {
                assert.ok(!m.text.includes(completa) && !m.subject.includes(completa), `lleva ${completa}`);
            }
        }
    });
    test('el aviso de una baja dice baja y enmascara la dirección quitada', async () => {
        sembrar('b@x.es', 'ana.garcia@example.com');
        assert.equal((await baja('ana.garcia@example.com')).status, 200);
        await esperarAviso();
        assert.match(argsLog.mail[0].subject, /baja/i);
        assert.ok(argsLog.mail[0].text.includes('a***@example.com'));
        assert.ok(!argsLog.mail[0].text.includes('ana.garcia'));
    });

    test('si el transporte falla: 200, lista escrita y un único registro fijo, sin la dirección ni el error (BE13)', async (t) => {
        const registros = [];
        t.mock.method(console, 'error', (...args) => { registros.push(args); });
        inject.sendMail = new Error('smtp secreto ana.garcia@example.com 535 credenciales');
        sembrar('a@x.es', 'b@x.es');
        const r = await alta('ana.garcia@example.com');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { success: true, data: 'Recipient added successfully' });
        assert.deepEqual(argsLog.put, [[CLAVE, lista('a@x.es', 'b@x.es', 'ana.garcia@example.com')]]);
        await esperarAviso();
        assert.equal(calls.sendMail, 2, 'se intentó avisar a los dos');
        assert.deepEqual(registros, [['[recipients] change notice not sent']]);
        const texto = JSON.stringify(registros);
        for (const prohibido of ['ana.garcia', 'a@x.es', 'secreto', '535', 'credenciales']) assert.ok(!texto.includes(prohibido), prohibido);
    });
    test('si el transporte falla en una baja, también 200 y el mismo registro fijo', async (t) => {
        const registros = [];
        t.mock.method(console, 'error', (...args) => { registros.push(args); });
        inject.sendMail = new Error('boom');
        sembrar('a@x.es', 'b@x.es');
        assert.equal((await baja('b@x.es')).status, 200);
        assert.deepEqual(argsLog.put, [[CLAVE, lista('a@x.es')]]);
        await esperarAviso();
        assert.deepEqual(registros, [['[recipients] change notice not sent']]);
    });
});

describe('el aviso solo va a direcciones válidas de la lista anterior', () => {
    const app = appNueva();
    const sucia = [{ email: 'a@x.es' }, { email: 'a b@x.com' }, { email: '' }, { nombre: 'sin email' }, { email: 'c,d@x.com' }, { email: 'b@x.es' }];

    test('con entradas válidas e inválidas en el fichero, solo las válidas reciben el aviso', async () => {
        seed.textJson[CLAVE] = sucia;
        // 5 entradas con texto en el fichero: el alta daría 400 (máximo), por eso se prueba con una baja.
        assert.equal((await llamarAutorizado(app, 'DELETE', '/delete-recipient', { email: 'a@x.es' })).status, 200);
        await esperarAviso();
        assert.deepEqual(argsLog.mail.map((m) => m.to), ['a@x.es', 'b@x.es']);
    });
    test('con todas las entradas inválidas, el aviso va a EMAIL como con la lista vacía', async () => {
        seed.textJson[CLAVE] = [{ email: 'a b@x.com' }, { email: '' }, { email: 'c,d@x.com' }];
        assert.equal((await llamarAutorizado(app, 'POST', '/add-recipient', { email: 'nuevo@x.es' })).status, 200);
        await esperarAviso();
        assert.deepEqual(argsLog.mail.map((m) => m.to), [process.env.EMAIL]);
    });
});

describe('el aviso no retrasa la respuesta', () => {
    const app = appNueva();
    const casos = [
        ['alta', () => llamarAutorizado(app, 'POST', '/add-recipient', { email: 'nuevo@x.es' }), lista('a@x.es', 'b@x.es', 'nuevo@x.es')],
        ['baja', () => llamarAutorizado(app, 'DELETE', '/delete-recipient', { email: 'b@x.es' }), lista('a@x.es')],
    ];
    for (const [nombre, hacer, escrita] of casos) {
        test(`${nombre}: con el envío colgado llega el 200 y la lista se escribe antes de liberarlo; luego el aviso sale`, async (t) => {
            let liberar;
            inject.sendMailEspera = new Promise((resolve) => { liberar = resolve; });
            t.after(() => liberar()); // si la respuesta se retrasa y el test falla, no deja la petición colgada
            sembrar('a@x.es', 'b@x.es');
            const pendiente = hacer();
            const limite = new Promise((resolve) => setTimeout(() => resolve('colgada'), 1000));
            const r = await Promise.race([pendiente, limite]);
            assert.notEqual(r, 'colgada', 'la respuesta espera al envío');
            assert.equal(r.status, 200);
            assert.deepEqual(argsLog.put, [[CLAVE, escrita]]);
            liberar();
            await esperarAviso();
            assert.equal(calls.sendMail, 2);
        });
    }
});

describe('el aviso no depende de sendEmailLimiter (BE14)', () => {
    test('5 envíos de /send-email desde una IP dan 200, el sexto 429 y un alta desde esa IP sigue avisando', async () => {
        const app = appNueva();
        const ip = nextIp();
        sembrar('a@x.es');
        for (let i = 0; i < 5; i += 1) assert.equal((await llamar(app, 'POST', `${PREFIX}/send-email`, { body: validMail, ip })).status, 200);
        assert.equal((await llamar(app, 'POST', `${PREFIX}/send-email`, { body: validMail, ip })).status, 429);
        const antes = calls.sendMail;
        const r = await llamarAutorizado(app, 'POST', '/add-recipient', { email: 'nuevo@x.es' }, ip);
        assert.equal(r.status, 200);
        await esperarAviso();
        assert.equal(calls.sendMail, antes + 1);
    });
});

describe('un fallo al construir el aviso no cambia la respuesta ni deja una promesa sin capturar', () => {
    test('con buildRecipientChangeNotice que lanza: 200, lista escrita y un único registro fijo (sin boom ni direcciones)', async (t) => {
        const registros = [];
        t.mock.method(console, 'error', (...args) => { registros.push(args); });
        let sinCapturar = 0;
        const contar = () => { sinCapturar += 1; };
        process.on('unhandledRejection', contar);
        t.after(() => process.off('unhandledRejection', contar));
        t.mock.method(cr, 'buildRecipientChangeNotice', () => { throw new Error('boom a@b.es'); });
        const app = appNueva(); // carga routes/content.js de nuevo: toma la función simulada
        sembrar('x@y.es');
        const r = await llamarAutorizado(app, 'POST', '/add-recipient', { email: 'n@y.es' });
        assert.equal(r.status, 200);
        assert.deepEqual(argsLog.put, [[CLAVE, lista('x@y.es', 'n@y.es')]]);
        await esperarAviso();
        assert.equal(calls.sendMail, 0);
        assert.deepEqual(registros, [['[recipients] change notice not sent']]);
        const texto = JSON.stringify(registros);
        assert.ok(!texto.includes('boom') && !texto.includes('a@b.es'), texto);
        assert.equal(sinCapturar, 0);
    });
});
