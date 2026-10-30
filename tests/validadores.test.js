// Pruebas de caracterización de los validadores puros: validateDataKey, validateImageKey y validateContactMessage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidDataKey, isValidDraftKey } = require('../functions/validateDataKey');
const { DRAFTS_PATH, RESERVED_SEGMENTS, PROVINCIA_RESERVED } = require('../config/s3Paths');
const { isValidImageKey } = require('../functions/validateImageKey');
const { validateContactMessage } = require('../functions/validateContactMessage');

const dataValidas = ['data/Málaga/2026-10-28_v1.xlsx', 'data/Santa Cruz de Tenerife/2026-01-02_v12.xlsx', 'data/Castellón-Castelló/2026-10-28_v3.xlsx'];
const dataInvalidas = [
    ['no es cadena', 5], ['undefined', undefined], ['array', ['data/Malaga/2026-10-28_v1.xlsx']], ['vacía', ''],
    ['sin carpeta de provincia', 'data/2026-10-28_v1.xlsx'], ['un segmento de más', 'data/Malaga/x/2026-10-28_v1.xlsx'],
    ['otra raíz', 'drafts/Malaga/2026-10-28_v1.xlsx'], ['provincia reservada active', 'data/active/2026-10-28_v1.xlsx'],
    ['provincia __proto__', 'data/__proto__/2026-10-28_v1.xlsx'], ['recorrido ..', 'data/../2026-10-28_v1.xlsx'],
    ['nombre de archivo sin versión', 'data/Malaga/2026-10-28.xlsx'], ['extensión distinta', 'data/Malaga/2026-10-28_v1.json'],
    ['provincia en NFD', 'data/Ma\u{301}laga/2026-10-28_v1.xlsx'], ['más de 120 caracteres', `data/${'a'.repeat(50)}/${'2026-10-28_v1.xlsx'.padStart(80, '0')}`],
];

test('las listas de casos de validadores no están vacías', () => {
    assert.ok(dataValidas.length > 0);
    assert.ok(dataInvalidas.length > 0);
});

for (const key of dataValidas) {
    test(`validateDataKey acepta ${key}`, () => assert.equal(isValidDataKey(key), true));
}
for (const [nombre, key] of dataInvalidas) {
    test(`validateDataKey rechaza ${nombre}`, () => assert.equal(isValidDataKey(key), false));
}

// Clave de borrador (A2): data/drafts/<provincia>/<uuid en minúsculas>.xlsx. Solo la reconoce isValidDraftKey.
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const borradorValidas = [`data/drafts/Málaga/${UUID}.xlsx`, `data/drafts/Santa Cruz de Tenerife/${UUID}.xlsx`];
const borradorInvalidas = [
    ['no es cadena', 5], ['undefined', undefined], ['array', [`data/drafts/Málaga/${UUID}.xlsx`]], ['vacía', ''],
    ['clave de versión', 'data/Málaga/2026-10-28_v1.xlsx'], ['provincia reservada active', `data/drafts/active/${UUID}.xlsx`],
    ['provincia reservada drafts', `data/drafts/drafts/${UUID}.xlsx`], ['recorrido ..', `data/drafts/../${UUID}.xlsx`],
    ['provincia ..', `data/drafts/../x/${UUID}.xlsx`], ['un segmento de más', `data/drafts/Málaga/x/${UUID}.xlsx`],
    ['un segmento de menos', `data/drafts/${UUID}.xlsx`], ['otra raíz', `x/drafts/Málaga/${UUID}.xlsx`],
    ['segundo segmento distinto', `data/otro/Málaga/${UUID}.xlsx`], ['provincia en NFD', `data/drafts/${'Málaga'.normalize('NFD')}/${UUID}.xlsx`],
    ['uuid en mayúsculas', `data/drafts/Málaga/${UUID.toUpperCase()}.xlsx`], ['sin extensión', `data/drafts/Málaga/${UUID}`],
    ['extensión distinta', `data/drafts/Málaga/${UUID}.json`], ['nombre no uuid', 'data/drafts/Málaga/2026-10-28_v1.xlsx'],
    ['provincia __proto__', `data/drafts/__proto__/${UUID}.xlsx`], ['más de 120 caracteres', `data/drafts/${'a'.repeat(50)}/${'0'.repeat(80)}${UUID}.xlsx`],
];

test('las listas de casos de claves de borrador no están vacías', () => {
    assert.ok(borradorValidas.length > 0);
    assert.ok(borradorInvalidas.length > 0);
});
for (const key of borradorValidas) {
    test(`isValidDraftKey acepta ${key}`, () => assert.equal(isValidDraftKey(key), true));
    test(`isValidDataKey rechaza la clave de borrador ${key}`, () => assert.equal(isValidDataKey(key), false));
}
for (const [nombre, key] of borradorInvalidas) {
    test(`isValidDraftKey rechaza ${nombre}`, () => assert.equal(isValidDraftKey(key), false));
}
test('PROVINCIA_RESERVED y RESERVED_SEGMENTS incluyen drafts', () => {
    assert.ok(RESERVED_SEGMENTS.includes('drafts'));
    assert.ok(PROVINCIA_RESERVED.includes('drafts'));
});
test('DRAFTS_PATH es data/drafts', () => assert.equal(DRAFTS_PATH, 'data/drafts'));

const imagenValidas =['foto.jpg', 'sub/foto-1_2.PNG', 'a.webp', 'b.gif', 'c.jpeg', 'foto(1).jpg', `${'a'.repeat(196)}.jpg`];
const imagenInvalidas = [
    ['no es cadena', 123], ['vacía', ''], ['recorrido ../', '../x.jpg'], ['a../b.jpg (defensa en profundidad)', 'a../b.jpg'],
    ['barra inicial', '/a.jpg'], ['doble barra', 'a//b.jpg'], ['espacio', 'a b.jpg'], ['control', 'a\u0001b.jpg'],
    ['marca combinante inicial', '\u{301}a.jpg'], ['extensión no permitida', 'a.txt'], ['sin extensión', 'a'], ['oculto', '.hidden.jpg'],
    ['201 caracteres', `${'a'.repeat(197)}.jpg`],
];

test('las listas de casos de imageKey no están vacías', () => {
    assert.ok(imagenValidas.length > 0);
    assert.ok(imagenInvalidas.length > 0);
});

for (const key of imagenValidas) {
    test(`validateImageKey acepta ${key.slice(0, 40)}`, () => assert.equal(isValidImageKey(key), true));
}
for (const [nombre, key] of imagenInvalidas) {
    test(`validateImageKey rechaza ${nombre}`, () => assert.equal(isValidImageKey(key), false));
}

const correo = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };
const contactoInvalidos = [
    ['sin cuerpo', undefined], ['sin username', { ...correo, username: undefined }], ['username número', { ...correo, username: 5 }],
    ['subject solo espacios', { ...correo, subject: '   ' }], ['correo abc', { ...correo, email: 'abc' }],
    ['username de 101', { ...correo, username: 'a'.repeat(101) }], ['subject de 151', { ...correo, subject: 'a'.repeat(151) }],
    ['message de 2001', { ...correo, message: 'a'.repeat(2001) }], ['correo de 255', { ...correo, email: `${'a'.repeat(243)}@example.com` }],
    ['salto de línea en username', { ...correo, username: 'Ana\nBcc: x@y.z' }], ['U+2028 en subject', { ...correo, subject: 'Hola\u{2028}Bcc' }],
    ['U+0085 en subject', { ...correo, subject: 'Hola\u{85}Bcc' }], ['NUL en message', { ...correo, message: 'Hola\u0000' }],
];

test('la lista de casos de contacto no está vacía', () => assert.ok(contactoInvalidos.length > 0));

for (const [nombre, body] of contactoInvalidos) {
    test(`validateContactMessage rechaza ${nombre}`, () => {
        const resultado = validateContactMessage(body);
        assert.equal(typeof resultado.error, 'string');
        assert.equal(resultado.value, undefined);
    });
}
test('validateContactMessage acepta un cuerpo válido y recorta los campos', () => {
    const { value, error } = validateContactMessage({ username: ' Ana ', email: ' ana@example.com ', subject: ' Hola ', message: ' Texto ' });
    assert.equal(error, undefined);
    assert.deepEqual(value, { username: 'Ana', email: 'ana@example.com', subject: 'Hola', message: 'Texto' });
});
test('validateContactMessage admite saltos de línea y tabulador en el mensaje', () => {
    assert.equal(validateContactMessage({ ...correo, message: 'L1\nL2\r\n\tL3' }).error, undefined);
});
test('validateContactMessage acepta los límites exactos', () => {
    const body = { username: 'a'.repeat(100), email: `${'a'.repeat(242)}@example.com`, subject: 'a'.repeat(150), message: 'a'.repeat(2000) };
    assert.equal(validateContactMessage(body).error, undefined);
});
