// M12: TRUST_PROXY_HOPS. Parte 1: reglas de config/trustProxy.js (se fija process.env, como validate-env.test.js).
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva } = require('./helpers/simulados');
const express = require('express');
const request = require('supertest');
const { resolveTrustProxyHops, LENIENT_ENVS } = require('../config/trustProxy');

const CENTINELA = 'CENTINELA-XYZ';
const INVALIDOS = ['', 'true', 'false', '-1', '1.5', '6', 'abc', '1,2', '10.0.0.1', '10.0.0.0/8', ' 1', '1 ', '01', '1\n', CENTINELA];
const PERMISIVOS = ['local', 'test'];
// undefined = sin NODE_ENV; 'Production', 'LOCAL', ' local' y 'test ' son estrictos (comparación exacta).
const ESTRICTOS = ['production', 'staging', undefined, 'Production', 'LOCAL', ' local', 'test '];

let guardado;
beforeEach(() => {
    guardado = { ...process.env };
    delete process.env.TRUST_PROXY_HOPS;
    process.env.NODE_ENV = 'test';
});
afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in guardado)) delete process.env[key];
    Object.assign(process.env, guardado);
});

const fijar = (nodeEnv, hops) => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
    if (hops === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = hops;
};

describe('M12: resolveTrustProxyHops', () => {
    test('LENIENT_ENVS son local y test', () => {
        assert.deepEqual(LENIENT_ENVS, ['local', 'test']);
    });
    for (const env of [...ESTRICTOS, ...PERMISIVOS]) {
        test(`NODE_ENV=${env}: sin variable vale 1 y sin problema`, () => {
            fijar(env, undefined);
            assert.deepEqual(resolveTrustProxyHops(), { value: 1, problem: null });
        });
        for (const n of [1, 2, 3, 4, 5]) {
            test(`NODE_ENV=${env}: '${n}' es válido`, () => {
                fijar(env, String(n));
                assert.deepEqual(resolveTrustProxyHops(), { value: n, problem: null });
            });
        }
    }
    for (const env of PERMISIVOS) {
        test(`NODE_ENV=${env}: '0' es válido y se aplica`, () => {
            fijar(env, '0');
            assert.deepEqual(resolveTrustProxyHops(), { value: 0, problem: null });
        });
    }
    for (const env of ESTRICTOS) {
        test(`NODE_ENV=${env}: '0' da problema y valor 1`, () => {
            fijar(env, '0');
            const r = resolveTrustProxyHops();
            assert.equal(r.value, 1);
            assert.match(r.problem, /^TRUST_PROXY_HOPS:/);
        });
    }
    for (const env of [...ESTRICTOS, ...PERMISIVOS]) {
        for (const valor of INVALIDOS) {
            test(`NODE_ENV=${env}: ${JSON.stringify(valor)} da problema, valor 1 y el mensaje no lleva el valor`, () => {
                fijar(env, valor);
                const r = resolveTrustProxyHops();
                assert.equal(r.value, 1);
                assert.match(r.problem, /^TRUST_PROXY_HOPS:/);
                assert.ok(!r.problem.includes(CENTINELA));
            });
        }
    }
    test('el valor devuelto es siempre un número entre 0 y 5 (nunca true, string ni mayor que 5)', () => {
        for (const env of [...ESTRICTOS, ...PERMISIVOS]) {
            for (const valor of [undefined, '0', '1', '2', '3', '4', '5', ...INVALIDOS]) {
                fijar(env, valor);
                const { value } = resolveTrustProxyHops();
                assert.equal(typeof value, 'number');
                assert.ok(Number.isInteger(value) && value >= 0 && value <= 5);
            }
        }
    });
});

// Parte 2: app.js real. IPs de documentación (TEST-NET), nunca de infra.
const XFF = '203.0.113.7, 198.51.100.2, 192.0.2.9';
const CLIENTE = '203.0.113.7';
const LOGIN = { username: 'nadie', password: 'x' };
const MAIL = { username: 'Ana', email: 'ana@example.com', subject: 'Consulta', message: 'Hola, tengo una pregunta.' };

const appCon = (hops, nodeEnv = 'test') => {
    fijar(nodeEnv, hops);
    return appNueva();
};

// La sonda express() solo prueba la semántica de Express para el número; los contadores con la app real
// (más abajo) cubren el vínculo app.js -> limitador.
const ipDe = async (hops, xff) => {
    const sonda = express();
    sonda.set('trust proxy', hops);
    sonda.get('/ip', (req, res) => res.send(req.ip));
    const req = request(sonda).get('/ip');
    const res = xff === undefined ? await req : await req.set('X-Forwarded-For', xff);
    return res.text;
};

const post = (app, url, body, xff) => {
    const req = request(app).post(url).send(body);
    return xff === undefined ? req : req.set('X-Forwarded-For', xff);
};

describe('M12: app.js aplica TRUST_PROXY_HOPS', () => {
    test('sin variable vale 1 (sin cambio de comportamiento)', () => {
        assert.equal(appCon(undefined).get('trust proxy'), 1);
    });
    for (const n of [0, 1, 2, 5]) {
        test(`'${n}' en NODE_ENV=test vale ${n}`, () => {
            assert.equal(appCon(String(n)).get('trust proxy'), n);
        });
    }
    test("'0' con NODE_ENV=production da 1", () => {
        assert.equal(appCon('0', 'production').get('trust proxy'), 1);
    });
    for (const valor of ['abc', '', 'true', '6']) {
        test(`valor inválido ${JSON.stringify(valor)} en NODE_ENV=test da 1`, () => {
            assert.equal(appCon(valor).get('trust proxy'), 1);
        });
    }
});

describe('M12: req.ip según los saltos (X-Forwarded-For de varios elementos)', () => {
    const esperado = { 1: '192.0.2.9', 2: '198.51.100.2', 3: '203.0.113.7', 5: '203.0.113.7' };
    for (const [hops, ip] of Object.entries(esperado)) {
        test(`hops ${hops}: req.ip es ${ip}`, async () => {
            assert.equal(await ipDe(appCon(String(hops)).get('trust proxy'), XFF), ip);
        });
    }
    test('hops 0: se ignora la cabecera y req.ip es la dirección del socket', async () => {
        const hops = appCon('0').get('trust proxy');
        assert.equal(hops, 0);
        const sinCabecera = await ipDe(hops, undefined);
        assert.equal(await ipDe(hops, XFF), sinCabecera);
        assert.ok(!XFF.includes(sinCabecera));
    });
    test('caso peligroso: 5 saltos y una sola entrada, req.ip es la entrada del cliente', async () => {
        assert.equal(await ipDe(appCon('5').get('trust proxy'), CLIENTE), CLIENTE);
    });
    for (const hops of [1, 2, 3]) {
        test(`hops ${hops}: anteponer IPs falsas no cambia req.ip`, async () => {
            const n = appCon(String(hops)).get('trust proxy');
            assert.equal(await ipDe(n, `198.51.100.99, 192.0.2.77, ${XFF}`), await ipDe(n, XFF));
        });
    }
    test('hops 0: cualquier X-Forwarded-For da el mismo req.ip', async () => {
        const n = appCon('0').get('trust proxy');
        assert.equal(await ipDe(n, '192.0.2.1'), await ipDe(n, '198.51.100.1, 203.0.113.1'));
    });
});

describe('M12: contador de los limitadores con la app real', () => {
    test('hops 1: falsas antepuestas distintas comparten cupo en login (10 veces 401, la 11.ª 429)', async () => {
        const app = appCon('1');
        const statuses = [];
        for (let i = 1; i <= 11; i += 1) {
            statuses.push((await post(app, '/api/v1/log', LOGIN, `198.51.100.${i}, 192.0.2.9`)).status);
        }
        assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
    });
    test('hops 0: X-Forwarded-For distinto comparte cupo en login (la 11.ª da 429)', async () => {
        const app = appCon('0');
        const statuses = [];
        for (let i = 1; i <= 11; i += 1) {
            statuses.push((await post(app, '/api/v1/log', LOGIN, `198.51.100.${i}`)).status);
        }
        assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
    });
    test('hops 1: falsas antepuestas distintas comparten cupo en send-email (la 6.ª da 429)', async () => {
        const app = appCon('1');
        const statuses = [];
        for (let i = 1; i <= 6; i += 1) {
            statuses.push((await post(app, '/api/v1/send-email', MAIL, `198.51.100.${i}, 192.0.2.9`)).status);
        }
        assert.equal(statuses[5], 429);
        assert.ok(statuses.slice(0, 5).every((s) => s !== 429), statuses.join(','));
    });
});
