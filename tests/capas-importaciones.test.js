// Dirección de las dependencias entre capas (M14): aws/ no importa de functions/ (salvo PERMITIDAS, hoy vacía), y functions/ y
// middleware/ no importan aws/. Recorre TODO aws/, functions/ y middleware/ y resuelve cada especificador relativo contra la raíz del repositorio.
// config/ no se restringe: la guía permite aws → config y functions → config.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Destinos de functions/ que aws/ puede importar (ruta relativa a la raíz, con "/"). Vacía a propósito: ver docs/guias.
const PERMITIDAS = [];

// Lista de las importaciones de una fuente: { spec } para un argumento literal (comillas simples, dobles o plantilla sin
// interpolación) y { dinamico: true } para cualquier otro argumento. Busca require(, require.resolve( e import(.
const importacionesDe = (fuente) => {
    const encontradas = [];
    const apertura = /(?:^|[^\w$.])(?:require\.resolve|require|import)\s*\(\s*/g;
    while (apertura.exec(fuente) !== null) {
        const resto = fuente.slice(apertura.lastIndex);
        const comilla = resto[0];
        if (comilla === "'" || comilla === '"' || comilla === '`') {
            const cierre = resto.indexOf(comilla, 1);
            const literal = cierre === -1 ? null : resto.slice(1, cierre);
            const despues = cierre === -1 ? '' : resto.slice(cierre + 1).trimStart()[0];
            const interpolado = comilla === '`' && literal !== null && literal.includes('${');
            if (literal === null || interpolado || (despues !== ')' && despues !== ',')) encontradas.push({ dinamico: true });
            else encontradas.push({ spec: literal });
        } else {
            encontradas.push({ dinamico: true });
        }
    }
    return encontradas;
};

// Destino de un especificador relativo, relativo a la raíz y con "/" (null si es un paquete o un módulo del sistema).
const destinoDe = (archivo, spec) => {
    if (!spec.startsWith('.')) return null;
    return path.relative(ROOT, path.resolve(path.dirname(archivo), spec)).split(path.sep).join('/');
};

const rel = (archivo) => path.relative(ROOT, archivo).split(path.sep).join('/');

// Problemas de un archivo: argumentos no literales y dependencias en dirección prohibida.
const problemasDe = (archivo, fuente) => {
    const capa = path.relative(ROOT, archivo).split(path.sep)[0];
    const problemas = [];
    for (const imp of importacionesDe(fuente)) {
        if (imp.dinamico) {
            problemas.push(`${rel(archivo)}: importación con argumento no literal (no se puede comprobar)`);
            continue;
        }
        const destino = destinoDe(archivo, imp.spec);
        if (destino === null) continue;
        const capaDestino = destino.split('/')[0];
        if (capa === 'functions' && capaDestino === 'aws') problemas.push(`${rel(archivo)}: functions/ importa ${destino}`);
        if (capa === 'middleware' && capaDestino === 'aws') problemas.push(`${rel(archivo)}: middleware/ importa ${destino}`);
        if (capa === 'aws' && capaDestino === 'functions' && !PERMITIDAS.includes(destino)) {
            problemas.push(`${rel(archivo)}: aws/ importa ${destino}`);
        }
    }
    return problemas;
};

const archivosJs = (carpeta) => fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return archivosJs(ruta);
    return /\.(?:js|cjs|mjs)$/.test(entrada.name) ? [ruta] : [];
});

describe('capas reales: aws/, functions/ y middleware/', () => {
    const aws = archivosJs(path.join(ROOT, 'aws'));
    const functions = archivosJs(path.join(ROOT, 'functions'));
    const middleware = archivosJs(path.join(ROOT, 'middleware'));

    test('se recorren archivos de las tres carpetas', () => {
        assert.ok(aws.length > 0, 'aws/ sin archivos');
        assert.ok(functions.length > 0, 'functions/ sin archivos');
        assert.ok(middleware.length > 0, 'middleware/ sin archivos');
    });
    for (const archivo of [...aws, ...functions, ...middleware]) {
        test(`${rel(archivo)} respeta la dirección de las dependencias`, () => {
            assert.deepEqual(problemasDe(archivo, fs.readFileSync(archivo, 'utf8')), []);
        });
    }
});

describe('detector de importaciones (fuentes en cadena)', () => {
    const enAws = path.join(ROOT, 'aws', 'x.js');
    const enFunctions = path.join(ROOT, 'functions', 'x.js');
    const enMiddleware = path.join(ROOT, 'middleware', 'x.js');

    test('comilla simple', () => {
        assert.deepEqual(importacionesDe("const a = require('../functions/foo');"), [{ spec: '../functions/foo' }]);
    });
    test('comilla doble', () => {
        assert.deepEqual(importacionesDe('const a = require("../functions/foo");'), [{ spec: '../functions/foo' }]);
    });
    test('plantilla sin interpolación', () => {
        assert.deepEqual(importacionesDe('const a = require(`../functions/foo`);'), [{ spec: '../functions/foo' }]);
    });
    test('salto de línea tras el paréntesis', () => {
        assert.deepEqual(importacionesDe("const a = require(\n    '../functions/foo'\n);"), [{ spec: '../functions/foo' }]);
    });
    test('require.resolve', () => {
        assert.deepEqual(importacionesDe("const r = require.resolve('../aws/awsS3connect');"), [{ spec: '../aws/awsS3connect' }]);
    });
    test('import dinámico', () => {
        assert.deepEqual(importacionesDe("const m = await import('../aws/awsS3connect');"), [{ spec: '../aws/awsS3connect' }]);
    });
    test('argumento variable: no literal', () => {
        assert.deepEqual(importacionesDe('const a = require(nombre);'), [{ dinamico: true }]);
    });
    test('plantilla con interpolación: no literal', () => {
        assert.deepEqual(importacionesDe('const a = require(`../functions/${nombre}`);'), [{ dinamico: true }]);
    });
    test('concatenación: no literal', () => {
        assert.deepEqual(importacionesDe("const a = require('../functions/' + nombre);"), [{ dinamico: true }]);
    });
    test('un paquete externo se ignora', () => {
        assert.deepEqual(problemasDe(enAws, "const x = require('express');\nconst y = require('node:path');"), []);
    });
    test('relativo a config/ permitido desde aws/ y desde functions/', () => {
        assert.deepEqual(problemasDe(enAws, "require('../config/s3Paths');"), []);
        assert.deepEqual(problemasDe(enFunctions, "require('../config/s3Paths');"), []);
    });
    test('relativo dentro de la propia capa permitido', () => {
        assert.deepEqual(problemasDe(enFunctions, "require('./versionName');"), []);
        assert.deepEqual(problemasDe(enAws, "require('./otro');"), []);
    });
    test('aws/ importando functions/ falla (PERMITIDAS vacía)', () => {
        assert.equal(PERMITIDAS.length, 0);
        assert.equal(problemasDe(enAws, "require('../functions/convertExcelToJson');").length, 1);
    });
    test('functions/ importando aws/ falla', () => {
        assert.equal(problemasDe(enFunctions, "require('../aws/awsS3connect');").length, 1);
    });
    test('un camino con .. que acaba en aws/ falla', () => {
        assert.equal(problemasDe(enFunctions, "require('../functions/../aws/awsS3connect');").length, 1);
        assert.equal(problemasDe(path.join(ROOT, 'functions', 'sub', 'y.js'), "require('../../aws/awsS3connect');").length, 1);
    });
    test('una importación no literal falla explícitamente', () => {
        const problemas = problemasDe(enFunctions, 'const a = require(nombre);');
        assert.equal(problemas.length, 1);
        assert.match(problemas[0], /no literal/);
    });
    test('middleware/ importando aws/ falla', () => {
        assert.equal(problemasDe(enMiddleware, "require('../aws/awsS3connect');").length, 1);
    });
    test('middleware/: un camino con .. que acaba en aws/ falla', () => {
        assert.equal(problemasDe(enMiddleware, "require('../middleware/../aws/awsS3connect');").length, 1);
    });
    test('middleware/ puede importar config/ y su propia capa', () => {
        assert.deepEqual(problemasDe(enMiddleware, "require('../config/s3Paths');"), []);
        assert.deepEqual(problemasDe(enMiddleware, "require('./errorHandler');"), []);
    });
    test('middleware/: una importación no literal falla explícitamente', () => {
        const problemas = problemasDe(enMiddleware, 'const a = require(nombre);');
        assert.equal(problemas.length, 1);
        assert.match(problemas[0], /no literal/);
    });
    test('varias importaciones en un archivo se detectan todas', () => {
        const fuente = "const a = require('../aws/a');\nconst b = require('express');\nconst c = require('../aws/c');";
        assert.equal(problemasDe(enFunctions, fuente).length, 2);
    });
});
