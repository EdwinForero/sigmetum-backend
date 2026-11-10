// B8: el algoritmo del JWT queda fijado a RS256 (lo fija aws-jwt-verify; nunca sale del cabecero del token).
require('./helpers/entorno');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { appNueva, llamar, validToken } = require('./helpers/simulados');
const { PEM_PUBLICA, claimsAcceso, firmarHs256, sinFirma } = require('./helpers/cognito');

const app = appNueva();
const AUTH = '/api/v1/auth';

describe('B8: algoritmo JWT', () => {
    for (const alg of ['HS256', 'HS512']) {
        test(`un token ${alg} firmado con la clave pública como secreto (confusión de algoritmo) da 401 Invalid token`, async () => {
            const token = firmarHs256(claimsAcceso(), PEM_PUBLICA, { alg });
            const r = await llamar(app, 'GET', AUTH, { token });
            assert.equal(r.status, 401);
            assert.equal(r.json.error, 'Invalid token');
        });
    }
    test('un token con alg none da 401', async () => {
        const r = await llamar(app, 'GET', AUTH, { token: sinFirma(claimsAcceso()) });
        assert.equal(r.status, 401);
    });
    test('un token RS256 válido da 200', async () => {
        const r = await llamar(app, 'GET', AUTH, { token: validToken });
        assert.equal(r.status, 200);
    });
});
