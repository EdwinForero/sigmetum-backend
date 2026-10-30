# M21 entrega 1 (mitigaciones: límite y validación en `content.js`): plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: [2026-10-28-m21-tokenauth-rutas-publicas-design.md](2026-10-28-m21-tokenauth-rutas-publicas-design.md) (solo entrega 1; decisión 4 de `imageKey` corregida)

Crítico: sí. Coincide con "claves de S3" (la regla de `imageKey` protege la construcción de claves en `config/s3Paths.js` y las rutas que firman y borran objetos) y con "contrato con el frontend" (nuevos `400` y `429`; `routes/**` y `config/s3Paths.js` están en `areasContrato`). No toca autenticación, JWT, dependencias ni CI.

## Decisiones de arquitectura

1. **Regla compartida de `imageKey`, en dos piezas.** Las constantes (patrón, longitud máxima, extensiones) van en `config/s3Paths.js`; la función pura `isValidImageKey` va en `functions/validateImageKey.js` (nuevo). Motivo: `buenas-practicas-backend.md` §Validación dice que las expresiones de claves de S3 "se definen una vez en `config/`", y `config/` y `functions/` son los sitios para constantes y lógica pura. Descartado `aws/` (CLAUDE.md prohíbe lógica de negocio ahí; `aws/awsS3connect.js` no se toca: los rechazos ocurren en la ruta, antes de llamar a S3). Descartado meter la función en `config/s3Paths.js` (`config/` es "sin lógica").
2. **Validación de `/send-email` en `functions/validateContactMessage.js`** (nuevo, pura), según la regla "una función de validación por forma de entrada". Sus límites (100, 150, 2000, 254) son constantes del propio archivo, no de `config/`, porque no son claves de S3.
3. **Limitador `sendEmailLimiter` definido en `routes/content.js`**, con el mismo patrón que `loginLimiter` en `routes/auth.js`. Descartado `middleware/rateLimiters.js`: solo hay un uso.
4. **Orden de middleware en `/send-email`.** Pila: `router.post('/send-email', sendEmailLimiter, async (...) => { validación → sendMail })`. El limitador cuenta antes de la validación (los cuerpos inválidos también gastan cupo). En esta entrega `tokenAuth` (montado en `data.js` con `router.use(protectedRouter)` sin ruta propia) corre antes que el limitador: una petición sin token recibe 401 y no cuenta; solo cuentan las que llegan con token válido. En la entrega 2, cuando `tokenAuth` deje de interceptar esta ruta, el limitador contará todas las peticiones sin cambiar el orden.
5. **Sin variables de entorno ni dependencias nuevas.** Los valores del límite son literales en el código, como `loginLimiter`.
6. **Forma de la prueba.** Script repetible `scripts/verificar-m21-entrega1.mjs`, sin entrada en `package.json` (`node scripts/verificar-m21-entrega1.mjs`). Reproduce la pila de producción (ver paso 1): monta primero el router real de `routes/data.js` y después el de `routes/content.js` en un `express()` propio. Sustituye `aws/awsS3connect` y `nodemailer` en `require.cache` con espías que cuentan llamadas. Sin `child_process` (prohibido). Descartado crear una base de tests (M11) o exportar `app` (M13, tocaría `index.js`).
7. **Regla de `imageKey` (decisión 4 de la spec).** Se prefiere una regla por segmentos con propiedades Unicode (`\p{L}`, `\p{N}`, bandera `u`) a una lista ASCII, porque `upload-image` no valida el nombre y la galería puede contener tildes, ñ, paréntesis y `+`. Descartado: ASCII estricto (rechazaría imágenes reales) y `\w` (ambiguo con Unicode). La regla no se relaja más: lo que el listado real no cumpla es hallazgo (criterio 6, ahora GATE).

## Hallazgos y supuestos

- **Extensiones.** El panel del frontend (`ImageGalleryManager.js:115`) acepta `image/jpeg, image/png, image/gif, image/webp`, así que la lista es `jpg`, `jpeg`, `png`, `gif`, `webp`, sin distinguir mayúsculas. El backend no valida la extensión al subir (M5): pueden existir en S3 claves con otras extensiones o con caracteres fuera de la regla (`upload-image` solo sustituye espacios del `title`; un espacio que viniera de otro origen se rechaza). Esas imágenes serían rechazadas por `GET /get-image` y `DELETE /delete-image`. **(Por confirmar)** con el GATE del criterio 6 contra el listado real; si alguna clave no pasa, se señala como hallazgo y no se relaja la regla.
- **ContactForm.** El frontend no pone `maxLength`. Los límites nuevos pueden devolver `400` a textos largos. `docs/05-componentes.md` del frontend dice que muestra un diálogo de éxito o de error, lo que sugiere que 400/429 no lo rompen. **(Por confirmar)** en el código del frontend: su manejo del 400/429 sigue sin comprobarse. Hoy no llega a esos códigos sin token.
- **Correo.** `type="email"` del navegador admite `a@b`; el validador exige un punto en el dominio, así que ese caso daría 400. Se propone aceptarlo y documentarlo.
- **Manejador actual de `/send-email`.** Desestructura `req.body` fuera de `try`: manejador `async` sin `try/catch` completo, que CLAUDE.md prohíbe. El paso 4 mete todo dentro del `try` con `next(error)`.
- **IP tras proxy.** Con `trust proxy 1` y la cadena nginx → Express (`para-infra.md`, I2 resuelto), `req.ip` debería ser el cliente real. **(Por confirmar con infra)** en producción.
- **Limitador en memoria.** El almacén por defecto de `express-rate-limit` es el `MemoryStore`: el contador se reinicia al reiniciar o desplegar y se multiplica por el número de instancias. Usuarios tras un mismo NAT comparten el cupo de 5 por 15 minutos. Se acepta en esta entrega y se anota en la documentación (ver tester).
- **Producción.** La condición previa (comportamiento real de `list-terms`, `list-images` y `send-email` sin token) la comunica el usuario. No bloquea esta entrega.

## Fase 1 (5 pasos)

1. **Script de verificación repetible (se escribe primero y debe fallar)**
   - Archivo: `scripts/verificar-m21-entrega1.mjs` (crear). No se toca `package.json`. Sale con código distinto de 0 si algún caso falla e imprime un resultado por criterio.
   - **Montaje que reproduce producción** (sin esto, "sin token da 401" y "la petición sin token no gasta cupo" no tendrían sentido y `req.body` quedaría `undefined`):
     - Entorno antes de cargar nada: `JWT_SECRET` ficticio y obviamente falso (por ejemplo `solo-para-pruebas-no-es-un-secreto`, para que el escáner de secretos de `quality` no lo marque) y las variables que pidan los módulos al cargarse.
     - Sustituir con `require.cache` (vía `createRequire`) `aws/awsS3connect` y `nodemailer` por espías que cuentan llamadas (S3: firmar, borrar, listar; SMTP: `sendMail`, que responde éxito).
     - `express()` propio con `app.set('trust proxy', 1)`, `app.use(express.json())`, el router real de `routes/data.js` montado primero, después el de `routes/content.js`, ambos bajo el mismo prefijo que `index.js`, y `middleware/errorHandler` al final (igual que `index.js`).
     - Token firmado con `jsonwebtoken` y el `JWT_SECRET` ficticio (válido, caducado e inválido).
     - **Recarga solo `routes/content.js` entre escenarios** (borra su entrada de `require.cache` y vuelve a montar la app) para empezar con el limitador a cero. No se recarga `express-rate-limit`. Los `require.cache` de `data.js` y de los espías se mantienen.
     - Termina con `process.exit(código)` para que los temporizadores del `MemoryStore` no mantengan vivo el proceso. Sin `child_process`.
   - Casos, todos con token válido salvo los marcados:
     - Criterio 1 (sin abrir rutas): sin `Authorization`, `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms` dan 401 `No token provided`; las nueve rutas 🔒 también. Con token inválido o caducado, `Invalid token` y `Token expired`.
     - Criterio 2 (límite, limitador a cero): cinco `POST` válidos dan 200 y el espía de `sendMail` cuenta 5; el sexto da `429` con `{ success:false, error }` y `sendMail` sigue en 5; con `X-Forwarded-For` distinto, una segunda IP sí pasa; una petición sin token entre medias da 401 y no gasta cupo (el sexto válido sigue siendo el que da 429).
     - Criterio 3 (validación; un escenario nuevo por cada 5 casos para no agotar el cupo): `400` con `sendMail` en 0 para campo ausente; tipo número, array u objeto; vacío o solo espacios; correo `abc`, `a b@c.d` o `a@b.c,d@e.f`; correo de 255 caracteres; nombre de 101, asunto de 151 y mensaje de 2001 caracteres; `\n` o `\r` en nombre, correo o asunto. Un cuerpo válido da 200 y envía.
     - Criterios 4 y 5: `GET /get-image?imageKey=` y `DELETE /delete-image` con cuerpo `{imageKey}`. Los inválidos dan `400` con 0 llamadas al espía de S3:
       - Inválidos: `../x.jpg`, `a/../b.jpg`, `/a.jpg`, `a//b.jpg`, `a b.jpg` (espacio), `a\b.jpg` (barra invertida), carácter de control (`a\u0001b.jpg`), 201 caracteres, `a.txt`, `a` sin extensión, `.hidden.jpg`, `a/.hidden.jpg`, array (`?imageKey=a&imageKey=b`) y número.
       - `a%2e%2e/b.jpg` en query: Express lo decodifica y llega como `a../b.jpg`; el caso espera `400`, rechazado por la comprobación de `..` (no por el patrón: `a..` sin más cumpliría el patrón por segmentos). En el cuerpo JSON del `DELETE` se prueba directamente `a../b.jpg`.
       - Válidos (llegan a S3 una vez y devuelven la URL prefirmada o el borrado, como hoy): `foto.jpg`, `sub/foto-1_2.PNG`, `a.webp`, `b.gif`, `c.jpeg`, con tilde y ñ (`Año/árbol-ñandú.jpg`), con paréntesis (`foto(1).jpg`; con espacio, `foto (1).jpg`, es inválido) y con `+` (`a+b.png`).
       - Sin `imageKey` mantiene `400 imageKey is required`.
   - Comprobación: ejecutarlo antes de implementar. Deben fallar los criterios 2 a 5 por el motivo correcto (sin 429 y sin 400, con el espía de S3 o SMTP llamado). El criterio 1 debe pasar ya; si falla antes del cambio, parar y avisar (el script estaría mal).
   - Norma: `buenas-practicas-backend.md` §Tests (TDD) y §Validación; criterio de código 7 de la spec.
2. **Regla compartida de `imageKey`**
   - Archivos: `config/s3Paths.js` (modificar), `functions/validateImageKey.js` (crear).
   - `config/s3Paths.js` añade `IMAGE_KEY_MAX_LENGTH = 200` e `IMAGE_KEY_PATTERN` (expresión con banderas `u` e `i`, **sin la bandera `g`**, para que `.test()` no guarde estado entre llamadas). Estructura: uno o más segmentos separados por un único `/`; cada segmento empieza por una letra o número Unicode o por uno de `_ - ( ) +` (nunca por `.`) y continúa con letras y números Unicode (`\p{L}`, `\p{N}`) y los signos `. _ - ( ) +`; la clave termina en `.(jpe?g|png|gif|webp)`. Rechaza por construcción la `/` inicial, la `//`, la barra invertida, los espacios, los caracteres de control y los segmentos que empiezan por `.`. Comentar al lado la lista de extensiones (por qué incluye `gif`) y los signos permitidos.
   - `functions/validateImageKey.js` exporta `isValidImageKey(key)`: `true` solo si `typeof key === 'string'`, la longitud está entre 1 y `IMAGE_KEY_MAX_LENGTH` (**esta comprobación va primero**, antes de ejecutar la expresión), `IMAGE_KEY_PATTERN.test(key)` y `!key.includes('..')`. Comentario en el código: la comprobación de `..` es **defensa en profundidad**; el patrón por segmentos no la garantiza por sí solo (`a../b.jpg`, que es lo que llega tras decodificar `a%2e%2e/b.jpg`, cumple el patrón y lo rechaza esta comprobación). Función pura, sin leer `process.env`.
   - Comprobación: los casos de los criterios 4 y 5 del script y `npm run lint`. Cada expresión regular con `\` se escribe con el editor, no con heredoc ni `node -e` (CLAUDE.md).
   - Norma: `buenas-practicas-backend.md` §Validación y §Estructura; CLAUDE.md ("claves de S3 salen de `config/s3Paths.js`"; "no construir una clave con texto del cliente sin validarlo").
3. **Validación de `/send-email`**
   - Archivo: `functions/validateContactMessage.js` (crear).
   - Exporta `validateContactMessage(body)` (`body` puede ser `undefined`); devuelve `{ error: '<texto fijo en inglés, sin detalles internos>' }` o `{ value: { username, email, subject, message } }` con los cuatro campos recortados. Reglas: los cuatro son cadenas no vacías tras `trim()` (mantiene el mensaje `username, email, subject and message are required and must be strings` para ausente, no cadena o vacío); `username` ≤ 100, `subject` ≤ 150, `message` ≤ 2000, `email` ≤ 254, medidos tras recortar; `email` cumple `^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$`; sin `\r` ni `\n` en `username`, `email` ni `subject`. Los mensajes de error nombran el campo y la regla y no reflejan el valor recibido.
   - Comprobación: los casos del criterio 3 del script, tras el paso 4.
   - Norma: `seguridad.md` S6 (validar todos los campos de `/send-email`); `buenas-practicas-backend.md` §Validación.
4. **Conectar límite y validaciones en las rutas**
   - Archivo: `routes/content.js` (modificar).
   - Añade `require('express-rate-limit')` y `sendEmailLimiter` (copia de `loginLimiter`): `windowMs: 15*60*1000`, `max: 5`, `standardHeaders: true`, `legacyHeaders: false`, `message: { success:false, error:'Too many messages. Please try again in 15 minutes.' }`.
   - `router.post('/send-email', sendEmailLimiter, async (req, res, next) => {...})`: declaración en una sola línea con el limitador (`scripts/lib/repo.mjs` analiza línea a línea), sin escribir `tokenAuth` en esa línea (para no marcar la ruta como protegida); cuerpo completo dentro de `try` (llama a `validateContactMessage(req.body)`, devuelve `400 { success:false, error }` si hay error, construye `mailOptions` con los valores recortados) y `next(error)` en el `catch`.
   - `GET /get-image`: tras la comprobación actual de `imageKey is required`, si `!isValidImageKey(imageKey)` devuelve `400 { success:false, error:'imageKey is not valid' }` antes de `getPresignedUrlFromS3`. `DELETE /delete-image`: la misma comprobación antes de `deleteImageFromS3`. `aws/awsS3connect.js` y las rutas protegidas restantes no se tocan.
   - Comprobación: `node scripts/verificar-m21-entrega1.mjs` pasa entero; `npm run lint`.
   - Norma: `seguridad.md` (límites en endpoints públicos que cuestan; validación de `/send-email`); `buenas-practicas-backend.md` §Rutas; CLAUDE.md "Lo que nunca se hace"; `para-frontend.md` §Códigos (400/429, solo alcanzables con token en esta entrega).
5. **Actualizar el texto de la excepción en `quality`**
   - Archivo: `scripts/quality-check.mjs` (modificar solo el texto del valor de `'POST /send-email'` en `PUBLIC_MUTATING_ROUTES`). La clave de la excepción no cambia. El motivo pasa a decir que lleva límite de 5 peticiones cada 15 minutos por IP y validación (M3), y deja de decir "Falta límite…".
   - Comprobación: `npm run quality` pasa con la excepción activa y sin perder ninguna red; el `JWT_SECRET` ficticio del paso 1 no dispara el escáner de secretos.
   - Norma: `seguridad.md` §Excepciones (el motivo debe ser veraz); criterio de código 8 de la spec.

## A cargo del tester-documentador

Solo documentación y comprobaciones; el `developer` no las toca.

- **GATE del criterio 6 (antes de dar por buena la regla de `imageKey`).** Ejecutar la pasada real (ver Pruebas) y comparar con el listado real de S3: cada `fileName` de `GET /list-images` debe pasar `isValidImageKey`. Si alguna clave no pasa, se registra como hallazgo (clave, motivo) en el informe y en `docs/07`; **no se relaja la regla**. La entrega no se da por buena hasta ejecutar el GATE y dejar el resultado (pasa o hallazgo) escrito. Si no se puede ejecutar (sin credenciales o SSO), queda **(por confirmar)** y se dice.
- `docs/07-estado-y-deuda-tecnica.md`: M3 resuelta con fecha; M4 y M5 actualizadas (`GET /get-image` y `DELETE /delete-image` ya validan `imageKey`; pendiente `/upload-image`: MIME y claves); **M21 sigue abierta**, con nota de entrega 1 hecha y entregas 2 y 3 pendientes; resultado del GATE del criterio 6; "Prioridades sugeridas", fecha "actualizado" y métricas si cambian.
- `docs/04-api.md`: `/send-email` con el `429` y los `400` nuevos; `/get-image` y `/delete-image` con el `400` por `imageKey` no permitido, aclarando que hoy solo son alcanzables con token. El aviso M21 se mantiene.
- `docs/05-modulos.md`: `routes/content.js` (limitador y validaciones), dos módulos nuevos en `functions/`, constantes nuevas en `config/s3Paths.js`. No tocar el texto sobre `router.use(protectedRouter)` y M21.
- `docs/06-almacenamiento-s3.md`: la regla de `imageKey` (letras y números Unicode y `. _ - ( ) +` por segmento, `/` simple, 200 caracteres, extensiones jpg/jpeg/png/gif/webp, `..` rechazado) y el riesgo residual aceptado (se pueden firmar objetos no listados bajo `gallery/`).
- `docs/integracion/para-frontend.md`: `429` y los nuevos `400` como cambio de comportamiento, clasificación **compatible condicionada** a (a), (b) y (c) de la spec (si no se confirman, incompatible); F6 no se cierra; "Límite de peticiones" y "Códigos usados hoy" al día; anotar el hallazgo sobre `gif`, que `ContactForm` (frontend) no tiene `maxLength` y que su manejo del 400/429 sigue **(por confirmar)**.
- `docs/integracion/para-infra.md`: límite por IP tras `trust proxy 1` como **(por confirmar con infra)**; anotar que el almacén del limitador es en memoria (se reinicia al desplegar y se multiplica por instancia) y que usuarios tras un mismo NAT comparten el cupo de 5 por 15 minutos. Revisar cómo trata la versión instalada de `express-rate-limit` (8.5.2, que expone la opción `ipv6Subnet`) el agrupado de direcciones IPv6 y anotar el resultado, o **(por confirmar)** si no se puede comprobar. Sin variables ni IAM nuevos.
- `docs/guias/seguridad.md`: filas de `/send-email` (límite y validación, líneas ~56, 91, 92, 165 y 170) y M4/M5 de `/get-image` y `/delete-image`; revisar `docs/guias/buenas-practicas-backend.md` §Validación (fila de `GET /get-image`).
- `docs/guias/mantenimiento.md`: mencionar `scripts/verificar-m21-entrega1.mjs` (por `scripts/**`) y cómo ejecutarlo.
- **Aviso para PR nuevo** `docs/specs/2026-10-28-m21-entrega1-aviso-pr.md`: cambio de contrato (`POST /send-email` puede dar `400` por formato y longitud y `429` por 5 cada 15 minutos por IP; `GET /get-image` y `DELETE /delete-image` dan `400` por `imageKey` no permitido); solo alcanzable con token hoy; sin cambios en envoltorio, rutas ni JWT; pendientes de confirmar (a), (b), (c), la IP real tras el proxy y el resultado del GATE; límites del limitador en memoria y NAT; orden de despliegue: backend primero, y la entrega 2 no se abre sin esta.
- Verificación final: `npm run lint`, `npm run quality`, `npm run docs:check`, `npm run docs:gate` (antes del commit). `agentes:test` no aplica (no se toca `plugins/`).

## Pruebas

Sin base de tests (M11). Verificación = script del paso 1 más una pasada con peticiones reales.

- Script repetible: `node scripts/verificar-m21-entrega1.mjs`; cubre los criterios 1 a 5 con token y con la pila real de `data.js` y `content.js`, sin S3 ni SMTP reales; falla antes del cambio (pasos 2 a 4) y pasa después.
- **Pasada real contra servidor local (GATE del criterio 6)**: `npm start` con `.env` local y SSO. (1) `POST /api/v1/log` con credenciales reales para obtener el token (nunca escribirlo en documentos ni logs); (2) `GET /list-images` con token: cada `fileName` devuelto debe pasar `isValidImageKey`, y las que no pasen se anotan como hallazgo sin relajar la regla; (3) `GET /get-image?imageKey=<una real>` con token da 200; (4) `GET /get-image?imageKey=../x.jpg` con token da 400; (5) sin token, las cuatro rutas siguen dando 401 `No token provided`; (6) `POST /send-email` con cuerpo inválido y token da 400 y no envía correo; no enviar correos válidos en la prueba real.
- Criterio 1 en servidor real sin S3: con un `.env` ficticio que pase `validateEnv`, `npm start` y confirmar los 401 sin token; las rutas públicas de `data.js` y `POST /log` responden como antes.
- Criterios 8 y 9: `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `git diff` no toca `package.json`, `package-lock.json`, `.env.example` ni `config/validateEnv.js`.

## Cierre

- Crítico: sí (coincide con "claves de S3" y con "contrato con el frontend", ver arriba).
- Documentos de `integracion` afectados: `para-frontend.md` (cambio de comportamiento y clasificación condicionada) y `para-infra.md` (límite por IP tras el proxy, almacén en memoria, NAT e IPv6; sin variables ni IAM nuevos).
- Campos opcionales de `flujo.json`: todos presentes. `consultor` es "ninguno".
