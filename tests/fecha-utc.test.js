// Criterio 11 del antiguo script de verificación de rutas (retirado): fecha UTC única (A1). formatFileName y getNextVersion con la fecha
// inyectada y el flujo de POST /upload. Los casos corren con el huso por defecto y con Pacific/Kiritimati (UTC+14), donde
// la fecha local y la UTC difieren. Los nombres de los casos son los mismos que los del script.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { TEST_SECRET } = require('./helpers/entorno');
const { appNueva, argsLog, reiniciar, seed } = require('./helpers/simulados');
const { fullRow, subir } = require('./helpers/excel');
const { formatFileName } = require('../functions/formatFileName');
const { getNextVersion } = require('../functions/getNextVersion');

const app = appNueva();
beforeEach(reiniciar);

const antesDeNoche = new Date('2026-10-28T23:30:00Z');
const despuesDeNoche = new Date('2026-10-29T00:30:00Z');
// Token firmado FUERA del mock de Date, con el instante simulado como iat: así sigue vigente bajo el mock.
const tokenDelInstanteSimulado = jwt.sign({ userId: 1, iat: Math.floor(antesDeNoche.getTime() / 1000) }, TEST_SECRET, { expiresIn: '1h' });

for (const huso of ['por defecto', 'Pacific/Kiritimati']) {
    describe(`huso ${huso}`, () => {
        let tzOriginal;
        let teniaTz;
        before(() => {
            teniaTz = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
            tzOriginal = process.env.TZ;
            if (huso !== 'por defecto') process.env.TZ = huso;
        });
        after(() => {
            if (teniaTz) process.env.TZ = tzOriginal; else delete process.env.TZ;
        });

        if (huso !== 'por defecto') {
            test('el huso de prueba es UTC+14 (la fecha local no es la UTC)', () => {
                assert.equal(new Date().getTimezoneOffset(), -840);
                assert.equal(antesDeNoche.getDate(), 29);
                assert.equal(antesDeNoche.toISOString().slice(0, 10), '2026-10-28');
            });
        }

        test('formatFileName(1, 2026-10-28T23:30Z) usa el día UTC', () => assert.equal(formatFileName(1, antesDeNoche), '2026-10-28_v1.xlsx'));
        test('formatFileName(1, 2026-10-29T00:30Z) usa el día UTC', () => assert.equal(formatFileName(1, despuesDeNoche), '2026-10-29_v1.xlsx'));
        test('formatFileName conserva el formato con versión', () => assert.equal(formatFileName(7, antesDeNoche), '2026-10-28_v7.xlsx'));

        test('getNextVersion con v1 del mismo día UTC da versión 2', async () => {
            seed.list = [{ name: '2026-10-28_v1.xlsx', key: 'data/Málaga/2026-10-28_v1.xlsx' }];
            assert.equal((await getNextVersion('Málaga', antesDeNoche)).version, 2);
        });
        test('getNextVersion devuelve la carpeta de la provincia', async () => {
            seed.list = [{ name: '2026-10-28_v1.xlsx', key: 'data/Málaga/2026-10-28_v1.xlsx' }];
            assert.equal((await getNextVersion('Málaga', antesDeNoche)).provinciaFolder, 'data/Málaga');
        });
        test('getNextVersion el día UTC siguiente vuelve a la versión 1', async () => {
            seed.list = [{ name: '2026-10-28_v1.xlsx', key: 'data/Málaga/2026-10-28_v1.xlsx' }];
            assert.equal((await getNextVersion('Málaga', despuesDeNoche)).version, 1);
        });

        // Flujo de POST /upload con la fecha fijada a 2026-10-28T23:30Z (mock de Date): versión y nombre usan el mismo día UTC.
        test('POST /upload usa el mismo día UTC en la versión y en el nombre', async (t) => {
            t.mock.timers.enable({ apis: ['Date'], now: antesDeNoche });
            seed.list = [{ name: '2026-10-28_v1.xlsx', key: 'data/Málaga/2026-10-28_v1.xlsx' }];
            const r = await subir(app, [fullRow('Málaga')], tokenDelInstanteSimulado);
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.equal(argsLog.upload[0]?.[0], '2026-10-28_v2.xlsx');
        });
        test('POST /upload devuelve la misma clave que sube', async (t) => {
            t.mock.timers.enable({ apis: ['Date'], now: antesDeNoche });
            seed.list = [{ name: '2026-10-28_v1.xlsx', key: 'data/Málaga/2026-10-28_v1.xlsx' }];
            const r = await subir(app, [fullRow('Málaga')], tokenDelInstanteSimulado);
            assert.equal(r.json?.data?.key, 'data/Málaga/2026-10-28_v2.xlsx');
        });
    });
}
