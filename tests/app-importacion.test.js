require('./helpers/entorno');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { appNueva } = require('./helpers/simulados');

test('importar app.js no abre ningún puerto', () => {
    const app = appNueva();
    assert.equal(typeof app.listen, 'function');
    assert.equal(typeof app, 'function');
    assert.ok(!process.getActiveResourcesInfo().includes('TCPServerWrap'), 'hay un servidor TCP abierto tras importar app.js');
});

test('importar app.js no carga config/validateEnv.js', () => {
    appNueva();
    const cargado = Object.keys(require.cache).some((file) => /[\\/]config[\\/]validateEnv\.js$/.test(file));
    assert.equal(cargado, false);
});

test('trust proxy vale 1', () => {
    assert.equal(appNueva().get('trust proxy'), 1);
});

test('GET /healthcheck responde 200 ok', async () => {
    const res = await request(appNueva()).get('/healthcheck');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'ok');
});
