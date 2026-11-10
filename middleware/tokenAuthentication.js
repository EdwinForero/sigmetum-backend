const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { SimpleJwksCache, SimplePenaltyBox } = require('aws-jwt-verify/jwk');
const { SimpleFetcher } = require('aws-jwt-verify/https');
const {
    JwtBaseError,
    JwtExpiredError,
    FetchError,
    NonRetryableFetchError,
    JwksValidationError,
    JwksNotAvailableInCacheError,
    WaitPeriodNotYetEndedJwkError,
} = require('aws-jwt-verify/error');

// Errores que indican que no se pudo obtener el JWKS (no que el token sea malo): 503, no 401.
const JWKS_NO_DISPONIBLE = [FetchError, NonRetryableFetchError, JwksValidationError, JwksNotAvailableInCacheError, WaitPeriodNotYetEndedJwkError];

// Verificador único de los tokens de acceso de Cognito: RS256 fijo, emisor y JWKS derivados de COGNITO_USER_POOL_ID,
// token_use 'access', sin comprobar client_id ni grupos (C16). Se crea una sola vez y de forma perezosa, para no depender
// del entorno al cargar el módulo; la caché de claves públicas vive en esta instancia.
//
// La librería solo penaliza una recarga del JWKS cuando carga y el kid no está; un fallo de red no penaliza y cada petición
// iría a la red. El fetcher envuelve al de la librería y registra el fallo en la misma penalty box (espera de 10 s por URI):
// las peticiones siguientes dentro de la espera dan WaitPeriodNotYetEndedJwkError (503) sin salir a la red.
let verifier = null;
const getVerifier = () => {
    if (!verifier) {
        const penaltyBox = new SimplePenaltyBox();
        const fetcher = new SimpleFetcher();
        const fetcherConPenalizacion = {
            fetch: async (uri) => {
                try {
                    return await fetcher.fetch(uri);
                } catch (error) {
                    penaltyBox.registerFailedAttempt(uri);
                    throw error;
                }
            },
        };
        verifier = CognitoJwtVerifier.create(
            { userPoolId: process.env.COGNITO_USER_POOL_ID, tokenUse: 'access', clientId: null },
            { jwksCache: new SimpleJwksCache({ fetcher: fetcherConPenalizacion, penaltyBox }) },
        );
    }
    return verifier;
};

const tokenAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    try {
        const payload = await getVerifier().verify(token);
        // La librería no exige exp: un token sin caducidad numérica se rechaza aquí.
        if (!Number.isFinite(payload.exp)) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        req.user ={ sub: payload.sub, client_id: payload.client_id, username: payload.username };
        return next();
    } catch (error) {
        if (error instanceof JwtExpiredError) {
            return res.status(401).json({ success: false, error: 'Token expired' });
        }
        if (JWKS_NO_DISPONIBLE.some((clase) => error instanceof clase)) {
            // Una sola línea por 503, solo con el nombre de la clase (las de la librería no fijan `name`): sin URI del JWKS, sin
            // token y sin cabeceras.
            console.error('[auth] JWKS no disponible:', error.constructor.name);
            return res.status(503).json({ success: false, error: 'Authentication service unavailable' });
        }
        if (error instanceof JwtBaseError) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        return next(error);
    }
};

module.exports = { tokenAuth };
