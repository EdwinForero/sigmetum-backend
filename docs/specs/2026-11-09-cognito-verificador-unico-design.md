# Verificador único de Cognito (backend solo-Cognito): spec

Fecha: 2026-11-09 · Estado: cerrado

Origen: `infra:S18` e `infra:C16` (`sigmetum-infra/docs/integracion/para-backend.md`, sección 2). Tarea crítica: autenticación y JWT, contrato con el frontend e infraestructura, dependencias.

## Objetivo

Hoy el backend autentica con su propio login (`POST /log`, usuario y contraseña de variables de entorno) y verifica tokens HS256 firmados con `JWT_SECRET`. Infra ha pasado a un pool de Cognito por entorno y ha dejado de entregar las cuatro claves del login antiguo en `dev`: con el backend actual, `dev` no arranca. Esta spec pide que el backend verifique **solo** tokens de acceso de Cognito, sin convivencia con el verificador antiguo, y que el login propio desaparezca.

El cambio es **incompatible** con el frontend actual (ver "Impacto en contratos externos").

## Estado real comprobado (lectura, 2026-11-09)

- Backend: `middleware/tokenAuthentication.js` verifica con `jsonwebtoken`, `algorithms: ['HS256']` y `JWT_SECRET`; `routes/auth.js` contiene `POST /log` (con `loginLimiter`, bcrypt y `jwt.sign`) y `GET /auth` (`tokenAuth`, responde `data: 'Authorized'`). `config/validateEnv.js` exige `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` y valida su valor (M15). `jsonwebtoken` y `bcrypt` son dependencias directas; por búsqueda, en código de producción solo los usan `routes/auth.js`, `middleware/tokenAuthentication.js` y `config/validateEnv.js`. `COGNITO_USER_POOL_ID` no existe en el repositorio.
- Pruebas: los tests firman tokens HS256 con `TEST_SECRET` (`tests/helpers/entorno.js`, `tests/helpers/simulados.js` y siete archivos de test más), y varios prueban `POST /log` (`jwt-algoritmo`, `limitadores`, `trust-proxy`, `rutas-publicas`, `estructura-rutas`, `rutas-protegidas`, `validate-env`). Todos se ven afectados.
- Frontend (`sigmetum-frontend`): `LoginForm.js` hace `POST /log {username,password}` y guarda `data.token` en `localStorage['token']`; `api.js` lo envía como `Authorization: Bearer`; `ProtectedRoute.js` llama a `GET /auth` y decodifica el token en el cliente para ver `exp`; un `401` en los métodos `*Auth` borra el token y redirige a `/login`. No hay nada de Cognito en el frontend.
- Infra: entrega solo `COGNITO_USER_POOL_ID` (forma `<región>_<id>`); en `dev` `ALLOWED_ORIGIN` debe coincidir con `cognito_callback_urls`. Plataforma Node 22 (`engines.node: "22"`). Despliegue por CI: `feature/testing` va a `dev` y `master` va a `prod`; `prod` conserva las cuatro claves antiguas y no se toca hasta `S18-prod`.

## Decisiones del usuario (resueltas)

1. Despliegue: cambios ya sobre `feature/sigmetum_v2`; corte único sin convivencia de verificadores y sin `/api/v2`; riesgo de fusión registrado en la sección siguiente.
2. Librería: `aws-jwt-verify`; se retiran `jsonwebtoken` y `bcrypt` si nada más los usa.
3. JWKS inaccesible sin caché: `503` con mensaje fijo; token inválido o caducado: `401`; `GET /auth` conserva `data: 'Authorized'`; `req.user` con `sub`, `client_id` y `username`.
4. `COGNITO_USER_POOL_ID` obligatoria en todo entorno, con forma `<región>_<id>` y región igual a `AWS_REGION`; sin avisos relajados en `local` ni `test`.
5. Límite de peticiones al JWKS: el de `aws-jwt-verify` (caché y penalización), sin variables nuevas, con prueba comprobable (criterio de código 5).

## Riesgo explícito: este branch es el del PR contra master

`feature/sigmetum_v2` es el branch del PR contra `master`, y el CI del backend despliega `master` a `prod` automáticamente. `prod` no tiene pool de Cognito ni frontend con Hosted UI hasta `S18-prod`. Fusionar este branch a `master` antes de `S18-prod` rompería el login de `prod` y, como el branch lleva además las demás iteraciones acumuladas, el despliegue de `prod` entero (el backend no arrancaría sin `COGNITO_USER_POOL_ID`). Mitigación: la regla del aviso de PR (criterio de documentación 8). La salida concreta la decide el usuario, no esta spec.

## Criterios de aceptación

### De código

1. `POST /log`, su limitador de login, `userAuth`, la lista `users` y el uso de bcrypt y `jwt.sign` en `routes/auth.js` ya no existen. Observable: `POST /api/v1/log` responde `404` y la clasificación de rutas de `tests/estructura-rutas.test.js` no lo lista. El limitador de `POST /send-email` permanece y sus tests siguen pasando.
2. `config/validateEnv.js` ya no exige ni valida `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD`; el backend arranca sin ellas. Si siguen definidas en el entorno (caso de `prod`), no se usan ni dan error.
3. `COGNITO_USER_POOL_ID` está en `required` en **todo** entorno, también `local` y `test` (los tests la fijan en `tests/helpers/entorno.js`). Sin ella, o con un formato distinto de `<región>_<identificador>`, o con una región distinta de `AWS_REGION`, el backend no arranca (falla cerrado); no hay aviso relajado en `local` ni `test`, a diferencia de `TRUST_PROXY_HOPS`. Los mensajes nombran la variable y la regla, nunca el valor. Observable: casos en `tests/validate-env.test.js`.
4. `tokenAuth` acepta un token solo si: el `iss` es exactamente `https://cognito-idp.<región>.amazonaws.com/<COGNITO_USER_POOL_ID>` (región = prefijo del id); `token_use` es `access`; `exp` está vigente; la firma es RS256 con las claves públicas del JWKS de ese emisor, con caché y rotación de claves. El algoritmo permitido es RS256 fijo y nunca sale del cabecero del token. No se valida `aud` (el token de acceso no lo lleva) ni `client_id` ni grupos (C16). No hay enrutado por `alg` ni convivencia con HS256.
5. Límite de peticiones al endpoint de JWKS: un `kid` desconocido o un JWKS inaccesible no puede provocar una petición de red por cada petición entrante. Se cumple con la caché y la penalización de recargas de `aws-jwt-verify` (según la documentación de la librería hay una espera mínima entre recargas tras un fallo o un `kid` desconocido; **por confirmar** el valor por defecto y su comportamiento con el código instalado). No se añaden variables de entorno nuevas. Criterio comprobable: una prueba con JWKS simulado que cuente las peticiones y demuestre que N peticiones seguidas con un `kid` desconocido producen como máximo una petición al JWKS dentro de la ventana de espera; si la librería instalada no lo garantiza, se vuelve a la spec.
6. Un token inválido, de firma incorrecta, de otro emisor, de `token_use` distinto de `access` o caducado responde `401` con `{ success: false, error }`; sin cabecera o sin token, `401` con el mensaje actual. Si el JWKS no es accesible y no hay clave en caché, responde `503` con `{ success: false, error }` y un mensaje fijo. En ningún caso se devuelve el mensaje interno de la librería ni el token.
7. `req.user` contiene solo `sub`, `client_id` y `username` (identificadores públicos del token de acceso); nunca el token, `scope` ni grupos. `GET /auth` conserva `data: 'Authorized'`.
8. Pruebas sin AWS ni red (par RSA generado en el test y JWKS simulado), con estos casos mínimos: token válido; `iss` distinto; `token_use = id`; caducado; firma de otro par; `alg` HS256; `alg` `none`; `kid` desconocido; sin cabecera; JWKS inaccesible sin caché (`503`); `COGNITO_USER_POOL_ID` ausente, malformada o con región distinta de `AWS_REGION` (el arranque falla). Los tests existentes que firman HS256 se migran al nuevo esquema. `MIN_TESTS` de `scripts/quality-check.mjs` se sube al número real.
9. Dependencias. Se añade `aws-jwt-verify` como único verificador. Justificación: mantenida por empleados de AWS, Apache-2.0, sin dependencias propias, Node >= 18, verifica `iss`, `token_use`, `exp` y firma RS256 con caché y rotación de JWKS, y evita escribir criptografía propia; `jose` queda descartada por exigir más código propio para `iss`, `token_use` y la gestión de recargas. Versión comprobada con `npm view`: 5.2.1; la versión exacta instalada, la compatibilidad con Node 22 y el resultado de `npm audit` quedan **por confirmar** con `npm ls` y `npm audit` al implementar. `npm audit` sin `--force`, sin añadir vulnerabilidades altas ni críticas (M20 queda como estaba) y `package-lock.json` coherente con `package.json` (`npm ci` funciona). Se retiran de `dependencies` `jsonwebtoken` y `bcrypt` si nada más los usa (se vuelve a comprobar con búsqueda antes de retirarlas); los tests pueden firmar con `node:crypto`. `npm run lint`, `npm run quality`, `npm run docs:check` y `npm test` pasan.

### De documentación

1. `docs/03-configuracion.md` y `.env.example`: quitar las cuatro claves antiguas (y el comando de hash bcrypt); añadir `COGNITO_USER_POOL_ID` con su regla de formato y de región, y el comportamiento del arranque.
2. `docs/04-api.md` y `docs/05-modulos.md`: sin `POST /log`; nuevo verificador; `GET /auth` sin cambios; códigos `401` y `503`.
3. `docs/guias/seguridad.md` y `docs/guias/buenas-practicas-backend.md`: sustituir las referencias a JWT HS256, `JWT_SECRET` y login con bcrypt por el modelo Cognito; documentar el riesgo `C16` y su vía de salida.
4. `docs/integracion/para-frontend.md`: marcar el cambio como incompatible, retirar `POST /log` y la forma del token, describir el nuevo flujo, el `503` nuevo y el orden de despliegue (solo como documentación; este repositorio no edita el frontend).
5. `docs/integracion/para-infra.md`: variables nuevas y retiradas, `COGNITO_USER_POOL_ID` (obligatoria en todo entorno, región igual a `AWS_REGION`), coherencia de `ALLOWED_ORIGIN` con `cognito_callback_urls`, salida HTTPS al JWKS.
6. `docs/07-estado-y-deuda-tecnica.md`: fecha de hoy; B8, M15, A7, M12/D7 y M11 actualizados (ver más abajo); riesgo `C16` y riesgo de fusión a `master` registrados; cifras solo en la tabla de métricas.
7. Se avisa a `sigmetum-infra` de que el backend solo-Cognito existe (condición del paso 1 de su orden de despliegue, que hoy figura como "por confirmar").
8. El aviso de PR (`docs/specs/*-aviso-pr.md`) dice literalmente «NO fusionar a master hasta que prod tenga pool, frontend con Hosted UI y S18-prod hecho», explica el riesgo y lista las salidas posibles para el usuario, sin decidirlas: (a) dividir el PR sacando este cambio a otra rama; (b) fusionar con convivencia de verificadores (exigiría una spec nueva y contradice la decisión de infra). No se toca `.github/workflows/ci.yml`.

## Riesgo aceptado: C16 y vía de salida

El backend no valida `client_id` ni grupos: **cualquier usuario autenticado del pool es administrador**. Es aceptable solo con registro cerrado (`allow_admin_create_user_only = true`) y un pool que contenga solo administradores. Si entra un usuario que no deba administrar (otro cliente de aplicación en el mismo pool, un grupo no administrador), este diseño lo autoriza igualmente.

Vía de salida (fuera de alcance): validar el `client_id` esperado (exige `COGNITO_CLIENT_ID` en el backend y, en `dev`, separar el cliente en otro `apply`) y/o exigir un grupo `admin`. Es una spec nueva. `req.user` conserva `client_id` desde el principio; los grupos no se exponen (decisión del usuario).

## Hallazgos y elementos relacionados (efecto esperado)

- **B8** (algoritmo fijo): su sentido se conserva con RS256 fijo; se reescribe la prueba `jwt-algoritmo` para el nuevo verificador.
- **M15**: la validación de `JWT_SECRET`, `ADMIN_PASSWORD` y `JWT_EXPIRATION` desaparece con las variables; `COGNITO_USER_POOL_ID` se valida siempre de forma estricta. La nota "condición previa de despliegue: valores reales y `NODE_ENV` de Beanstalk" se actualiza.
- **A7** (login sin contraseña) y **F4**: sin objeto al desaparecer el login.
- **Limitador de login**: desaparece; el de `POST /send-email` permanece. `M12/D7` (`TRUST_PROXY_HOPS`) sigue vigente por él; la condición de infra `backend:I7` (antes de desplegar la entrega 2 de M21) no cambia. Las pruebas de `trust-proxy.test.js` y `limitadores.test.js` que usan `/log` necesitan otra ruta con límite.
- **Frontend D7** (distinguir el 429 del login) deja de aplicar al desaparecer el login; el 429 de `send-email` sigue.
- **S6 de infra** (secretos en propiedades de entorno): en `dev` solo queda `EMAIL_PASSWORD`; en `prod` se cierra con `S18-prod`.
- **M20**: dependencias preexistentes del `npm audit`; esta tarea no debe empeorarlas ni taparlas.

## Fuera de alcance

- Validar `client_id` o grupos (C16, vía de salida).
- Editar `sigmetum-frontend`, `sigmetum-infra` o `.github/workflows/ci.yml`; el login por Hosted UI, el refresco de tokens y la redirección con `cognito_callback_urls` son del frontend (se documentan, no se implementan).
- Crear usuarios o administradores del pool (procedimiento humano de infra).
- Corte de `prod` (`S18-prod`) y decidir cómo salir del riesgo de fusión.
- Cambios de rutas, formato de respuestas o CORS distintos de los descritos; refresco o revocación de tokens en el backend; logout.
- Resolver M20 o actualizar dependencias ajenas a este cambio.

## Impacto en contratos externos

- **`docs/integracion/para-frontend.md`: lo afecta, incompatible.** Quitar `POST /log` rompe el login actual (`LoginForm` y sus tests). Cambia el origen y la forma del token: hoy un JWT HS256 propio con `userId`, ahora un token de acceso de Cognito de 60 minutos (refresco de 8 horas, gestionado por el frontend). El frontend necesita: Hosted UI (compilación con `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID`), manejo del retorno en `/auth/callback`, envío del token de acceso (no el de identidad, que el backend rechaza) como `Bearer`, y renovación o redirección ante `401`; además, un `503` nuevo cuando el JWKS no es accesible. `GET /auth` sigue siendo la comprobación de sesión de `ProtectedRoute`. `Authorization` ya es una cabecera permitida; CORS no cambia salvo que `ALLOWED_ORIGIN` debe coincidir con los orígenes de `cognito_callback_urls` (sin barra final, comparación exacta).
- **`docs/integracion/para-infra.md`: lo afecta.** Variable nueva obligatoria `COGNITO_USER_POOL_ID` (la inyecta Terraform); cuatro variables retiradas de `required`; `ALLOWED_ORIGIN` coherente con Cognito. Un valor malformado o de región distinta de `AWS_REGION` impide el arranque. Sin permiso IAM nuevo: el backend solo lee un JWKS público por HTTPS, salida que debe seguir permitida (la de `dev` está abierta).
- **Orden de despliegue (infra, `dev`):** backend solo-Cognito listo, `apply` de infra (crea el pool), despliegue inmediato del backend, alta de dos administradores con TOTP y, después, el frontend. Con corte único hay una ventana sin login utilizable (backend nuevo sin frontend nuevo): aceptada en infra para `dev`; caída de minutos y sin vuelta atrás.
- **`prod`:** ver "Riesgo explícito".
- **Disponibilidad:** un JWKS inaccesible sin caché da `503` en las rutas protegidas; `/healthcheck` y las rutas públicas no dependen de él.

## Preguntas abiertas

Ninguna.

## Ajuste del 09/11/2026 tras la segunda opinión del plan

Comprobado con aws-jwt-verify@5.2.1 (instalada fuera del repo, Node 24.16): (1) el criterio 4 («iss exacto») se interpreta como «el iss del pool configurado en cualquiera de los dos formatos que emite Cognito y que acepta la librería: https://cognito-idp.<región>.amazonaws.com/<id> y https://issuer-cognito-idp.<región>.amazonaws.com/<id>» (decisión del usuario; riesgo bajo: mismo pool y misma clave); (2) el criterio 5 con el JWKS caído exige que el fetcher propio registre el fallo en la penalty box de la librería, porque la librería solo penaliza el kid no encontrado (decisión del usuario, opción A); (3) la regla de formato de COGNITO_USER_POOL_ID es la de la propia librería (un dígito de región; admite el prefijo eusc-).
