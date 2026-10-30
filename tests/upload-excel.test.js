// Criterio 13 del antiguo script de verificación de rutas (retirado): POST /upload con un Excel real en memoria y convertExcelToJson real:
// provincia válida e inválida, y borradores con draftKey. S3 simulado. Los nombres de los casos son los del script.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, argsLog, isEnvelopeError, reiniciar, seed } = require('./helpers/simulados');
const { fullRow, subir } = require('./helpers/excel');

const app = appNueva();
beforeEach(reiniciar);

const FILE_RE = /^\d{4}-\d{2}-\d{2}_v\d+\.xlsx$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DRAFT_RE = new RegExp(`^data/drafts/Málaga/${UUID}\\.xlsx$`, 'u');
const nfd = 'Málaga'.normalize('NFD');

const ok = [
    ['Málaga', [fullRow('Málaga')], 'Málaga'], ['con espacios', [fullRow(' Málaga ')], 'Málaga'], ['en NFD', [fullRow(nfd)], 'Málaga'],
    ['varias filas con la misma provincia', [fullRow('Málaga'), fullRow('Málaga')], 'Málaga'],
    ['Santa Cruz de Tenerife', [fullRow('Santa Cruz de Tenerife')], 'Santa Cruz de Tenerife'],
];
const malos = [
    ['sin filas', [], 'Province is required'], ['primera fila sin provincia', [fullRow(null), fullRow('Sevilla')], 'Province is required'],
    ['solo espacios', [fullRow('   ')], 'Province is required'],
    ['active', [fullRow('active')], 'Province is reserved'], ['terms', [fullRow('terms')], 'Province is reserved'],
    ['drafts', [fullRow('drafts')], 'Province is reserved'], ['Active (mayúscula)', [fullRow('Active')], 'Province is reserved'],
    ['__proto__', [fullRow('__proto__')], 'Province is not valid'], ['constructor', [fullRow('constructor')], 'Province is not valid'],
    ['con barra', [fullRow('a/b')], 'Province is not valid'], ['con barra invertida', [fullRow('a\\b')], 'Province is not valid'],
    ['con ..', [fullRow('..')], 'Province is not valid'], ['numérica', [fullRow(5)], 'Province is not valid'],
    ['con coma (array)', [fullRow('a,b')], 'Province is not valid'], ['51 letras', [fullRow('a'.repeat(51))], 'Province is not valid'],
    ['a cirílica', [fullRow('Mál\u0430ga')], 'Province is not valid'], ['alfa griega', [fullRow('Gr\u03B1nada')], 'Province is not valid'],
    ['número romano', [fullRow('\u2160')], 'Province is not valid'], ['CGJ invisible', [fullRow('a\u034F')], 'Province is not valid'],
    ['dos provincias', [fullRow('Málaga'), fullRow('Sevilla')], 'Excel contains more than one province'],
    ['otra fila con coma', [fullRow('Málaga'), fullRow('Málaga,Sevilla')], 'Excel contains more than one province'],
];
// Filas con celdas vacías: el borrador va a data/drafts/<provincia>/<uuid>.xlsx (A2) y se conserva data.draftKey.
const borradores = [
    ['fila posterior sin provincia', [fullRow('Málaga'), fullRow(null)]],
    ['primera fila con otras celdas vacías', [['Málaga', null, null, null, null, null, null, null, null, null, null]]],
];

test('las listas de casos del criterio 13 no están vacías', () => {
    assert.ok(ok.length > 0);
    assert.ok(malos.length > 0);
    assert.ok(borradores.length > 0);
});

for (const [n, rows, carpeta] of ok) {
    test(`éxito ${n}`, async () => {
        const r = await subir(app, rows);
        const subidas = argsLog.upload;
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(subidas.length, 2);
        assert.match(subidas[0][0], FILE_RE);
        assert.equal(subidas[0][2], `data/${carpeta}`);
        assert.equal(subidas[1][0], `${carpeta}.json`);
        assert.equal(subidas[1][2], 'data/active');
        assert.equal(r.json?.data?.key, `data/${carpeta}/${subidas[0][0]}`);
    });
}

for (const [n, rows, mensaje] of malos) {
    test(`400 ${n}`, async () => {
        const r = await subir(app, rows);
        assert.ok(r.status === 400 && isEnvelopeError({ json: r.json }) && r.json.error === mensaje, `${r.status} ${r.json?.error}`);
        assert.equal(argsLog.upload.length, 0, 'no debe subir nada');
        assert.equal(argsLog.list.length, 0, 'no debe listar versiones');
    });
}

for (const [n, rows] of borradores) {
    test(`borrador ${n}`, async () => {
        const r = await subir(app, rows);
        assert.equal(r.status, 400);
        assert.equal(r.json?.error, 'Some rows have empty fields.');
        assert.match(r.json?.data?.draftKey ?? '', DRAFT_RE);
        assert.equal(argsLog.upload.length, 1);
        assert.equal(argsLog.upload[0][2], 'data/drafts/Málaga');
        assert.equal(`data/drafts/Málaga/${argsLog.upload[0][0]}`, r.json.data.draftKey);
    });
}

test('borrador: cuerpo completo del 400 sin processedData ni rowData', async () => {
    const sinMunicipio = [...fullRow('Málaga')];
    sinMunicipio[1] = null;
    // Cabecera en la fila 1: los datos son las filas 2 a 5; las filas 3 y 5 tienen una celda vacía.
    const r = await subir(app, [fullRow('Málaga'), sinMunicipio, fullRow('Málaga'), sinMunicipio]);
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.json).sort(), ['data', 'error', 'success']);
    assert.equal('processedData' in r.json.data, false);
    assert.ok(r.json.data.emptyFields.every((f) => !('rowData' in f)));
    const { draftKey, ...resto } = r.json.data;
    assert.match(draftKey, DRAFT_RE);
    assert.deepEqual(r.json, {
        success: false,
        error: 'Some rows have empty fields.',
        data: {
            emptyFields: [{ rowIndex: 3 }, { rowIndex: 5 }],
            draftKey,
            actionRequired: 'Confirm whether to continue or cancel the upload.',
        },
    });
    assert.deepEqual(Object.keys(resto).sort(), ['actionRequired', 'emptyFields']);
    assert.equal(argsLog.upload.length, 1);
});

// A2/A9: el doble de S3 devuelve seed.list para cualquier prefijo; aquí seed.list es el contenido de data/drafts/Málaga/.
const sinSufijo = (clave) => clave.replace(/^data\/drafts\/Málaga\//u, '');
const BORRADOR_PREVIO = 'data/drafts/Málaga/123e4567-e89b-42d3-a456-426614174000.xlsx';
const lista = (...claves) => claves.map((key) => ({ name: sinSufijo(key), key }));

test('borrador con un borrador previo: borra solo el previo válido, no el nuevo ni lo que no es un borrador', async () => {
    const intruso = 'data/drafts/Málaga/notas.txt';
    const subcarpeta = 'data/drafts/Málaga/sub/123e4567-e89b-42d3-a456-426614174111.xlsx';
    seed.list = lista(BORRADOR_PREVIO, intruso, subcarpeta);
    const r = await subir(app, [fullRow('Málaga'), fullRow(null)]);
    assert.equal(r.status, 400);
    assert.deepEqual(argsLog.list.map((a) => a[0]), ['data/drafts/Málaga']);
    assert.deepEqual(argsLog.del.map((a) => a[0]), [BORRADOR_PREVIO]);
});

test('subida completa con un borrador previo: lo borra tras activar la versión', async () => {
    seed.list = lista(BORRADOR_PREVIO);
    const r = await subir(app, [fullRow('Málaga')]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(argsLog.list.map((a) => a[0]), ['data/Málaga', 'data/drafts/Málaga']);
    assert.deepEqual(argsLog.del.map((a) => a[0]), [BORRADOR_PREVIO]);
});
