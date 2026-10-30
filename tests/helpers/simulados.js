// Simulacros compartidos: S3 y SMTP sustituidos por espías inyectados en require.cache ANTES de cargar app.js.
// `node --test` ejecuta cada archivo de test en un proceso propio, así que la caché no se comparte entre archivos.
const { TEST_SECRET } = require('./entorno');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const ROOT = path.join(__dirname, '..', '..');

// Contadores globales de llamadas a S3 y SMTP. Se reinician por test con `reiniciar()`.
const calls = { sendMail: 0, getPresigned: 0, deleteImage: 0, s3Other: 0 };
const spyTotal = () => Object.values(calls).reduce((sum, n) => sum + n, 0);

// Errores sembrados (null = comportamiento normal; el doble lanza el error, como aws/) y argumentos recibidos por los espías de versiones.
const inject = { getTextJson: null, deleteImage: null, deleteTerm: null };
const argsLog = { upload: [], getBuffer: [], put: [], del: [], list: [], image: [] };
const seed = { list: [] };

const reiniciar = () => {
    for (const key of Object.keys(calls)) calls[key] = 0;
    for (const key of Object.keys(inject)) inject[key] = null;
    for (const key of Object.keys(argsLog)) argsLog[key].length = 0;
    seed.list = [];
};

const injectInCache = (filename, exports) => {
    require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
};

const other = (value) => async () => { calls.s3Other += 1; return value; };

injectInCache(path.join(ROOT, 'aws', 'awsS3connect.js'), {
    getPresignedUrlsFromS3Folder: other([]),
    getPresignedUrlFromS3: async () => { calls.getPresigned += 1; return 'https://s3.example.invalid/url-prefirmada'; },
    uploadImageToS3: async (...args) => { calls.s3Other += 1; argsLog.image.push(args); },
    deleteImageFromS3: async () => { calls.deleteImage += 1; if (inject.deleteImage) throw inject.deleteImage; },
    getTextJsonS3: async () => { calls.s3Other += 1; if (inject.getTextJson) throw inject.getTextJson; return []; },
    uploadTextToJsonS3: other(undefined),
    deleteTermFromS3: async () => { calls.s3Other += 1; if (inject.deleteTerm) throw inject.deleteTerm; },
    uploadFileToS3: async (...args) => { calls.s3Other += 1; argsLog.upload.push(args); },
    getFileFromS3: other({}),
    getMergedDataInS3Folder: other({}),
    deleteFileFromS3: async (...args) => { calls.s3Other += 1; argsLog.del.push(args); return { success: true }; },
    // xlsx válido (require perezoso de ./excel: evita un ciclo de carga, porque excel carga simulados solo al subir).
    getBufferFromS3: async (...args) => {
        calls.s3Other += 1;
        argsLog.getBuffer.push(args);
        const { fullRow, makeXlsx } = require('./excel');
        return makeXlsx([fullRow('Málaga')]);
    },
    putJsonToS3: async (...args) => { calls.s3Other += 1; argsLog.put.push(args); },
    listFilesInS3Folder: async (...args) => { calls.s3Other += 1; argsLog.list.push(args); return seed.list; },
});

injectInCache(require.resolve('nodemailer'), {
    createTransport: () => ({ sendMail: async () => { calls.sendMail += 1; return { accepted: [] }; } }),
});

// morgan real, pero sin escribir en stdout (evita ruido de 'combined' en la salida de los tests). La capa sigue
// llamándose `logger`, como en producción.
const morganReal = require('morgan');
injectInCache(require.resolve('morgan'), (format, options) => morganReal(format, { ...options, stream: { write: () => {} } }));

// Tokens: válido, firmado con otra clave (inválido) y caducado.
const validToken = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: '1h' });
const expiredToken = jwt.sign({ userId: 1 }, TEST_SECRET, { expiresIn: -10 });
const invalidToken = jwt.sign({ userId: 1 }, 'otra-clave-distinta-de-prueba', { expiresIn: '1h' });
const TOKEN_STATES = [
    ['sin token', undefined, 'No token provided'],
    ['token inválido', invalidToken, 'Invalid token'],
    ['token caducado', expiredToken, 'Token expired'],
];

// IP única por petición (X-Forwarded-For; app.js usa `trust proxy` 1): los limitadores no se pisan entre casos.
let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };

// app.js nueva: borra de la caché los módulos con limitadores en memoria (routes/auth.js y routes/content.js) y la app.
const appNueva = () => {
    for (const modulo of ['routes/auth.js', 'routes/content.js', 'app.js']) delete require.cache[path.join(ROOT, modulo)];
    return require('../../app');
};

// Petición con supertest: IP única opcional, token Bearer, cuerpo JSON (body) o cuerpo en bruto (rawBody) y cabeceras extra.
// Devuelve { status, json, headers }; json es null si la respuesta no es JSON.
const llamar = async (app, method, url, { token, body, ip, headers, rawBody } = {}) => {
    let req = request(app)[method.toLowerCase()](url);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (ip) req = req.set('X-Forwarded-For', ip);
    if (headers) req = req.set(headers);
    if (body !== undefined) req = req.send(body);
    else if (rawBody !== undefined) req = req.send(rawBody);
    const res = await req;
    return { status: res.status, json: res.type === 'application/json' ? res.body : null, text: res.text, headers: res.headers };
};

// Respuesta de error con el envoltorio { success: false, error: <texto> }.
const isEnvelopeError = (r) => Boolean(r.json) && r.json.success === false && typeof r.json.error === 'string';

module.exports = {
    llamar, isEnvelopeError,
    ROOT, calls, spyTotal, inject, argsLog, seed, reiniciar, validToken, expiredToken, invalidToken, TOKEN_STATES, nextIp, appNueva,
};
