// Cognito: validateEnv exige COGNITO_USER_POOL_ID en TODO entorno (también local y test), con la forma <región>_<id>
// de la propia librería aws-jwt-verify y la región igual a AWS_REGION. Un pool inválido siempre lanza; la rama
// indulgente (NODE_ENV 'local' o 'test' avisan con console.warn) solo afecta a TRUST_PROXY_HOPS (M12).
require('./helpers/entorno');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const validateEnv = require('../config/validateEnv');

const CENTINELA = 'CENTINELA-XYZ';
const POOL_OK = 'us-east-1_TestPool1';
const CLAVES_ANTIGUAS = ['JWT_SECRET', 'JWT_EXPIRATION', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
// undefined = sin NODE_ENV; 'Production', 'LOCAL', ' local' y 'test ' son estrictos (comparación exacta).
const TODOS_LOS_ENTORNOS = [undefined, 'production', 'staging', 'local', 'test'];

let guardado;
beforeEach(() => {
    guardado = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.AWS_REGION = 'us-east-1';
    process.env.COGNITO_USER_POOL_ID = POOL_OK;
    for (const clave of CLAVES_ANTIGUAS) delete process.env[clave];
});
afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in guardado)) delete process.env[key];
    Object.assign(process.env, guardado);
});

const conWarn = (t) => t.mock.method(console, 'warn', () => {});
const textoWarn = (mock) => mock.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
const fijarEntorno = (env) => {
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    if (env === 'local') process.env.AWS_PROFILE = 'perfil-de-prueba';
};

describe('Cognito: COGNITO_USER_POOL_ID ausente', () => {
    for (const env of TODOS_LOS_ENTORNOS) {
        for (const ausente of [undefined, '']) {
            test(`NODE_ENV=${env}: ${ausente === undefined ? 'sin definir' : "''"} lanza con el mensaje de variables requeridas`, (t) => {
                conWarn(t);
                fijarEntorno(env);
                if (ausente === undefined) delete process.env.COGNITO_USER_POOL_ID; else process.env.COGNITO_USER_POOL_ID = ausente;
                assert.throws(() => validateEnv(), /Variables de entorno requeridas no definidas: COGNITO_USER_POOL_ID/);
            });
        }
    }
});

describe('Cognito: COGNITO_USER_POOL_ID malformado', () => {
    const MALFORMADOS = [
        'us-east-1', '_abc', 'us-east-1_', 'us-east-1_a b', 'US-EAST-1_abc', 'us-east-1_abc_def', '../x', CENTINELA,
        // Un solo dígito de región: la librería rechaza us-east-10_abc.
        'us-east-10_abc',
    ];
    for (const env of TODOS_LOS_ENTORNOS) {
        for (const valor of MALFORMADOS) {
            test(`NODE_ENV=${env}: ${JSON.stringify(valor)} lanza (también en local y test) con la variable y la regla, sin el valor`, (t) => {
                const w = conWarn(t);
                fijarEntorno(env);
                process.env.COGNITO_USER_POOL_ID = valor;
                assert.throws(() => validateEnv(), (error) => {
                    assert.match(error.message, /Variables de entorno con valor no válido: COGNITO_USER_POOL_ID: debe tener la forma <región>_<identificador>/);
                    if (valor.length > 2) assert.ok(!error.message.includes(valor));
                    assert.ok(!error.message.includes(CENTINELA));
                    return true;
                });
                assert.equal(w.mock.callCount(), 0, 'no avisa en lugar de lanzar');
            });
        }
    }
});

describe('Cognito: región del pool distinta de AWS_REGION', () => {
    for (const env of TODOS_LOS_ENTORNOS) {
        test(`NODE_ENV=${env}: lanza con el mensaje de región, sin los valores`, (t) => {
            const w = conWarn(t);
            fijarEntorno(env);
            process.env.AWS_REGION = 'eu-west-1';
            assert.throws(() => validateEnv(), (error) => {
                assert.match(error.message, /COGNITO_USER_POOL_ID: la región del pool debe coincidir con AWS_REGION/);
                assert.ok(!error.message.includes(POOL_OK));
                assert.ok(!error.message.includes('eu-west-1'));
                return true;
            });
            assert.equal(w.mock.callCount(), 0);
        });
    }
});

describe('Cognito: COGNITO_USER_POOL_ID válido', () => {
    const VALIDOS = [
        ['us-east-1_TestPool1', 'us-east-1'],
        ['eu-west-1_AbC123', 'eu-west-1'],
        ['us-gov-west-1_abc', 'us-gov-west-1'],
        ['eusc-de-east-1_abc', 'eusc-de-east-1'],
    ];
    for (const env of TODOS_LOS_ENTORNOS) {
        for (const [pool, region] of VALIDOS) {
            test(`NODE_ENV=${env}: ${pool} con AWS_REGION=${region} no lanza ni avisa`, (t) => {
                const w = conWarn(t);
                fijarEntorno(env);
                process.env.AWS_REGION = region;
                process.env.COGNITO_USER_POOL_ID = pool;
                assert.doesNotThrow(() => validateEnv());
                assert.equal(w.mock.callCount(), 0);
            });
        }
    }
});

describe('Cognito: las cuatro claves del login antiguo ya no se exigen ni se validan', () => {
    for (const env of ['production', 'staging', undefined, 'local', 'test']) {
        test(`NODE_ENV=${env}: con las cuatro ausentes no lanza ni avisa`, (t) => {
            const w = conWarn(t);
            fijarEntorno(env);
            for (const clave of CLAVES_ANTIGUAS) assert.equal(process.env[clave], undefined);
            assert.doesNotThrow(() => validateEnv());
            assert.equal(w.mock.callCount(), 0);
        });
        test(`NODE_ENV=${env}: con las cuatro presentes y con valores inválidos (caso de prod) no lanza ni avisa`, (t) => {
            const w = conWarn(t);
            fijarEntorno(env);
            process.env.JWT_SECRET = 'corto';
            process.env.JWT_EXPIRATION = 'abc';
            process.env.ADMIN_USERNAME = CENTINELA;
            process.env.ADMIN_PASSWORD = 'no-es-un-hash';
            assert.doesNotThrow(() => validateEnv());
            assert.equal(w.mock.callCount(), 0);
        });
    }
});

describe('Política por NODE_ENV (TRUST_PROXY_HOPS)', () => {
    for (const env of [undefined, 'production', 'staging']) {
        test(`NODE_ENV=${env} lanza con un valor inválido`, (t) => {
            conWarn(t);
            fijarEntorno(env);
            process.env.TRUST_PROXY_HOPS = '6';
            assert.throws(() => validateEnv(), /TRUST_PROXY_HOPS/);
        });
    }
    test('NODE_ENV=local no lanza y avisa nombrando la variable y la regla', (t) => {
        const w = conWarn(t);
        fijarEntorno('local');
        process.env.TRUST_PROXY_HOPS = '6';
        assert.doesNotThrow(() => validateEnv());
        assert.match(textoWarn(w), /TRUST_PROXY_HOPS: debe ser un entero de 0 a 5/);
    });
    test('NODE_ENV=test no lanza y avisa', (t) => {
        const w = conWarn(t);
        process.env.TRUST_PROXY_HOPS = 'abc';
        assert.doesNotThrow(() => validateEnv());
        assert.match(textoWarn(w), /TRUST_PROXY_HOPS/);
    });
    test('con todo válido no se llama a console.warn', (t) => {
        const w = conWarn(t);
        validateEnv();
        assert.equal(w.mock.callCount(), 0);
    });
});

describe('Los valores no se filtran', () => {
    test('ni error.message ni console.warn contienen el valor', (t) => {
        const w = conWarn(t);
        process.env.TRUST_PROXY_HOPS = CENTINELA;
        validateEnv();
        assert.ok(!textoWarn(w).includes(CENTINELA));
        assert.ok(w.mock.callCount() > 0);
        process.env.NODE_ENV = 'production';
        assert.throws(() => validateEnv(), (error) => {
            assert.ok(!error.message.includes(CENTINELA));
            assert.match(error.message, /TRUST_PROXY_HOPS/);
            return true;
        });
    });
});

describe('M12: TRUST_PROXY_HOPS', () => {
    const INVALIDOS = ['0', '', 'true', 'false', '-1', '1.5', '6', 'abc', '1,2', '10.0.0.1', '10.0.0.0/8', ' 1 ', CENTINELA];
    // undefined = sin NODE_ENV; 'Production', 'LOCAL', ' local' y 'test ' son estrictos (comparación exacta).
    const ESTRICTOS = ['production', 'staging', undefined, 'Production', 'LOCAL', ' local', 'test '];
    beforeEach(() => { process.env.AWS_PROFILE = 'perfil-de-prueba'; });

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
    test('pool malformado y M12 a la vez en production: el error menciona ambas variables', () => {
        process.env.NODE_ENV = 'production';
        process.env.COGNITO_USER_POOL_ID = 'malformado';
        process.env.TRUST_PROXY_HOPS = '6';
        assert.throws(() => validateEnv(), /COGNITO_USER_POOL_ID.*TRUST_PROXY_HOPS/);
    });
    test('pool malformado con TRUST_PROXY_HOPS inválida en local: lanza (el pool nunca se relaja)', (t) => {
        conWarn(t);
        process.env.NODE_ENV = 'local';
        process.env.COGNITO_USER_POOL_ID = 'malformado';
        process.env.TRUST_PROXY_HOPS = '6';
        assert.throws(() => validateEnv(), /COGNITO_USER_POOL_ID.*TRUST_PROXY_HOPS/);
    });
});
