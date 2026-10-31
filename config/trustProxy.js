// Saltos de proxy de confianza (`trust proxy` de Express), fijados por infra con TRUST_PROXY_HOPS.
// Un valor mayor que los saltos reales permite esquivar los límites de intentos con X-Forwarded-For; uno menor
// hace que todos compartan el cupo. Por eso solo se admite un entero de 1 a 5 (0 solo en local y test).
const LENIENT_ENVS = ['local', 'test'];

const HOPS_FORMAT = /^[0-5]$/;
const DEFAULT_HOPS = 1;

// Los mensajes llevan el nombre de la variable y la regla, nunca el valor.
function resolveTrustProxyHops() {
    const raw = process.env.TRUST_PROXY_HOPS;
    if (raw === undefined) return { value: DEFAULT_HOPS, problem: null };

    const lenient = LENIENT_ENVS.includes(process.env.NODE_ENV);
    if (!HOPS_FORMAT.test(raw)) {
        return {
            value: DEFAULT_HOPS,
            problem: lenient
                ? `TRUST_PROXY_HOPS: debe ser un entero de 0 a 5 (se usa ${DEFAULT_HOPS})`
                : 'TRUST_PROXY_HOPS: debe ser un entero de 1 a 5 (el 0 solo se admite con NODE_ENV=local o test)',
        };
    }
    const value = Number(raw);
    if (value === 0 && !lenient) {
        return {
            value: DEFAULT_HOPS,
            problem: 'TRUST_PROXY_HOPS: debe ser un entero de 1 a 5 (el 0 solo se admite con NODE_ENV=local o test)',
        };
    }
    return { value, problem: null };
}

module.exports = { resolveTrustProxyHops, LENIENT_ENVS };
