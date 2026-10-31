// M15: validateEnv comprueba también el VALOR de ADMIN_PASSWORD, JWT_SECRET y JWT_EXPIRATION.
// Política: solo NODE_ENV 'local' o 'test' avisan (console.warn); en cualquier otro caso lanza.
require('./helpers/entorno');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const validateEnv = require('../config/validateEnv');

const HASH = bcrypt.hashSync('x', 4);
const SECRET_OK = 'a'.repeat(32);
const CENTINELA = 'CENTINELA-XYZ';

let guardado;
beforeEach(() => {
    guardado = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_PASSWORD = HASH;
    process.env.JWT_SECRET = SECRET_OK;
    process.env.JWT_EXPIRATION = '8h';
});
afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in guardado)) delete process.env[key];
    Object.assign(process.env, guardado);
});

const conWarn = (t) => t.mock.method(console, 'warn', () => {});
const textoWarn = (mock) => mock.mock.calls.map((c) => c.arguments.join(' ')).join('\n');

describe('M15: política por NODE_ENV', () => {
    for (const env of [undefined, 'production', 'staging']) {
        test(`NODE_ENV=${env} lanza con un valor inválido`, (t) => {
            conWarn(t);
            if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
            process.env.JWT_SECRET = 'corto';
            assert.throws(() => validateEnv(), /JWT_SECRET/);
        });
    }
    test('NODE_ENV=local no lanza y avisa nombrando la variable y la regla', (t) => {
        const w = conWarn(t);
        process.env.NODE_ENV = 'local';
        process.env.AWS_PROFILE = 'perfil-de-prueba';
        process.env.JWT_SECRET = 'corto';
        assert.doesNotThrow(() => validateEnv());
        assert.match(textoWarn(w), /JWT_SECRET: debe tener al menos 32 caracteres/);
    });
    test('NODE_ENV=test no lanza y avisa', (t) => {
        const w = conWarn(t);
        process.env.JWT_EXPIRATION = 'abc';
        assert.doesNotThrow(() => validateEnv());
        assert.match(textoWarn(w), /JWT_EXPIRATION/);
    });
    test('con todo válido no se llama a console.warn', (t) => {
        const w = conWarn(t);
        validateEnv();
        assert.equal(w.mock.callCount(), 0);
    });
});

describe('M15: reglas de valor (con NODE_ENV=production)', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    test('todo válido no lanza', () => assert.doesNotThrow(() => validateEnv()));

    for (const [nombre, valor] of [['texto plano', 'no-es-un-hash'], ['hash truncado', HASH.slice(0, 40)]]) {
        test(`ADMIN_PASSWORD ${nombre} lanza`, () => {
            process.env.ADMIN_PASSWORD = valor;
            assert.throws(() => validateEnv(), /ADMIN_PASSWORD/);
        });
    }

    test('JWT_SECRET de 31 falla y de 32 pasa', () => {
        process.env.JWT_SECRET = 'a'.repeat(31);
        assert.throws(() => validateEnv(), /JWT_SECRET/);
        process.env.JWT_SECRET = 'a'.repeat(32);
        assert.doesNotThrow(() => validateEnv());
    });

    for (const v of ['8h', '10m', '1d', '8H', '1 day', '1.5h']) {
        test(`JWT_EXPIRATION válido ${JSON.stringify(v)}`, () => {
            process.env.JWT_EXPIRATION = v;
            assert.doesNotThrow(() => validateEnv());
        });
    }
    for (const v of ['3600', '0', '-1', '-5m', '0h', '10m ', 'abc']) {
        test(`JWT_EXPIRATION inválido ${JSON.stringify(v)}`, () => {
            process.env.JWT_EXPIRATION = v;
            assert.throws(() => validateEnv(), /JWT_EXPIRATION/);
        });
    }

    test("JWT_EXPIRATION '' cuenta como ausente (mensaje existente)", () => {
        process.env.JWT_EXPIRATION = '';
        assert.throws(() => validateEnv(), /Variables de entorno requeridas no definidas: JWT_EXPIRATION/);
    });
});

describe('M15: los valores no se filtran', () => {
    test('ni error.message ni console.warn contienen el valor', (t) => {
        const w = conWarn(t);
        process.env.JWT_SECRET = CENTINELA;
        process.env.ADMIN_PASSWORD = CENTINELA;
        process.env.JWT_EXPIRATION = CENTINELA;
        validateEnv();
        assert.ok(!textoWarn(w).includes(CENTINELA));
        assert.ok(w.mock.callCount() > 0);
        process.env.NODE_ENV = 'production';
        try {
            validateEnv();
            assert.fail('debía lanzar');
        } catch (error) {
            assert.ok(!error.message.includes(CENTINELA));
            assert.match(error.message, /JWT_SECRET/);
        }
    });
});

describe('M12: TRUST_PROXY_HOPS', () => {
    const INVALIDOS = ['0', '', 'true', 'false', '-1', '1.5', '6', 'abc', '1,2', '10.0.0.1', '10.0.0.0/8', ' 1 ', CENTINELA];
    // undefined = sin NODE_ENV; 'Production', 'LOCAL', ' local' y 'test ' son estrictos (comparación exacta).
    const ESTRICTOS = ['production', 'staging', undefined, 'Production', 'LOCAL', ' local', 'test '];
    beforeEach(() => { process.env.AWS_PROFILE = 'perfil-de-prueba'; });
    const fijarEntorno = (env) => { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; };

    for (const env of ESTRICTOS) {
        for (const valor of INVALIDOS) {
            test(`NODE_ENV=${env}: ${JSON.stringify(valor)} lanza nombrando la variable y sin el valor`, (t) => {
                conWarn(t);
                fijarEntorno(env);
                process.env.TRUST_PROXY_HOPS = valor;
                assert.throws(() => validateEnv(), (error) => {
                    assert.match(error.message, /TRUST_PROXY_HOPS/);
                    if (valor.trim().length > 2) assert.ok(!error.message.includes(valor));
                    assert.ok(!error.message.includes(CENTINELA));
                    return true;
                });
            });
        }
    }
    for (const env of ['production', 'test']) {
        for (const valor of [undefined, '1', '2', '3', '4', '5']) {
            test(`NODE_ENV=${env}: ${valor === undefined ? 'sin definir' : `'${valor}'`} no lanza ni avisa`, (t) => {
                const w = conWarn(t);
                process.env.NODE_ENV = env;
                if (valor === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = valor;
                assert.doesNotThrow(() => validateEnv());
                assert.equal(w.mock.callCount(), 0);
            });
        }
    }
    for (const env of ['local', 'test']) {
        for (const valor of INVALIDOS.filter((v) => v !== '0')) {
            test(`NODE_ENV=${env}: ${JSON.stringify(valor)} no lanza y avisa con la variable y la regla, sin el valor`, (t) => {
                const w = conWarn(t);
                process.env.NODE_ENV = env;
                process.env.TRUST_PROXY_HOPS = valor;
                assert.doesNotThrow(() => validateEnv());
                assert.match(textoWarn(w), /TRUST_PROXY_HOPS: debe ser un entero de 0 a 5/);
                assert.ok(!textoWarn(w).includes(CENTINELA));
            });
        }
        test(`NODE_ENV=${env}: '0' no lanza y no avisa`, (t) => {
            const w = conWarn(t);
            process.env.NODE_ENV = env;
            process.env.TRUST_PROXY_HOPS = '0';
            assert.doesNotThrow(() => validateEnv());
            assert.equal(w.mock.callCount(), 0);
        });
    }
    test('M15 y M12 a la vez en production: el error menciona ambas variables', () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'corto';
        process.env.TRUST_PROXY_HOPS = '6';
        assert.throws(() => validateEnv(), /JWT_SECRET.*TRUST_PROXY_HOPS/);
    });
});
