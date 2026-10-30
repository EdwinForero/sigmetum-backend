# Hallazgos pequeños M15, M6, B6, B8 y B2: spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Cerrar cinco hallazgos pequeños de `docs/07-estado-y-deuda-tecnica.md` en una sola iteración: validar el valor (no solo la presencia) de las variables de entorno críticas (M15), acotar el tamaño de los ficheros subidos (M6), dejar de usar la opción obsoleta `max` de los limitadores (B6), fijar el algoritmo al firmar y verificar JWT (B8) y añadir el script `dev` (B2). B9 (NoSuchKey a 404) queda fuera.

Comportamiento actual (leído del código): `config/validateEnv.js` solo filtra variables vacías o ausentes; `multer` se crea con `memoryStorage()` y sin `limits` en `routes/data.js` (`/upload`) y `routes/content.js` (`/upload-image`); `loginLimiter` (`routes/auth.js`) y `sendEmailLimiter` (`routes/content.js`) usan `max`; `jwt.sign` (`functions/userAuthentication.js`) y `jwt.verify` (`functions/tokenAuthentication.js`) no indican algoritmo; `nodemon` ya está en `devDependencies` (`package.json:43`, `"dev": true` en el lock) y no hay script `dev`; `middleware/errorHandler.js` mapea todo `MulterError` a 400 con `File upload error: <mensaje de multer>`.

## Criterios de aceptación

### De código

Cada criterio se comprueba con una prueba (`npm test`) que falla antes del cambio.

M15, modo estricto y no estricto:

1. El modo **estricto** (`validateEnv()` lanza error) se aplica salvo que `NODE_ENV` sea exactamente `local` o `test`: sin `NODE_ENV`, con `production` o con cualquier otro valor es estricto. Con `local` o `test` solo se emite `console.warn` y no se lanza error. Se prueba con `undefined`, `production`, un valor arbitrario, `local` y `test`.
2. En modo estricto lanza error si `ADMIN_PASSWORD` no tiene forma de hash bcrypt (`$2a$`, `$2b$` o `$2y$`); no lanza con un hash de forma válida.
3. En modo estricto lanza error si `JWT_SECRET` tiene menos de 32 caracteres; no lanza con 32 o más.
4. En modo estricto lanza error si `JWT_EXPIRATION` no es una duración válida para `jsonwebtoken` (por ejemplo `abc`), si es solo numérica sin unidad (`3600`, que `jsonwebtoken` interpretaría como milisegundos) o si su resultado es menor o igual que 0 (`0`, `-1`, `-5m`). No lanza con `8h`, `10m` ni `1d`. En el entorno el valor siempre es una cadena, por lo que un número sin unidad se rechaza.
5. En modo no estricto (`local` o `test`), cada valor inválido de los puntos 2 a 4 genera un `console.warn` que nombra la variable y la regla incumplida, sin lanzar error.
6. En ninguno de los modos el mensaje del error ni el del aviso contiene el valor de la variable (la prueba usa un valor centinela reconocible y comprueba que no aparece en el error ni en la salida de `console.warn`).
7. El comportamiento existente para variables ausentes (error con la lista de faltantes) no cambia.

M6 (el máximo aceptado es exacto; se rechaza lo que lo supere):

8. `POST /upload`: un fichero de 10 MB menos 1 byte y uno de exactamente 10 MB se aceptan como hoy; uno de 10 MB más 1 byte responde 400 con `{ success: false, error }` y un mensaje fijo propio (no el texto de multer), y no se llama a S3.
9. `POST /upload-image`: lo mismo con 5 MB: MAX-1 y MAX bytes aceptados, MAX+1 bytes responde 400 con el mismo envoltorio y mensaje fijo propio, sin llamar a S3.
10. El límite configurado debe ser tal que MAX exacto pase y MAX+1 falle (con `multer` 1.4.5-lts.1 un fichero de tamaño igual al `fileSize` configurado se rechaza, por lo que el valor configurado es MAX + 1; las pruebas de MAX-1, MAX y MAX+1 bytes lo demuestran).
11. Los demás `MulterError` (por ejemplo campo inesperado) conservan el comportamiento actual de 400.

B6:

12. `loginLimiter` y `sendEmailLimiter` siguen limitando a 10 y 5 peticiones por ventana, con el mismo mensaje y cabeceras; ninguna usa la opción `max` (el límite se aplica y no hay aviso de obsolescencia). Las pruebas de limitación existentes siguen pasando.

B8:

13. Un token HS256 válido firmado con `JWT_SECRET` sigue siendo aceptado por `tokenAuth`, incluido uno firmado sin indicar algoritmo (representa los ya emitidos).
14. Un token firmado con otro algoritmo (por ejemplo HS512) o con `alg: none` es rechazado con 401.
15. El token que emite `POST /log` lleva `alg: HS256` en su cabecera (se decodifica en la prueba).
16. Los tokens ya emitidos siguen siendo válidos (`jsonwebtoken` firma con HS256 por defecto; **por confirmar** en la versión instalada, cubierto por el punto 13).

B2:

17. `package.json` tiene el script `"dev": "nodemon index.js"`. No hay cambio de dependencias, ni de `package-lock.json`, ni de las métricas de dependencias (14/7).

General:

18. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `npm run docs:gate` pasa antes del commit. Si se corrigen avisos de ESLint, se baja `--max-warnings` al número real.

### De documentación

1. `docs/03-configuracion.md`: reglas de valor de `ADMIN_PASSWORD`, `JWT_SECRET` (mínimo 32) y `JWT_EXPIRATION` (con unidad, positivo); modo estricto salvo `NODE_ENV` `local` o `test`; tabla de scripts con `dev` y fuera la frase «no hay script, usa `npx nodemon`».
2. `docs/02-tecnologias.md`: script `dev`; fuera la frase «no hay script, usa `npx nodemon`».
3. `docs/04-api.md`: límites de 10 MB en `/upload` y 5 MB en `/upload-image` (máximo aceptado exacto) y el 400 con mensaje fijo; algoritmo HS256 de los JWT.
4. `docs/05-modulos.md`: comportamiento de `validateEnv`, `tokenAuthentication`, `userAuthentication`, y límites de `multer` y limitadores en las rutas.
5. `docs/guias/seguridad.md`: actualizar la línea «M15 no se valida al arrancar» (~36), el «No cumple (M6)» de `multer` `limits.fileSize` (~78) y lo referido a los limitadores (~91); contrastar con el código al escribirlo.
6. `.env.example`: comentarios con las reglas de valor; las claves con `SECRET` o `PASSWORD` siguen vacías.
7. `docs/integracion/para-infra.md` y `docs/integracion/para-frontend.md`: ver "Impacto en contratos externos".
8. `docs/07-estado-y-deuda-tecnica.md`: M15, M6, B6, B8 y B2 resueltos con fecha, fecha "actualizado" de hoy; B9 sigue abierto. Se deja constancia de que el `.env` local de desarrollo tiene un `ADMIN_PASSWORD` que no es hash bcrypt (verificado sin imprimir el valor): los logins locales ya dan 401 y el aviso de M15 lo destapará. No se escribe el valor.

## Fuera de alcance

- B9 (NoSuchKey a 404): cambia el estado HTTP y es contrato; otro ciclo.
- M2, M5 y el resto de lo que cuelga de ellos.
- Rotar secretos reales o cambiar valores de despliegue en `sigmetum-infra`; leer o escribir valores reales de variables; corregir el `.env` local del usuario.
- Cambiar el mensaje o los umbrales de los limitadores.
- Cualquier cambio de dependencias.
- Cualquier cambio en el frontend o en infraestructura (solo se documenta y se avisa en la PR).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: M6 añade un 400 nuevo en `/upload` y `/upload-image` para ficheros por encima de 10 MB y 5 MB. Se clasifica como **compatible**: la guía define como compatible una validación de entrada más estricta que da 400, el envoltorio `{ success: false, error }` no cambia y el frontend ya recibe 400 en otros fallos de subida. Que el frontend no suba hoy ficheros por encima de esos límites y muestre el mensaje del error está **(por confirmar)**; los límites en los formularios del frontend no se corrigen aquí. B8 no cambia la forma ni los campos del JWT ni su caducidad; los tokens vigentes siguen valiendo (por confirmar). B6 y B2 no lo afectan.
- `docs/integracion/para-infra.md`: M15 es **condición previa de despliegue**, a cargo del usuario y **(por confirmar)**: `JWT_SECRET` (mínimo 32), `ADMIN_PASSWORD` (hash bcrypt) y `JWT_EXPIRATION` (con unidad y positiva) reales de dev y prod en Beanstalk deben cumplir las reglas. Riesgo: `NODE_ENV` no está definido en los `.tfvars.example` de infra, y sin `NODE_ENV` el modo es estricto; un arranque en Beanstalk con secretos débiles dejará de arrancar. No se han visto ni se escriben valores reales. El `10m` de `JWT_EXPIRATION` del ejemplo de infra es válido. No se encontró un límite de cuerpo en el proxy en `sigmetum-infra` (por confirmar). B2 no afecta a infra.

## Preguntas abiertas

Ninguna.
