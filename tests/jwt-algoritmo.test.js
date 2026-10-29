// B8: el algoritmo del JWT queda fijado a HS256 al firmar y al verificar.
const { TEST_SECRET } = require('./helpers/entorno');
// userAuthentication.js lee el entorno al cargarse: el hash se fija antes de crear la app.
process.env.ADMIN_PASSWORD = require('bcrypt').hashSync('x', 4);
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { appNueva, llamar, nextIp, validToken } = require('./helpers/simulados');

const app = appNueva();
const AUTH = '/api/v1/auth';

describe('B8: algoritmo JWT', () => {
    test('un token HS512 firmado con la clave correcta da 401 Invalid token', async () => {
        const token = jwt.sign({ userId: 1 }, TEST_SECRET, { algorithm: 'HS512', expiresIn: '1h' });
        const r = await llamar(app, 'GET', AUTH, { token });
        assert.equal(r.status, 401);
        assert.equal(r.json.error, 'Invalid token');
    });
    test('un token con alg none da 401', async () => {
        const token = jwt.sign({ userId: 1 }, '', { algorithm: 'none' });
        const r = await llamar(app, 'GET', AUTH, { token });
        assert.equal(r.status, 401);
    });
    test('un token firmado sin indicar algoritmo sigue valiendo (200)', async () => {
        const r = await llamar(app, 'GET', AUTH, { token: validToken });
        assert.equal(r.status, 200);
    });
    test('POST /log emite un token HS256', async () => {
        const r = await llamar(app, 'POST', '/api/v1/log', { body: { username: 'admin-de-prueba', password: 'x' }, ip: nextIp() });
        assert.equal(r.status, 200);
        assert.equal(jwt.decode(r.json.data.token, { complete: true }).header.alg, 'HS256');
    });
});
