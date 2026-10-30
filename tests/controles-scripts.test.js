// Controles de scripts/ (M24): docs-check falla si index.js declara rutas (routesInIndex) y quality-check no deja procesos
// huérfanos al agotar el tiempo máximo (runWithTimeout, paso siguiente). scripts/lib/repo.mjs es ESM: se importa dentro de los tests.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const cargarRepo = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'repo.mjs')).href);

describe('routesInIndex: index.js no declara rutas', () => {
    test('el index.js real no declara rutas', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.deepEqual(routesInIndex(fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')), []);
    });
    test('app.get( se detecta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.equal(routesInIndex("app.get('/x', h);").length, 1);
    });
    test('app.use( con ruta se detecta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.equal(routesInIndex("app.use('/x', r);").length, 1);
    });
    test('router.post( se detecta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.equal(routesInIndex("router.post('/y', h);").length, 1);
    });
    test('con sangría y entre otras líneas se detecta solo la ruta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.equal(routesInIndex("const a = 1;\n    app.delete('/z', h);\nconst b = 2;").length, 1);
    });
    test('app.listen no es una ruta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.deepEqual(routesInIndex('app.listen(PORT, () => {});'), []);
    });
    test('un comentario que menciona app.get( no cuenta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.deepEqual(routesInIndex("// app.get('/x', h) no va aquí"), []);
    });
    test('una línea con app.get( que no está al inicio no cuenta', async () => {
        const { routesInIndex } = await cargarRepo();
        assert.deepEqual(routesInIndex("const t = 'app.get(';"), []);
    });
});

// runWithTimeout: al agotar el tiempo máximo mata el ÁRBOL de procesos (no solo el shell) y resuelve sin esperar a "close".
// Los scripts simulados se escriben en un directorio temporal del sistema; el nieto de larga vida se crea desde ese script
// (el test no usa child_process: la regla n/no-restricted-require aplica también a tests/).
const os = require('node:os');

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const vivo = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
};
// Espera (con reintentos) a que el proceso deje de existir; devuelve si murió dentro del margen.
const murio = async (pid, margenMs = 8000) => {
    const limite = Date.now() + margenMs;
    while (Date.now() < limite) {
        if (!vivo(pid)) return true;
        await dormir(100);
    }
    return !vivo(pid);
};
const pidDe = (stdout, etiqueta) => {
    const linea = stdout.split('\n').find((l) => l.startsWith(`${etiqueta}=`));
    const pid = linea ? Number.parseInt(linea.slice(etiqueta.length + 1), 10) : NaN;
    return Number.isInteger(pid) ? pid : null;
};

describe('runWithTimeout: sin procesos huérfanos', () => {
    let carpeta;
    const escribir = (nombre, contenido) => {
        const ruta = path.join(carpeta, nombre);
        fs.writeFileSync(ruta, contenido);
        return ruta;
    };
    const limpiar = (pids) => {
        for (const pid of pids) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                /* ya terminado */
            }
        }
    };

    test('al vencer el tiempo no queda vivo el nieto del subproceso', async () => {
        carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmetum-rwt-'));
        const script = escribir('con-nieto.js', [
            "const { spawn } = require('node:child_process');",
            "const nieto = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
            "console.log('NIETO=' + nieto.pid);",
            'setInterval(() => {}, 1000);',
        ].join('\n'));
        const { runWithTimeout } = await cargarRepo();
        let nieto = null;
        try {
            const inicio = Date.now();
            const res = await runWithTimeout('node', [`"${script}"`], { timeout: 4000 });
            assert.ok(Date.now() - inicio < 15000, 'no resolvió poco después del tiempo máximo');
            assert.equal(res.error?.code, 'ETIMEDOUT');
            assert.equal(res.status, null);
            nieto = pidDe(res.stdout, 'NIETO');
            assert.ok(nieto, `el script simulado no llegó a imprimir el pid del nieto: ${res.stdout}`);
            assert.equal(await murio(nieto), true, 'el nieto sigue vivo tras agotar el tiempo máximo (proceso huérfano)');
        } finally {
            limpiar([nieto].filter(Boolean));
            fs.rmSync(carpeta, { recursive: true, force: true });
        }
    });

    test('un comando rápido devuelve status 0 y su stdout, sin error', async () => {
        carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmetum-rwt-'));
        try {
            const script = escribir('rapido.js', "console.log('hola');");
            const { runWithTimeout } = await cargarRepo();
            const res = await runWithTimeout('node', [`"${script}"`], { timeout: 20000 });
            assert.equal(res.status, 0);
            assert.match(res.stdout, /hola/);
            assert.equal(res.error, undefined);
        } finally {
            fs.rmSync(carpeta, { recursive: true, force: true });
        }
    });

    test('un código de salida distinto de 0 se devuelve como status', async () => {
        carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmetum-rwt-'));
        try {
            const script = escribir('falla.js', 'process.exit(3);');
            const { runWithTimeout } = await cargarRepo();
            const res = await runWithTimeout('node', [`"${script}"`], { timeout: 20000 });
            assert.equal(res.status, 3);
            assert.equal(res.error, undefined);
        } finally {
            fs.rmSync(carpeta, { recursive: true, force: true });
        }
    });

    test('un comando que no existe resuelve con status distinto de 0 o con error, sin colgarse', async () => {
        const { runWithTimeout } = await cargarRepo();
        const res = await runWithTimeout('sigmetum-comando-inexistente-xyz', [], { timeout: 20000 });
        assert.ok(res.status !== 0 || res.error, 'un comando inexistente no puede parecer correcto');
        assert.notEqual(res.error?.code, 'ETIMEDOUT');
    });

    test('al superar maxBuffer mata el árbol y resuelve con ENOBUFS', async () => {
        carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmetum-rwt-'));
        let pid = null;
        try {
            const script = escribir('ruidoso.js', [
                "console.log('PROC=' + process.pid);",
                "setInterval(() => process.stdout.write('x'.repeat(1000) + '\\n'), 5);",
            ].join('\n'));
            const { runWithTimeout } = await cargarRepo();
            const res = await runWithTimeout('node', [`"${script}"`], { timeout: 30000, maxBuffer: 20000 });
            assert.equal(res.error?.code, 'ENOBUFS');
            assert.equal(res.status, null);
            pid = pidDe(res.stdout, 'PROC');
            assert.ok(pid, 'el script simulado no imprimió su pid');
            assert.equal(await murio(pid), true, 'el proceso sigue vivo tras superar maxBuffer');
        } finally {
            limpiar([pid].filter(Boolean));
            fs.rmSync(carpeta, { recursive: true, force: true });
        }
    });
});
