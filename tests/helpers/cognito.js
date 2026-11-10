// Cognito de pruebas: par RSA generado aquí con node:crypto, JWKS simulado y firmadores de tokens. Se requiere DESPUÉS de
// `./entorno` (que fija COGNITO_USER_POOL_ID y AWS_REGION) y ANTES de cargar app.js. Sin red ni credenciales.
//
// El JWKS simulado sustituye a SimpleFetcher.prototype.fetch (la capa de red de aws-jwt-verify). El verificador de
// middleware/tokenAuthentication.js construye su propia caché de JWKS con un fetcher que envuelve a SimpleFetcher, así que
// el código real de caché, penalización (10 s por URI) y envoltura se ejecuta entero; solo la petición HTTPS es falsa.
require('./entorno');
const crypto = require('node:crypto');
const { SimpleFetcher } = require('aws-jwt-verify/https');
const { FetchError } = require('aws-jwt-verify/error');

const POOL_ID = process.env.COGNITO_USER_POOL_ID;
const REGION = POOL_ID.split('_')[0];
const ISS = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const ISS_GLOBAL = `https://issuer-cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const JWKS_URI = `${ISS}/.well-known/jwks.json`;
const KID = 'kid-de-prueba-1';

const generarPar = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const parValido = generarPar();
const parAjeno = generarPar();
const PEM_PUBLICA = parValido.publicKey.export({ type: 'spki', format: 'pem' });
const JWK_PUBLICO = { ...parValido.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

// Control mutable del JWKS simulado: modo 'ok' sirve las claves y 'caido' falla como un fallo de red.
const jwksControl = { modo: 'ok', peticiones: 0, uris: [], jwks: { keys: [JWK_PUBLICO] } };
const reiniciarJwks = () => {
    jwksControl.modo = 'ok';
    jwksControl.peticiones = 0;
    jwksControl.uris.length = 0;
    jwksControl.jwks = { keys: [JWK_PUBLICO] };
};

// La librería exige un ArrayBuffer exacto: el .buffer de un Buffer comparte el pool de Node y falla.
SimpleFetcher.prototype.fetch = async function fetchSimulado(uri) {
    jwksControl.peticiones += 1;
    jwksControl.uris.push(uri);
    if (jwksControl.modo === 'caido') throw new FetchError(uri, 'JWKS caido simulado');
    return new TextEncoder().encode(JSON.stringify(jwksControl.jwks)).buffer;
};

const base64url = (objeto) => Buffer.from(JSON.stringify(objeto)).toString('base64url');
const ahora = () => Math.floor(Date.now() / 1000);

const claimsAcceso = (over = {}) => ({
    iss: ISS,
    sub: 'sub-de-prueba',
    client_id: 'cliente-de-prueba',
    token_use: 'access',
    username: 'admin-de-prueba',
    scope: 'aws.cognito.signin.user.admin',
    exp: ahora() + 24 * 3600,
    ...over,
});

// RS256 con el par indicado (por defecto el válido, el que publica el JWKS simulado). `kid: null` omite el kid de la cabecera.
const firmar = (claims, { kid = KID, par = parValido } = {}) => {
    const cabecera = base64url({ alg: 'RS256', typ: 'JWT', ...(kid === null ? {} : { kid }) });
    const cuerpo = base64url(claims);
    const firma = crypto.sign('sha256', Buffer.from(`${cabecera}.${cuerpo}`), par.privateKey).toString('base64url');
    return `${cabecera}.${cuerpo}.${firma}`;
};

// HMAC (HS256 por defecto, o HS512) con el secreto dado: la confusión de algoritmos usa PEM_PUBLICA como secreto.
const firmarHs256 = (claims, secreto, { alg = 'HS256', kid = KID } = {}) => {
    const cabecera = base64url({ alg, typ: 'JWT', kid });
    const cuerpo = base64url(claims);
    const resumen = alg === 'HS512' ? 'sha512' : 'sha256';
    const firma = crypto.createHmac(resumen, secreto).update(`${cabecera}.${cuerpo}`).digest('base64url');
    return `${cabecera}.${cuerpo}.${firma}`;
};

// alg none: sin firma.
const sinFirma = (claims) => `${base64url({ alg: 'none', typ: 'JWT', kid: KID })}.${base64url(claims)}.`;

const validToken = firmar(claimsAcceso());
const expiredToken = firmar(claimsAcceso({ exp: ahora() - 10 }));
const invalidToken = firmar(claimsAcceso(), { par: parAjeno });

module.exports = {
    POOL_ID, REGION, ISS, ISS_GLOBAL, JWKS_URI, KID, PEM_PUBLICA, jwksControl, reiniciarJwks,
    claimsAcceso, firmar, firmarHs256, sinFirma, parAjeno, validToken, expiredToken, invalidToken,
};
