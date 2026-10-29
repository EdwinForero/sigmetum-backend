require('./helpers/entorno');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const INDEX = require.resolve(path.join(RAIZ, 'index.js'));
const DOTENV = require.resolve('dotenv');
const VALIDATE_ENV = require.resolve(path.join(RAIZ, 'config', 'validateEnv.js'));
const APP = require.resolve(path.join(RAIZ, 'app.js'));

function simulado(file, exports) {
    return { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

// Carga el index.js REAL con dotenv, validateEnv y app sustituidos por dobles que anotan el orden de las llamadas.
// process.on se intercepta (no se registra ningún handler real) y la caché de módulos se restaura al terminar.
function cargarIndex(t, { validateEnv, port, eventos = [] } = {}) {
    const puertos = [];
    const original = process.on;
    t.mock.method(process, 'on', function (evento, ...resto) {
        if (evento === 'uncaughtException' || evento === 'unhandledRejection') {
            eventos.push(`on:${evento}`);
            return process;
        }
        return original.call(process, evento, ...resto);
    });
    const antes = new Map([INDEX, DOTENV, VALIDATE_ENV, APP].map((f) => [f, require.cache[f]]));
    const portAnterior = process.env.PORT;
    if (port === undefined) delete process.env.PORT; else process.env.PORT = port;
    t.after(() => {
        for (const [f, m] of antes) {
            if (m) require.cache[f] = m; else delete require.cache[f];
        }
        if (portAnterior === undefined) delete process.env.PORT; else process.env.PORT = portAnterior;
    });

    require.cache[DOTENV] = simulado(DOTENV, { config: () => { eventos.push('dotenv'); } });
    require.cache[VALIDATE_ENV] = simulado(VALIDATE_ENV, validateEnv || (() => { eventos.push('validateEnv'); }));
    // el doble de app se registra en la caché como módulo ya cargado; para anotar su carga se usa un getter
    delete require.cache[APP];
    Object.defineProperty(require.cache, APP, {
        configurable: true,
        enumerable: true,
        get() {
            eventos.push('app');
            return simulado(APP, { listen: (p, cb) => { puertos.push(p); eventos.push('listen'); if (cb) cb(); } });
        },
    });
    delete require.cache[INDEX];
    t.mock.method(console, 'log', () => {});
    try {
        require(INDEX);
    } finally {
        delete require.cache[APP];
    }
    return { eventos, puertos };
}

test('index.js ejecuta validateEnv() antes de cargar ./app', (t) => {
    const { eventos } = cargarIndex(t);
    assert.ok(eventos.includes('validateEnv'), 'no se llamó a validateEnv');
    assert.ok(eventos.includes('app'), 'no se cargó ./app');
    assert.ok(eventos.indexOf('validateEnv') < eventos.indexOf('app'), `orden: ${eventos.join(' > ')}`);
});

test('index.js registra uncaughtException y unhandledRejection antes de cargar ./app y validateEnv', (t) => {
    const { eventos } = cargarIndex(t);
    for (const evento of ['on:uncaughtException', 'on:unhandledRejection']) {
        assert.equal(eventos.filter((e) => e === evento).length, 1, `${evento} debe registrarse una vez`);
        assert.ok(eventos.indexOf(evento) < eventos.indexOf('validateEnv'), `${evento} después de validateEnv: ${eventos.join(' > ')}`);
        assert.ok(eventos.indexOf(evento) < eventos.indexOf('app'), `${evento} después de ./app: ${eventos.join(' > ')}`);
    }
});

test('index.js llama a app.listen con el puerto 8000 por defecto', (t) => {
    const { puertos, eventos } = cargarIndex(t);
    assert.deepEqual(puertos, [8000]);
    assert.ok(eventos.indexOf('app') < eventos.indexOf('listen'));
});

test('index.js llama a app.listen con el puerto de la variable PORT', (t) => {
    const { puertos } = cargarIndex(t, { port: '3456' });
    assert.deepEqual(puertos, ['3456']);
});

test('si validateEnv() lanza, index.js no carga ./app ni escucha', (t) => {
    const eventos = [];
    const fallo = () => { eventos.push('validateEnv'); throw new Error('variables sin definir'); };
    assert.throws(() => cargarIndex(t, { validateEnv: fallo, eventos }), /variables sin definir/);
    assert.ok(eventos.includes('validateEnv'));
    assert.ok(!eventos.includes('app'), `se cargó ./app: ${eventos.join(' > ')}`);
    assert.ok(!eventos.includes('listen'));
});
