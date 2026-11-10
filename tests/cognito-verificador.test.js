// Verificador único de Cognito (tokenAuth): casos mínimos de la guía de infra, con la ruta protegida real GET /api/v1/auth.
// Par RSA generado en el test y JWKS simulado (helpers/cognito.js): sin red ni credenciales.
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { appNueva, llamar } = require('./helpers/simulados');
const {
    POOL_ID, REGION, ISS, ISS_GLOBAL, PEM_PUBLICA, jwksControl,
    claimsAcceso, firmar, firmarHs256, sinFirma, parAjeno, validToken,
} = require('./helpers/cognito');

const app = appNueva();
const AUTH = '/api/v1/auth';

const ver = (token) => llamar(app, 'GET', AUTH, { token });
const rechazado = (r, status, error) => {
    assert.equal(r.status, status);
    assert.deepEqual(r.json, { success: false, error });
};

// Calienta la caché del JWKS: así los casos de kid desconocido no dejan penalizados a los demás.
before(async () => { assert.equal((await ver(validToken)).status, 200); });
beforeEach(() => { jwksControl.peticiones = 0; });

describe('Cognito: token válido', () => {
    test('un token de acceso válido da 200 Authorized', async () => {
        const r = await ver(validToken);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { success: true, data: 'Authorized' });
    });
    test('el emisor con prefijo issuer-cognito-idp del mismo pool también se acepta (caracterización de la librería)', async () => {
        const r = await ver(firmar(claimsAcceso({ iss: ISS_GLOBAL })));
        assert.equal(r.status, 200);
    });
    test('req.user contiene exactamente sub, client_id y username (nunca el token, scope ni el payload)', async () => {
        const mini = express();
        const { tokenAuth } = require('../middleware/tokenAuthentication');
        mini.get('/quien', tokenAuth, (req, res) => res.json({ user: req.user }));
        const res = await request(mini).get('/quien').set('Authorization', `Bearer ${validToken}`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.user, { sub: 'sub-de-prueba', client_id: 'cliente-de-prueba', username: 'admin-de-prueba' });
        assert.ok(!JSON.stringify(res.body).includes(validToken));
        assert.ok(!('scope' in res.body.user));
    });
});

describe('Cognito: emisor', () => {
    const OTROS = [
        ['otro pool de la misma región', `https://cognito-idp.${REGION}.amazonaws.com/${REGION}_OtroPool9`],
        ['otra región con el mismo id de pool', `https://cognito-idp.eu-west-1.amazonaws.com/${POOL_ID}`],
        ['con barra final', `${ISS}/`],
        ['con otro host', `https://cognito-idp.${REGION}.amazonaws.com.example.invalid/${POOL_ID}`],
        ['con http', `http://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`],
        ['vacío', ''],
    ];
    for (const [nombre, iss] of OTROS) {
        test(`iss ${nombre} da 401 Invalid token`, async () => {
            rechazado(await ver(firmar(claimsAcceso({ iss }))), 401, 'Invalid token');
        });
    }
    test('sin iss da 401 Invalid token', async () => {
        const claims = claimsAcceso();
        delete claims.iss;
        rechazado(await ver(firmar(claims)), 401, 'Invalid token');
    });
});

describe('Cognito: token_use y caducidad', () => {
    test('token_use id (token de identidad) da 401 Invalid token', async () => {
        rechazado(await ver(firmar(claimsAcceso({ token_use: 'id' }))), 401, 'Invalid token');
    });
    test('sin token_use da 401 Invalid token', async () => {
        const claims = claimsAcceso();
        delete claims.token_use;
        rechazado(await ver(firmar(claims)), 401, 'Invalid token');
    });
    test('un token caducado da 401 Token expired', async () => {
        rechazado(await ver(firmar(claimsAcceso({ exp: Math.floor(Date.now() / 1000) - 10 }))), 401, 'Token expired');
    });
    // aws-jwt-verify 5.2.1 no exige exp (medido): tokenAuth exige que sea un número finito. JSON no puede codificar
    // NaN ni Infinity (serían null), así que esas variantes llegan como null y se cubren con el caso null.
    test('un token firmado con la clave del pool pero sin exp da 401 Invalid token', async () => {
        const claims = claimsAcceso();
        delete claims.exp;
        rechazado(await ver(firmar(claims)), 401, 'Invalid token');
    });
    const EXP_NO_NUMERICOS = [['cadena numérica', '9999999999'], ['null', null], ['booleano', true], ['arreglo', [9999999999]], ['objeto', {}]];
    for (const [nombre, exp] of EXP_NO_NUMERICOS) {
        test(`exp ${nombre} da 401 Invalid token`, async () => {
            rechazado(await ver(firmar(claimsAcceso({ exp }))), 401, 'Invalid token');
        });
    }
});

describe('Cognito: firma y algoritmo (B8)', () => {
    test('firma de otro par con el mismo kid da 401 Invalid token', async () => {
        rechazado(await ver(firmar(claimsAcceso(), { par: parAjeno })), 401, 'Invalid token');
    });
    test('alg HS256 con un secreto cualquiera da 401 Invalid token', async () => {
        rechazado(await ver(firmarHs256(claimsAcceso(), 'solo-para-pruebas-no-es-un-secreto')), 401, 'Invalid token');
    });
    for (const alg of ['HS256', 'HS512']) {
        test(`confusión de algoritmo: ${alg} firmado con la clave pública como secreto da 401 Invalid token`, async () => {
            rechazado(await ver(firmarHs256(claimsAcceso(), PEM_PUBLICA, { alg })), 401, 'Invalid token');
        });
    }
    test('alg none da 401 Invalid token', async () => {
        rechazado(await ver(sinFirma(claimsAcceso())), 401, 'Invalid token');
    });
    test('alg none sin kid ni firma da 401 Invalid token', async () => {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        rechazado(await ver(`${b64({ alg: 'none' })}.${b64(claimsAcceso())}.`), 401, 'Invalid token');
    });
});

describe('Cognito: kid y forma del token', () => {
    test('un kid desconocido da 401 Invalid token (primera petición con ese kid)', async () => {
        rechazado(await ver(firmar(claimsAcceso(), { kid: 'kid-que-no-existe' })), 401, 'Invalid token');
    });
    test('un token sin kid da 401 Invalid token', async () => {
        rechazado(await ver(firmar(claimsAcceso(), { kid: null })), 401, 'Invalid token');
    });
    for (const malo of ['abc', 'a.b.c', '....', 'eyJhbGciOiJSUzI1NiJ9.e30']) {
        test(`un token malformado (${malo}) da 401 Invalid token`, async () => {
            rechazado(await ver(malo), 401, 'Invalid token');
        });
    }
    test('tras un kid desconocido, un token con el kid cacheado sigue dando 200', async () => {
        await ver(firmar(claimsAcceso(), { kid: 'otro-kid-que-no-existe' }));
        assert.equal((await ver(validToken)).status, 200);
        assert.equal(jwksControl.peticiones <= 1, true);
    });
});

describe('Cognito: cabecera', () => {
    test('sin cabecera Authorization da 401 No token provided', async () => {
        rechazado(await ver(undefined), 401, 'No token provided');
    });
    for (const cabecera of ['Bearer', 'Bearer ', '', 'Basic']) {
        test(`la cabecera ${JSON.stringify(cabecera)} (sin token) da 401 No token provided`, async () => {
            rechazado(await llamar(app, 'GET', AUTH, { headers: { Authorization: cabecera } }), 401, 'No token provided');
        });
    }
});

describe('Cognito: los errores no filtran el token ni texto de la librería', () => {
    const CASOS = [
        ['firma ajena', () => firmar(claimsAcceso(), { par: parAjeno })],
        ['emisor distinto', () => firmar(claimsAcceso({ iss: `https://cognito-idp.eu-west-1.amazonaws.com/${POOL_ID}` }))],
        ['token_use id', () => firmar(claimsAcceso({ token_use: 'id' }))],
        ['caducado', () => firmar(claimsAcceso({ exp: Math.floor(Date.now() / 1000) - 10 }))],
        ['alg none', () => sinFirma(claimsAcceso())],
        ['malformado', () => 'esto-no-es-un-jwt'],
    ];
    for (const [nombre, crear] of CASOS) {
        test(`${nombre}: el cuerpo es solo { success, error } y no contiene el token ni la URI del JWKS`, async () => {
            const token = crear();
            const r = await ver(token);
            assert.equal(r.status, 401);
            assert.deepEqual(Object.keys(r.json).sort(), ['error', 'success']);
            for (const prohibido of [token, 'jwks', 'amazonaws', POOL_ID, 'JWT', 'JWK', 'Error']) {
                assert.ok(!r.text.includes(prohibido), `la respuesta contiene ${prohibido}`);
            }
        });
    }
});

describe('Cognito: errores que no son de la librería', () => {
    test('un fallo interno del verificador va a errorHandler (500 genérico), no a 401 ni con su mensaje', async (t) => {
        t.mock.method(console, 'error', () => {});
        t.mock.method(CognitoJwtVerifier.prototype, 'verify', async () => { throw new TypeError('detalle-interno-secreto'); });
        const r = await ver(validToken);
        assert.equal(r.status, 500);
        assert.equal(r.json.success, false);
        assert.ok(!r.text.includes('detalle-interno-secreto'));
    });
});
