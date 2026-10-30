// Doble de S3 con estado en memoria sobre S3Client.prototype.send (sin red ni credenciales). Se usa con el
// aws/awsS3connect.js REAL y la app real. Implementa ListObjectsV2 (con paginación), GetObject, PutObject y DeleteObject.
// Quien lo use debe cargar ./entorno antes (fija AWS_BUCKET_NAME, que el doble valida en cada operación).
const { Readable } = require('node:stream');
const { mock } = require('node:test');
const {
    S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const errorS3 = (name, mensaje, status) => Object.assign(new Error(mensaje), {
    name, Code: name, $fault: 'client', $metadata: { httpStatusCode: status },
});

const aBuffer = (cuerpo) => {
    if (Buffer.isBuffer(cuerpo)) return Buffer.from(cuerpo);
    if (typeof cuerpo === 'string') return Buffer.from(cuerpo, 'utf8');
    if (cuerpo instanceof Uint8Array) return Buffer.from(cuerpo);
    throw new TypeError('Cuerpo de PutObject no soportado por el doble de S3');
};

// Orden binario sobre UTF-8, como el de S3.
const comparar = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

// Token opaco: la última clave devuelta en base64 (la siguiente página empieza después de ella).
const aToken = (clave) => Buffer.from(clave, 'utf8').toString('base64');
const deToken = (token) => Buffer.from(token, 'base64').toString('utf8');

const crearS3Simulado = ({ pageSize = 2 } = {}) => {
    const objetos = new Map(); // clave -> { body: Buffer, contentType }
    const llamadas = [];
    let gancho = null;
    let espia = null;

    const clavesOrdenadas = () => [...objetos.keys()].sort(comparar);

    const manejar = (command) => {
        const { input } = command;
        if (input.Bucket !== process.env.AWS_BUCKET_NAME) {
            throw errorS3('NoSuchBucket', 'The specified bucket does not exist', 404);
        }
        if (command instanceof ListObjectsV2Command) {
            const prefijo = input.Prefix || '';
            let claves = clavesOrdenadas().filter((k) => k.startsWith(prefijo));
            if (input.ContinuationToken) {
                const despuesDe = deToken(input.ContinuationToken);
                claves = claves.filter((k) => comparar(k, despuesDe) > 0);
            }
            const pagina = claves.slice(0, pageSize);
            const truncada = claves.length > pageSize;
            const respuesta = {
                Contents: pagina.map((Key) => ({ Key, Size: objetos.get(Key).body.length })),
                IsTruncated: truncada,
                KeyCount: pagina.length,
            };
            if (truncada) respuesta.NextContinuationToken = aToken(pagina[pagina.length - 1]);
            return respuesta;
        }
        if (command instanceof GetObjectCommand) {
            const objeto = objetos.get(input.Key);
            if (!objeto) throw errorS3('NoSuchKey', 'The specified key does not exist.', 404);
            return { Body: Readable.from([Buffer.from(objeto.body)]), ContentType: objeto.contentType };
        }
        if (command instanceof PutObjectCommand) {
            objetos.set(input.Key, { body: aBuffer(input.Body), contentType: input.ContentType });
            return {};
        }
        if (command instanceof DeleteObjectCommand) {
            objetos.delete(input.Key);
            return {};
        }
        throw new Error(`Operación no soportada por el doble de S3: ${command.constructor.name}`);
    };

    const operacion = (command) => {
        if (command instanceof ListObjectsV2Command) return { op: 'List', key: command.input.Prefix };
        if (command instanceof GetObjectCommand) return { op: 'Get', key: command.input.Key };
        if (command instanceof PutObjectCommand) return { op: 'Put', key: command.input.Key };
        if (command instanceof DeleteObjectCommand) return { op: 'Delete', key: command.input.Key };
        return { op: command.constructor.name, key: command.input && command.input.Key };
    };

    return {
        llamadas,
        instalar() {
            espia = mock.method(S3Client.prototype, 'send', async function send(command) {
                const llamada = operacion(command);
                llamadas.push(llamada);
                if (gancho) await gancho(llamada, command);
                return manejar(command);
            });
        },
        restaurar() {
            if (espia) espia.mock.restore();
            espia = null;
        },
        reiniciar() {
            objetos.clear();
            llamadas.length = 0;
            gancho = null;
        },
        sembrar(key, body, contentType) { objetos.set(key, { body: aBuffer(body), contentType }); },
        leer(key) {
            const objeto = objetos.get(key);
            return objeto ? Buffer.from(objeto.body) : undefined;
        },
        contentType(key) { return objetos.has(key) ? objetos.get(key).contentType : undefined; },
        existe(key) { return objetos.has(key); },
        claves(prefijo = '') { return clavesOrdenadas().filter((k) => k.startsWith(prefijo)); },
        // fn(llamada, command) se ejecuta antes de la operación; si lanza, la operación falla. fn = null lo quita.
        alEnviar(fn) { gancho = fn; },
    };
};

module.exports = { crearS3Simulado };
