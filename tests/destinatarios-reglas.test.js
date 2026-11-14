// Reglas puras de la lista de destinatarios del formulario de contacto (BE1 a BE5): functions/contactRecipients.js y
// isValidEmailAddress. Sin app, sin S3 y sin SMTP.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmailAddress } = require('../functions/validateContactMessage');
const {
    RECIPIENTS_MIN, RECIPIENTS_MAX, normalizeEmail, sanitizeRecipients, planAddRecipient, planRemoveRecipient,
    maskEmail, buildRecipientChangeNotice, recipientsForContact, LIST_UNAVAILABLE_SUBJECT_PREFIX,
} = require('../functions/contactRecipients');

const lista = (...emails) => emails.map((email) => ({ email }));
const congelada = (...emails) => Object.freeze(emails.map((email) => Object.freeze({ email })));
const SECRETO = 'secreto@ejemplo.org';

describe('isValidEmailAddress: la misma regla que /send-email', () => {
    const validas = ['a@b.com', 'nombre+tag@sub.dominio.es', 'ana@example.com', `${'a'.repeat(242)}@example.com`, 'josé.núñez@ejemplo.es', '用户@例子.广告'];
    const invalidas = [
        ['sin arroba', 'abc'], ['con espacio', 'a b@c.d'], ['dos destinatarios', 'a@b.c,d@e.f'], ['paréntesis', 'a(b)@example.com'],
        ['comilla simple', "o'brien@example.com"], ['barra invertida', 'a\\b@example.com'], ['dos puntos', 'a:b@example.com'],
        ['255 caracteres', `${'a'.repeat(243)}@example.com`], ['salto de línea', 'ana@example.com\nBcc: x@y.z'],
        ['U+2028', 'ana\u{2028}@example.com'], ['NUL', 'ana\x00@example.com'], ['sin punto en el dominio', 'a@b'],
        ['U+200B (espacio de ancho cero) en la parte local', 'ana\u{200B}@example.com'],
        ['U+202E (inversión de texto) en el dominio', 'ana@exa\u{202E}mple.com'],
    ];
    for (const v of validas) test(`acepta ${v.slice(0, 30)}`, () => assert.equal(isValidEmailAddress(v), true));
    for (const [nombre, v] of invalidas) test(`rechaza ${nombre}`, () => assert.equal(isValidEmailAddress(v), false));
});

describe('constantes y normalizeEmail', () => {
    test('mínimo 1 y máximo 5', () => {
        assert.equal(RECIPIENTS_MIN, 1);
        assert.equal(RECIPIENTS_MAX, 5);
    });
    test('normalizeEmail recorta y pasa a minúsculas', () => assert.equal(normalizeEmail('  Ana@Example.COM \t'), 'ana@example.com'));
});

describe('sanitizeRecipients', () => {
    test('deja solo los { email } con email de tipo cadena', () => {
        const sucia = [{ email: 'a@b.es' }, { email: 5 }, null, 'x@y.es', { nombre: 'x' }, { email: 'c@d.es', extra: 1 }, [], { email: undefined }];
        assert.deepEqual(sanitizeRecipients(sucia), lista('a@b.es', 'c@d.es'));
    });
    test('filtra por validez: descarta formato, \\p{Cf}, espacios alrededor y más de 254 caracteres (M30)', () => {
        const sucia = [
            { email: 'a@b.es' }, { email: 'mal' }, { email: 'x\u{200B}@y.es' }, { email: 'ana@exa\u{202E}mple.com' }, { email: ' c@d.es ' },
            { email: `${'a'.repeat(250)}@b.es` }, { email: 'p(q)@r.es' }, { email: 'e@f.es', extra: 1 },
        ];
        assert.deepEqual(sanitizeRecipients(sucia), lista('a@b.es', 'e@f.es'));
    });
    test('deduplica al leer: conserva la primera aparición por normalizeEmail, con su formato y su orden (M32)', () => {
        const entrada = congelada('Ana@x.es', 'b@x.es', 'ana@x.es', 'ANA@X.ES', 'b@x.es', 'c@x.es');
        assert.deepEqual(sanitizeRecipients(entrada), lista('Ana@x.es', 'b@x.es', 'c@x.es'));
        assert.deepEqual(entrada, lista('Ana@x.es', 'b@x.es', 'ana@x.es', 'ANA@X.ES', 'b@x.es', 'c@x.es'));
    });
    test('lo que no es un array da una lista vacía', () => {
        for (const v of [undefined, null, 'a@b.es', 5, {}]) assert.deepEqual(sanitizeRecipients(v), []);
    });
    test('no muta la lista recibida', () => {
        const entrada = congelada('a@b.es');
        assert.deepEqual(sanitizeRecipients(entrada), lista('a@b.es'));
        assert.deepEqual(entrada, lista('a@b.es'));
    });
});

describe('planAddRecipient', () => {
    test('un alta correcta devuelve la lista siguiente y la dirección recortada, tal como se escribió', () => {
        const r = planAddRecipient(congelada('a@b.es'), '  Ana.Perez@Example.COM  ');
        assert.deepEqual(r, { next: lista('a@b.es', 'Ana.Perez@Example.COM'), email: 'Ana.Perez@Example.COM' });
    });
    for (const [nombre, valor] of [['undefined', undefined], ['número', 5], ['array', ['a@b.es']], ['objeto', {}], ['vacío', ''], ['solo espacios', ' \t ']]) {
        test(`entrada ${nombre}: 400 email is required`, () => {
            assert.deepEqual(planAddRecipient(lista('a@b.es'), valor), { status: 400, error: 'email is required' });
        });
    }
    for (const [nombre, valor] of [['sin arroba', 'abc'], ['con paréntesis', 'a(b)@x.com'], ['dos direcciones', 'a@b.c,d@e.f'], ['de 255 caracteres', `${'a'.repeat(243)}@example.com`], ['con salto de línea', 'a@b.es\nBcc: x@y.z']]) {
        test(`formato ${nombre}: 400 email is not valid`, () => {
            assert.deepEqual(planAddRecipient(lista('a@b.es'), valor), { status: 400, error: 'email is not valid' });
        });
    }
    test('duplicado sin distinguir mayúsculas ni espacios: 400 Recipient already exists', () => {
        for (const v of ['A@B.ES', ' a@b.es ', 'a@b.es']) {
            assert.deepEqual(planAddRecipient(lista('a@b.es'), v), { status: 400, error: 'Recipient already exists' });
        }
    });
    test('duplicado frente a una entrada guardada con mayúsculas', () => {
        assert.deepEqual(planAddRecipient(lista('Ana@Example.com'), 'ana@example.COM'), { status: 400, error: 'Recipient already exists' });
    });
    test('con 4 destinatarios se acepta el alta y con 5 se rechaza', () => {
        const cuatro = congelada('a@b.es', 'b@b.es', 'c@b.es', 'd@b.es');
        const ok = planAddRecipient(cuatro, 'e@b.es');
        assert.equal(ok.next.length, RECIPIENTS_MAX);
        assert.equal(ok.email, 'e@b.es');
        const cinco = congelada('a@b.es', 'b@b.es', 'c@b.es', 'd@b.es', 'e@b.es');
        assert.deepEqual(planAddRecipient(cinco, 'f@b.es'), { status: 400, error: 'Recipient limit reached' });
    });
    test('orden de las comprobaciones: tipo, formato, duplicado y máximo', () => {
        const cinco = lista('a@b.es', 'b@b.es', 'c@b.es', 'd@b.es', 'e@b.es');
        assert.equal(planAddRecipient(cinco, 5).error, 'email is required');
        assert.equal(planAddRecipient(cinco, 'mal').error, 'email is not valid');
        assert.equal(planAddRecipient(cinco, 'A@b.es').error, 'Recipient already exists');
        assert.equal(planAddRecipient(cinco, 'f@b.es').error, 'Recipient limit reached');
    });
    test('con la lista vacía se acepta el alta', () => {
        assert.deepEqual(planAddRecipient([], 'a@b.es'), { next: lista('a@b.es'), email: 'a@b.es' });
    });
    test('no muta la lista recibida (en éxito ni en rechazo)', () => {
        const entrada = congelada('a@b.es');
        planAddRecipient(entrada, 'c@d.es');
        planAddRecipient(entrada, 'a@b.es');
        assert.deepEqual(entrada, lista('a@b.es'));
    });
    test('ningún mensaje de rechazo contiene el correo recibido (BE5)', () => {
        const cinco = lista('a@b.es', 'b@b.es', 'c@b.es', 'd@b.es', 'e@b.es');
        const rechazos = [
            planAddRecipient(lista(SECRETO), SECRETO), planAddRecipient(lista(SECRETO), SECRETO.toUpperCase()),
            planAddRecipient(cinco, SECRETO), planAddRecipient(lista('a@b.es'), `${SECRETO},otro@x.es`), planAddRecipient(lista('a@b.es'), `(${SECRETO}`),
        ];
        for (const r of rechazos) {
            assert.equal(r.status, 400);
            assert.ok(!r.error.toLowerCase().includes('secreto'), r.error);
        }
    });
});

describe('planRemoveRecipient', () => {
    test('una baja correcta devuelve la lista siguiente y la dirección guardada', () => {
        const r = planRemoveRecipient(congelada('a@b.es', 'Ana@Example.com'), ' ANA@example.COM ');
        assert.deepEqual(r, { next: lista('a@b.es'), removed: 'Ana@Example.com' });
    });
    for (const [nombre, valor] of [['undefined', undefined], ['número', 5], ['array', ['a@b.es']], ['vacío', ''], ['solo espacios', '   ']]) {
        test(`entrada ${nombre}: 400 email is required`, () => {
            assert.deepEqual(planRemoveRecipient(lista('a@b.es', 'b@b.es'), valor), { status: 400, error: 'email is required' });
        });
    }
    test('más de 254 caracteres: 400 sin buscar en la lista', () => {
        const largo = `${'a'.repeat(250)}@b.es`;
        assert.deepEqual(planRemoveRecipient(lista('a@b.es', 'b@b.es'), largo), { status: 400, error: 'email is not valid' });
    });
    test('exactamente 254 caracteres sigue el curso normal (404 si no existe)', () => {
        const justo = `${'a'.repeat(249)}@b.es`;
        assert.equal(justo.length, 254);
        assert.deepEqual(planRemoveRecipient(lista('a@b.es', 'b@b.es'), justo), { status: 404, error: 'Recipient not found' });
    });
    test('un destinatario que no existe da 404 Recipient not found', () => {
        assert.deepEqual(planRemoveRecipient(lista('a@b.es', 'b@b.es'), 'z@b.es'), { status: 404, error: 'Recipient not found' });
    });
    test('quitar el último da 400 At least one recipient is required', () => {
        assert.deepEqual(planRemoveRecipient(lista('a@b.es'), 'A@B.es'), { status: 400, error: 'At least one recipient is required' });
    });
    test('un inexistente con un solo destinatario da 404 (no existe va antes que último)', () => {
        assert.equal(planRemoveRecipient(lista('a@b.es'), 'z@b.es').status, 404);
    });
    test('no muta la lista recibida', () => {
        const entrada = congelada('a@b.es', 'b@b.es');
        planRemoveRecipient(entrada, 'a@b.es');
        planRemoveRecipient(entrada, 'z@b.es');
        assert.deepEqual(entrada, lista('a@b.es', 'b@b.es'));
    });
    test('ningún mensaje de rechazo contiene el correo recibido (BE5)', () => {
        const rechazos = [
            planRemoveRecipient(lista('a@b.es', 'b@b.es'), SECRETO), planRemoveRecipient(lista(SECRETO), SECRETO),
            planRemoveRecipient(lista('a@b.es'), `${SECRETO}${'x'.repeat(260)}`),
        ];
        for (const r of rechazos) assert.ok(!r.error.toLowerCase().includes('secreto'), r.error);
    });
});

describe('maskEmail', () => {
    test('primer carácter, ***@ y el dominio', () => {
        assert.equal(maskEmail('ana.garcia@example.com'), 'a***@example.com');
        assert.equal(maskEmail('Z@sub.dominio.es'), 'Z***@sub.dominio.es');
    });
    test('sin @ da ***', () => {
        assert.equal(maskEmail('sin-arroba'), '***');
        assert.equal(maskEmail(''), '***');
    });
    test('no deja ver la parte local', () => assert.ok(!maskEmail('ana.garcia@example.com').includes('na.garcia')));
    test('sustituye cada \\p{Cf} por ? (no lo borra ni lo reproduce)', () => {
        assert.equal(maskEmail('\u{202E}ana@example.com'), '?***@example.com');
        assert.equal(maskEmail('ana@exa\u{200B}mple.com'), 'a***@exa?mple.com');
        assert.equal(maskEmail('ana@e\u{200B}x\u{202E}ample.com'), 'a***@e?x?ample.com');
        for (const m of [maskEmail('\u{202E}ana@example.com'), maskEmail('ana@exa\u{200B}mple.com')]) assert.ok(!/\p{Cf}/u.test(m), m);
    });
});

describe('buildRecipientChangeNotice', () => {
    const date = new Date('2026-11-12T09:05:59Z');
    const alta = buildRecipientChangeNotice({ action: 'add', email: 'ana.garcia@example.com', date });
    const baja = buildRecipientChangeNotice({ action: 'remove', email: 'ana.garcia@example.com', date });

    test('devuelve { subject, text } con cadenas', () => {
        for (const aviso of [alta, baja]) {
            assert.deepEqual(Object.keys(aviso).sort(), ['subject', 'text']);
            assert.equal(typeof aviso.subject, 'string');
            assert.equal(typeof aviso.text, 'string');
        }
    });
    test('indica el tipo de cambio, la dirección enmascarada, la fecha en UTC y qué hacer si no se reconoce', () => {
        assert.match(alta.subject, /alta/i);
        assert.match(baja.subject, /baja/i);
        assert.notEqual(alta.text, baja.text);
        for (const aviso of [alta, baja]) {
            assert.ok(aviso.text.includes('a***@example.com'), aviso.text);
            assert.ok(aviso.text.includes('2026-11-12 09:05 UTC'), aviso.text);
            assert.ok(aviso.text.toLowerCase().includes('si no reconoces este cambio, avisa al administrador del sitio'), aviso.text);
        }
    });
    test('ni el asunto ni el texto llevan la dirección completa', () => {
        for (const aviso of [alta, baja]) {
            assert.ok(!aviso.subject.includes('ana.garcia'), aviso.subject);
            assert.ok(!aviso.text.includes('ana.garcia'), aviso.text);
            assert.ok(!aviso.text.includes('ana.garcia@example.com'));
        }
    });
    test('con \\p{Cf} en la dirección, el aviso lleva ? y ningún carácter de formato (M31)', () => {
        for (const action of ['add', 'remove']) {
            const a = buildRecipientChangeNotice({ action, email: '\u{202E}ana@example.com', date });
            const b = buildRecipientChangeNotice({ action, email: 'ana@exa\u{200B}mple.com', date });
            assert.ok(a.text.includes('?***@example.com'), a.text);
            assert.ok(b.text.includes('a***@exa?mple.com'), b.text);
            for (const aviso of [a, b]) {
                assert.ok(!/\p{Cf}/u.test(aviso.subject), aviso.subject);
                assert.ok(!/\p{Cf}/u.test(aviso.text), aviso.text);
            }
        }
    });
    test('el texto es fijo: no depende de la hora salvo en la fecha', () => {
        const otra = buildRecipientChangeNotice({ action: 'add', email: 'ana.garcia@example.com', date: new Date('2026-12-31T23:59:00Z') });
        assert.equal(otra.text.replace('2026-12-31 23:59', '2026-11-12 09:05'), alta.text);
    });
});

describe('recipientsForContact', () => {
    test('devuelve los correos válidos de la lista, en su orden', () => {
        assert.deepEqual(recipientsForContact(congelada('a@b.es', 'c@d.es'), 'resp@x.es'), ['a@b.es', 'c@d.es']);
    });
    test('descarta las entradas no válidas (formato, controles, espacios, más de 254 caracteres)', () => {
        const sucia = lista('a@b.es', 'mal', 'x@y.es,z@w.es', 'q@r.es\nBcc: s@t.es', ' c@d.es ', `${'a'.repeat(250)}@b.es`, 'p(q)@r.es');
        assert.deepEqual(recipientsForContact(sucia, 'resp@x.es'), ['a@b.es']);
    });
    test('descarta las direcciones con \\p{Cf} (M31)', () => {
        assert.deepEqual(recipientsForContact(lista('a@b.es', 'x\u{200B}@y.es', 'q@r\u{202E}.es'), 'resp@x.es'), ['a@b.es']);
    });
    test('deduplica sin distinguir mayúsculas ni espacios, con el orden y el formato de la primera aparición (M32)', () => {
        const entrada = congelada('Ana@x.es', 'b@x.es', 'ana@x.es', 'ANA@X.ES', 'b@x.es');
        assert.deepEqual(recipientsForContact(entrada, 'resp@x.es'), ['Ana@x.es', 'b@x.es']);
        assert.deepEqual(entrada, lista('Ana@x.es', 'b@x.es', 'ana@x.es', 'ANA@X.ES', 'b@x.es'));
    });
    test('con la lista vacía o sin ninguna entrada válida devuelve [respaldo]', () => {
        assert.deepEqual(recipientsForContact([], 'resp@x.es'), ['resp@x.es']);
        assert.deepEqual(recipientsForContact(lista('mal', 'peor'), 'resp@x.es'), ['resp@x.es']);
    });
    test('no muta la lista y devuelve un array nuevo', () => {
        const entrada = congelada('a@b.es');
        const salida = recipientsForContact(entrada, 'resp@x.es');
        assert.deepEqual(entrada, lista('a@b.es'));
        assert.notEqual(salida, entrada);
    });
});

test('la marca del asunto cuando la lista no está disponible', () => {
    assert.equal(LIST_UNAVAILABLE_SUBJECT_PREFIX, '[Aviso: lista de destinatarios no disponible] ');
});
