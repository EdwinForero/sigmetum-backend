# Integración con la infraestructura: lo que necesita el backend

Documento para quien mantiene `sigmetum-infra`. Explica **qué necesita este backend para arrancar y funcionar** en cada entorno. Sigue la convención de [../guias/mantenimiento.md](../guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).

- Lo verificado contra el código de Terraform está marcado **(verificado)**; lo que depende de la cuenta real de AWS, **(por confirmar)**.
- Fecha de la verificación: 30/09/2026 (actualizado 04/10/2026; backend solo-Cognito, sección 2, el 09/11/2026). Backend: rama `feature/sigmetum_v2`. Infraestructura: rama `feature/testing`, commit `f35dd3a`.
- No se han leído secretos ni `terraform.tfvars`: solo nombres de variables y los `.tfvars.example`.

## 1. Resumen

| Id | Problema | Efecto |
|---|---|---|
| ~~**I1**~~ | ~~`HealthCheckPath` de Beanstalk es `/`~~ | **Resuelto (feature/testing de infra)**: `HealthCheckPath = "/healthcheck"` en `modules/beanstalk/main.tf` **(verificado)** |
| ~~**I2**~~ | ~~No hay `trust proxy` configurado en el backend~~ | **Resuelto en el código (03/10/2026)**: `trust proxy` 1 (hoy en `app.js`, no en `index.js`; M13). Desde M12 (30/10/2026) el valor lo fija la variable opcional `TRUST_PROXY_HOPS` (sección 6). La cadena de proxies **no está confirmada**: ver la pregunta abierta en la sección 6. |
| ~~**I3**~~ | ~~`app_env_vars` no incluía `ALLOWED_ORIGIN`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD`~~ | **Resuelto (30/09/2026)**: los `.tfvars.example` de `dev` y `prod` incluyen todas las variables obligatorias más `PORT` **(verificado)** |
| ~~**I4**~~ | ~~dev sin HTTPS: contenido mixto con el frontend en Amplify~~ | **Resuelto (feature/testing de infra)**: `enable_cdn = true` en dev añade CloudFront como terminador HTTPS delante de Beanstalk; `backend_url` ya apunta a `module.beanstalk.backend_cdn_url` **(verificado)** |
| **I5** | No hay regla de grupo de seguridad explícita para la salida a `smtp.gmail.com:587` | Se asume la salida por defecto del VPC por defecto (normalmente abierta), pero no está verificado en el entorno real **(por confirmar)** |
| ~~**I6**~~ | ~~Sin pipeline de despliegue automatizado para el backend~~ | **Resuelto (04/10/2026)**: módulo `backend-ci-iam` en infra crea el rol OIDC para GitHub Actions; el workflow del backend ya despliega en Beanstalk automáticamente al hacer push a la rama de dev |
| **I8** | **Backend solo-Cognito (09/11/2026), cambio incompatible con infra y con el frontend.** El backend exige `COGNITO_USER_POOL_ID` en todo entorno y ya no usa las cuatro claves del login propio | `dev` ya no arranca sin el pool; **NO fusionar a `master` hasta que `prod` tenga pool, frontend con Hosted UI y `S18-prod` hecho** (el CI despliega `master` a `prod`). Detalle en la sección 2 |

## 2. Variables de entorno

Nombres únicamente; nunca valores reales. Fuente: `config/validateEnv.js` **(verificado)**.

**Condición previa de despliegue (M15, 09/11/2026), a cargo de infra.** `validateEnv` valida el valor de `COGNITO_USER_POOL_ID` (forma `<región>_<id>`, región igual a `AWS_REGION`) y **siempre falla cerrado**, también con `NODE_ENV` `local` o `test`: con un valor ausente, malformado o de otra región el backend **no arranca**. Las reglas de valor de `JWT_SECRET`, `ADMIN_PASSWORD` y `JWT_EXPIRATION` (M15, 28/10/2026) desaparecieron con las variables. Solo `TRUST_PROXY_HOPS` conserva la política estricta salvo `NODE_ENV` exactamente `local` o `test`. No se han visto valores reales de ninguna variable (por confirmar).

### Obligatorias en todos los entornos

| Variable | Secreto | Notas |
|---|---|---|
| `COGNITO_USER_POOL_ID` | No | **Nueva (09/11/2026), obligatoria en todo entorno.** La inyecta Terraform. Forma `<región>_<id>` y región **igual a `AWS_REGION`**; si no, el backend no arranca (sin aviso relajado en `local` ni `test`). Los valores reales no se escriben en este repositorio |
| `EMAIL` | Sí | Cuenta Gmail del formulario de contacto: remitente y, desde el 12/11/2026, **respaldo** de destino (ver el requisito de despliegue de la sección 4). Sin variables nuevas |
| `EMAIL_PASSWORD` | Sí | Contraseña de aplicación de Gmail, no la contraseña de la cuenta |
| `AWS_REGION` | No | `eu-west-3` en ambos entornos **(verificado)** |
| `AWS_BUCKET_NAME` | No | Debe coincidir con el bucket que crea `modules/storage` (`sigmetum-app-assets-dev` / `sigmetum-app-assets-prod`) |
| `ALLOWED_ORIGIN` | No (pero sensible: define quién puede llamar a la API) | Un origen exacto o una **lista separada por comas** (`app.js` divide por `,`, recorta espacios y compara cada origen de forma exacta), sin barra final; ver sección 5. Con Cognito debe coincidir con los orígenes de `cognito_callback_urls` |

### Solo en local (no aplica a Beanstalk)

| Variable | Notas |
|---|---|
| `AWS_PROFILE` | Perfil SSO; en Beanstalk el SDK usa el rol IAM de la instancia (sección 4) |

### Opcionales, con valor por defecto en el código

| Variable | Valor por defecto | Notas |
|---|---|---|
| `PORT` | `8000` | El `.tfvars.example` ya la fija en `8000`: coincide |
| `API_PREFIX` | `/api/v1` | No está en `app_env_vars` de ningún ejemplo; si no se define, el backend usa el valor por defecto, que es el esperado por el frontend |
| `TRUST_PROXY_HOPS` | `1` | **Nueva (M12, 30/10/2026), opcional y compatible**: sin ella el valor es 1 y el despliegue actual no cambia; sin permisos IAM ni endpoints nuevos. Entero de 1 a 5 (el `0` solo con `NODE_ENV` `local` o `test`); cualquier otro valor (vacía, `true`, lista, rango, decimal, negativo, mayor de 5, con espacios o ceros a la izquierda) hace que el backend **no arranque** en un entorno estricto. Se añade a `app_env_vars` de Terraform por entorno una vez medidos los saltos reales (sección 6); no se fija ningún valor por entorno en este cambio |
| `NODE_ENV` | (ninguno; cualquier valor que no sea `local` se trata como no-local) | Sin definir, `validateEnv` es estricto (M15), igual que con `production`; solo `local` y `test` se conforman con avisos. El valor real en Beanstalk **(por confirmar)**. No está en ningún `.tfvars.example`; conviene **no** definirlo como `local` en Beanstalk, porque activaría credenciales SSO (que no existen en la instancia) en vez del rol IAM |

### Backend solo-Cognito (09/11/2026): qué cambia para infra

- **Variable nueva obligatoria**: `COGNITO_USER_POOL_ID` (arriba). **Cuatro claves retiradas** de `required`: `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`. `prod` las conserva hasta `S18-prod` y el backend ni las lee ni las valida: no dan error aunque sigan definidas. Con ello `dev` ya puede arrancar sin ellas y de las propiedades de entorno con secretos (`S6` de infra) solo queda `EMAIL_PASSWORD` en `dev` (casi cerrado); en `prod` se cierra con `S18-prod`.
- **`ALLOWED_ORIGIN` = orígenes de `cognito_callback_urls`**, sin barra final y con comparación exacta (una lista separada por comas si hay varios). Si no coinciden, el navegador no puede llamar a la API tras el login de Hosted UI.
- **Lo que fija infra para el login** (tomado del `para-frontend.md` de infra, verificado por ellos en código; el efecto en AWS queda **por confirmar** hasta el `apply`): pool por entorno con registro cerrado y MFA TOTP obligatorio; cliente público sin secreto, flujo `code` con ámbitos `openid` y `email`; direcciones de retorno por cada origen del frontend (`site_origins`) con las rutas fijas `/auth/callback` (inicio) y `/` (cierre), sin `localhost`; tokens de acceso e id de 60 minutos y refresco de 8 horas; `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` solo en la rama de Amplify. **Al backend solo le llega `COGNITO_USER_POOL_ID`**: no necesita el dominio del Hosted UI ni el id del cliente, y por eso (C16) no valida `client_id`. Consecuencia para quien trabaja en local: el backend arranca con un id de pool con la forma correcta y la región de `AWS_REGION`, pero no hay forma de obtener un token real en `localhost`; las rutas protegidas se prueban con los tests, que simulan el JWKS.
- **Salida HTTPS al JWKS**: el backend lee un JWKS público en `https://cognito-idp.<región>.amazonaws.com/<id>/.well-known/jwks.json` (la región y el id del pool). Es salida por el puerto 443 hacia Internet; **sin permiso IAM nuevo**. La salida de `dev` está abierta; si `prod` la restringe, hay que permitirla. Si no es alcanzable y no hay clave en caché, las rutas protegidas dan `503` (el `/healthcheck` y las rutas públicas siguen funcionando).
- **Orden de despliegue en `dev`**: (1) backend solo-Cognito listo; (2) `apply` de infra, que crea el pool; (3) despliegue inmediato del backend; (4) alta de dos administradores con TOTP (procedimiento de infra, sin registro abierto); (5) después, el frontend con Hosted UI. Entre (3) y (5) hay una ventana sin login utilizable, aceptada para `dev` y sin vuelta atrás.
- **Riesgo C16**: el backend no valida `client_id` ni grupos, así que cualquier usuario del pool es administrador. Solo es aceptable con registro cerrado (`allow_admin_create_user_only = true`) y un pool de administradores; ver [seguridad](../guias/seguridad.md#c16-cualquier-usuario-del-pool-es-administrador).
- **ADVERTENCIA: NO fusionar a `master` hasta que `prod` tenga pool, frontend con Hosted UI y `S18-prod` hecho.** `feature/sigmetum_v2` es el branch del PR contra `master` y el CI despliega `master` a `prod`; `prod` no tiene pool ni frontend con Hosted UI hasta `S18-prod` y el backend no arrancaría sin `COGNITO_USER_POOL_ID`. Las salidas posibles las decide el usuario (ver el aviso de PR `docs/specs/2026-11-09-cognito-verificador-unico-aviso-pr.md`).
- **Aviso a `sigmetum-infra`**: el backend solo-Cognito existe en `feature/sigmetum_v2` (condición del paso 1 de su orden de despliegue, que figuraba como por confirmar). Este repositorio no escribe en el de infra: el aviso es esta sección y el aviso de PR.

**Estado de `app_env_vars` en los ejemplos (03/10/2026, verificado):** `dev` y `prod` incluían entonces todas las obligatorias de la época más `PORT` (I3 resuelto). Desde el 09/11/2026 las obligatorias son las de la tabla de arriba (el número vive en la tabla de métricas de [07](../07-estado-y-deuda-tecnica.md)): `app_env_vars` debe llevar `COGNITO_USER_POOL_ID` y ya no necesita las cuatro claves del login propio.

## 3. Plataforma y arranque

| Aspecto | Valor | Verificado |
|---|---|---|
| Runtime | Node.js 22 (`64bit Amazon Linux 2023 v6.11.9 running Node.js 22`) | Sí, en `modules/beanstalk/variables.tf` |
| Comando de arranque | `npm start` (`node index.js`), el que usa Beanstalk por convención para una app Node | Por confirmar: no hay un `Procfile` en este repositorio; Beanstalk infiere `npm start` de `package.json` |
| Puerto interno | `PORT` (8000 por defecto); Beanstalk enruta el puerto 80 externo hacia él | Sí (`app.listen(PORT)` en `index.js`, `Port = 80` en `modules/beanstalk/main.tf`) |
| `package.json` → `engines` | `"node": "22"` declarado **(resuelto 03/10/2026, B3)** | Sí |
| Health check | `GET /healthcheck` → `200 ok`, texto plano, sin auth ni CORS (se registra antes de esos middlewares) | Sí, en `index.js` |
| `HealthCheckPath` en Terraform | `/healthcheck` **(I1 resuelto)** | Sí, en `modules/beanstalk/main.tf` |
| Rutas no definidas (M21, entrega 3, 28/10/2026) | Todo lo que ningún router resuelve (incluida `/`) responde `404` JSON `{ success: false, error: "Not found" }` en vez del `404` HTML de Express: mismo estado. `/healthcheck` no cambia (se atiende antes). El `para-infra.md` del frontend aún cita `HealthCheckPath = "/"` (I6, resuelto en infra); si algún entorno desplegado siguiera apuntando a `/`, seguiría viendo `404`, ahora en JSON; que solo mire el código de estado y no el cuerpo está **(por confirmar con infra)**. No bloquea | Revisión, sin cambios |
| Despliegue | GitHub Actions (OIDC) → zip a S3 → `CreateApplicationVersion` → `UpdateEnvironment` **(I6 resuelto)**. El zip incluye `app.js` y excluye `tests/*`; el job `verify` ejecuta antes `npm test` y `npm audit --audit-level=high` | Sí, módulo `backend-ci-iam` en infra (el contenido real del zip en la CI está por confirmar) |

## 4. Permisos IAM sobre S3

Acciones que usa el código, deducidas de `aws/awsS3connect.js` **(verificado)**:

| Acción del SDK | Dónde se usa |
|---|---|
| `GetObjectCommand` / `s3.getObject` | Leer JSON activos, buffers de Excel, firmar URLs de imágenes |
| `s3.putObject` | Subir Excel, JSON activos, imágenes, el glosario, la lista de destinatarios del formulario de contacto |
| `s3.deleteObject` | Borrar versiones de Excel, imágenes, el JSON activo al quedar una provincia sin versiones |
| `ListObjectsV2Command` / `s3.listObjectsV2` | Listar versiones por provincia, listar la galería |
| `getSignedUrl` (firma local, no es una llamada de red aparte) | URLs prefirmadas de descarga, caducidad 3600 s |

**Lo que concede `modules/storage/main.tf`** (política `aws_iam_role_policy.beanstalk_s3`, verificado): `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` sobre el bucket y sus objetos. **Coincide exactamente** con lo que usa el código: no faltan ni sobran permisos.

- **Robustez de S3 (A5, A6, A8, M7, M10; 29/10/2026): sin cambios en variables de entorno ni en la política.** La paginación de los listados usa la misma acción `s3:ListBucket`. Desde A6 solo `NoSuchKey` equivale a «el glosario no existe»; sin `s3:ListBucket`, S3 responde `AccessDenied` (no `NoSuchKey`) cuando falta el objeto. **Estado tras S15 (30/10/2026): resuelto en el backend para `GET /list-terms`** (`AccessDenied` se trata como `[]`, solo en esa lectura), **no para las altas** (`POST /upload-term` y `DELETE /delete-term` siguen dando 500 con `AccessDenied` sin escribir; ver el punto de S15 más abajo). Que el perfil SSO local tenga `s3:ListBucket` sigue **(por confirmar)**.
- **A2 y A9 (29/10/2026): prefijo nuevo `data/drafts/{provincia}/` para los borradores de `POST /upload`; sin acciones ni permisos de S3 nuevos** (`GetObject`, `PutObject`, `DeleteObject`, `ListBucket`; la política de `modules/storage/main.tf` ya cubre todo el bucket) **y sin variables de entorno nuevas**. El chequeo de existencia del borrador y su descarte listan `data/drafts/{provincia}/`, así que dependen de `s3:ListBucket` (misma comprobación **(por confirmar)** del perfil SSO local que B9). Si el bucket tiene reglas de ciclo de vida por prefijo, `data/drafts/` queda disponible para una futura caducidad de borradores abandonados (no está configurada). Los borradores guardados antes del despliegue siguen en `data/{provincia}/` como versiones hasta que el administrador los borre.
- **B5 y B9 (29/10/2026): sin cambios en variables de entorno ni en la política.** Sin `s3:ListBucket`, S3 responde `AccessDenied` en vez de `NoSuchKey` ante una clave inexistente; desde S15 y M25 (30/10/2026) `GET /get-data` responde `404` también con `AccessDenied` (clave permitida), así que el `404` de B9 se ve igual con o sin ese permiso. El perfil SSO local sigue **(por confirmar)**.

- **S15 y M25 (30/10/2026): sin variables de entorno ni permisos nuevos; afecta al orden de despliegue y a una acción manual.** `sigmetum-infra` va a acotar `s3:ListBucket` por `Prefix` (`gallery/*` y `data/*`, infra:S7); con esa política S3 probablemente responderá `403 AccessDenied` (no `404 NoSuchKey`) ante una clave inexistente. Qué código devuelve S3 en dev con la política nueva está **(por confirmar)**. Permisos que necesita el backend: `GetObject`, `PutObject`, `DeleteObject` y `ListBucket` con `Prefix` en `gallery/` y `data/` (que todos los listados lleven `Prefix` en ese ámbito: **por confirmar**).
  - **Estado de infra:S15:** resuelto en el backend para `GET /list-terms` (200 `[]` con `NoSuchKey` y con `AccessDenied`); **no resuelto para las altas** (`POST /upload-term` y `DELETE /delete-term` propagan `AccessDenied`: `500` sin escribir, para que un permiso roto no sobrescriba el glosario).
  - **Mitigación temporal (acción manual de operaciones, por confirmar quién):** subir un `[]` a `data/terms/noLatinTerms.json` en dev y en prod. Es **necesaria para poder dar de alta el primer término** (hasta entonces el primer alta falla con `500`); **no es necesaria para `GET /get-data`**, que ahora da `404` con `AccessDenied`.
  - **Orden de despliegue:** primero el backend con este cambio y después el `apply` de infra. Con el `apply` antes, `GET /list-terms` daría `500` sin glosario creado.
  - `GET /get-data` ahora valida la clave y responde `400` sin llamar a S3 si no es una versión ni un activo (ver [para-frontend](para-frontend.md)).
- **Lista de destinatarios del formulario de contacto (12/11/2026): sin variables de entorno ni permisos nuevos (`GetObject` y `PutObject` ya cubiertos), pero con un requisito de despliegue manual.**
  - **Antes de desplegar este backend en cada entorno (dev y prod), una persona sube `[]` a `data/contact/recipients.json`** (quién: **por confirmar**). Sin el fichero, S15 da `AccessDenied` (la política con `s3:ListBucket` acotado por `Prefix` hace que S3 no distinga «no existe» de «sin permiso»; qué código devuelve en cada entorno: **por confirmar**) y la lista no lo tolera: `GET /list-recipients`, `POST /add-recipient` y `DELETE /delete-recipient` responden `500` sin escribir, y `POST /send-email` sigue enviando, pero a `EMAIL` con el asunto `[Aviso: lista de destinatarios no disponible] `. La lectura de la lista en `/send-email` tiene un plazo de 4 segundos (`RECIPIENTS_READ_TIMEOUT_MS`): si S3 no responde, el mensaje cae igual a `EMAIL` (registro `TimeoutError`); el cliente S3 sigue sin `requestTimeout` propio.
  - **Vigilar el buzón `EMAIL`**: es el destino de respaldo (lista vacía, sin direcciones válidas o ilegible) y recibe también los avisos de cambio de la lista cuando esta estaba vacía.
  - Sin cambios en el rol IAM ni en `app_env_vars`. La lista guarda correos del personal en el bucket de datos (S10).
- El rol se asigna por nombre fijo (`aws-elasticbeanstalk-ec2-role`), no por referencia al recurso del rol: si ese nombre cambia en el futuro, esta política deja de aplicarse sin que Terraform avise **(verificado, es una observación sobre el propio Terraform, no un hallazgo del backend)**.
- Sin local: en Beanstalk no hay `AWS_PROFILE`; el SDK usa la cadena de credenciales por defecto, que resuelve al rol de la instancia (`IamInstanceProfile = aws-elasticbeanstalk-ec2-role` en `modules/beanstalk/main.tf`).

## 5. Bucket, región y orígenes

| Aspecto | Valor |
|---|---|
| Nombre del bucket | `sigmetum-app-assets-dev` / `sigmetum-app-assets-prod` (debe coincidir con `AWS_BUCKET_NAME`) |
| Región | `eu-west-3` en los dos entornos **(verificado)** |
| Acceso público | Bloqueado (`block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets` todos `true`) **(verificado)**. Correcto: el backend sirve todo por URL prefirmada o por la propia API, nunca por acceso directo al bucket |
| Cifrado | AES256 en reposo **(verificado)** |
| Versionado | Activado **(verificado)**; relevante para el hallazgo interno A1 (una versión sobrescrita por el fallo de zona horaria se podría recuperar desde el historial de versiones de S3) |
| Prefijos que usa el código | `gallery/`, `data/`, `data/active/`, `data/terms/`, `data/drafts/` (constantes en `config/s3Paths.js`). No requieren ninguna configuración especial del bucket: son solo convenciones de clave |

**`ALLOWED_ORIGIN` por entorno:**

`ALLOWED_ORIGIN` acepta **una lista de orígenes separados por coma**. El backend los divide, elimina espacios y permite el acceso si el origen del request está en la lista o si no hay origen (llamadas server-side). Formato: `https://a.com,https://b.com` (sin barra final, sin espacios extra). **Desde el 28/10/2026 (M22)** un origen no permitido recibe `403` `Origin not allowed` (antes `500` con el origen reflejado) y el backend registra `CORS: origin not allowed: "<origen>"` con `console.warn`. El valor y el formato de `ALLOWED_ORIGIN` no cambian; no hay variables, permisos IAM ni endpoints nuevos. **(Por confirmar con infra)**: si hay monitorización o alarmas por `500` que contaran las peticiones CORS rechazadas, dejarán de contarlas (ahora son `403`), y los mensajes de error de producción ya no revelan detalles internos, solo la consola.

| Entorno | Qué poner en `ALLOWED_ORIGIN` | Estado |
|---|---|---|
| `dev` | URL(s) de las ramas activas en Amplify, separadas por coma; deben ser **las mismas** que `cognito_callback_urls` (sin barra final) | Por fijar tras conocer las URLs de Amplify |
| `prod` | El dominio del frontend en `prod` (aún no existe, infra:C9) | Por fijar tras crear el dominio |

## 6. Detrás del balanceador

| Aspecto | Estado |
|---|---|
| `trust proxy` | `app.set('trust proxy', resolveTrustProxyHops().value)` en `app.js` (M12): vale `TRUST_PROXY_HOPS` y 1 si no se define. **Pregunta abierta a infra (por confirmar)**: la cadena no está clara. El comentario anterior de `app.js` decía "ALB → nginx (loopback) → Express" con 1 salto; este documento decía "nginx (loopback) → Express"; la spec de M12 supone CloudFront → nginx → Express en dev y preprod y ALB → nginx → Express en prod. Ninguna está verificada. |
| Medir los saltos reales (guía, **por confirmar con infra**) | Desde un cliente de IP conocida, **sin enviar `X-Forwarded-For` propio**, observar la cabecera `X-Forwarded-For` y la dirección del socket que llegan a Express. Valor = entradas de `X-Forwarded-For` que añaden los proxies, más uno por el proxy que conecta directamente con Express (nginx). Comprobar que con ese valor `req.ip` es la IP del cliente conocido. |
| Tabla cadena → valor (**por confirmar con infra**; no se fija ningún valor por entorno) | La regla es la misma en todas las cadenas: **entradas de `X-Forwarded-For` que añaden los proxies más uno**. CloudFront → nginx → Express: depende de si CloudFront y nginx añaden su entrada. ALB → nginx → Express: depende de si el ALB y nginx la añaden. nginx → Express (la que describía este documento): depende de si nginx añade la entrada. El valor concreto de cada una lo mide infra. |
| Valor distinto del real | **Mayor** que los saltos reales: Express toma como IP del cliente un elemento de `X-Forwarded-For` que el cliente puede escribir; con IP inventadas obtiene un cupo nuevo por petición y esquiva el límite de `/send-email` (5 por 15 min). **Menor**: `req.ip` es la IP de un proxy intermedio y todos comparten un único cupo (un cliente puede bloquear el formulario de contacto). **Limitación de Express**: con un valor mayor que los saltos reales, o con más saltos que entradas en la cabecera, `req.ip` es lo que controla el cliente (con 5 saltos y una sola entrada, `req.ip` es esa entrada; comprobado con Express 4.22.3). Por eso el tope es 5 y hay que medir antes de fijarla. |
| Hueco heredado de M15 | Con `NODE_ENV=test` en un despliegue, `validateEnv` solo avisa: se admitiría `0` y los valores inválidos de `TRUST_PROXY_HOPS`. No definir `NODE_ENV` como `local` ni `test` en Beanstalk. |
| Límite de `POST /send-email` (M21 entregas 1 y 2, 28/10/2026) | 5 peticiones cada 15 minutos por IP (`express-rate-limit` 8.5.2; es el único limitador desde que se retiró el login). **Desde la entrega 2 la ruta es pública (sin token), así que el cupo lo consume cualquier visitante anónimo y también cuentan los `400`.** **Obligatorio ANTES DE DESPLEGAR, aún sin hacer (por confirmar con infra)**: confirmar cuántos saltos de proxy hay entre el cliente y Express. El comentario anterior de `app.js` decía "ALB → nginx → Express" con `trust proxy 1`, y este documento describía "nginx (loopback) → Express"; las dos descripciones no coinciden (pregunta abierta, fila `trust proxy`). Desde M12 el valor se fija con `TRUST_PROXY_HOPS`; la condición sigue abierta hasta que infra mida los saltos y fije la variable. Si hay un salto más de los que cuenta `trust proxy 1`, `req.ip` sería la IP del proxy intermedio para todos los clientes y un solo cliente podría agotar el cupo de 5 por 15 minutos para todos; si hay uno menos, la cabecera `X-Forwarded-For` se podría falsificar y no se limitaría a nadie. Si el resultado exige un valor distinto de 1, se fija `TRUST_PROXY_HOPS` (M12), sin cambiar código. Resultado de la confirmación: **(por confirmar)**. Depende de `trust proxy 1`: que `req.ip` sea el cliente real detrás de nginx y el balanceador está **(por confirmar con infra)** en producción; si llegara la IP del proxy, el cupo lo compartirían todos los usuarios, y si se pudiera falsificar la cabecera, no limitaría a nadie. **Almacén en memoria** (`MemoryStore`, el de por defecto): el contador se reinicia al reiniciar o desplegar y cada instancia (1 a 3 en prod) lleva el suyo, así que el tope real por IP es de hasta 5 por instancia. **Usuarios tras un mismo NAT** (oficina, universidad) comparten el cupo. **IPv6**: la versión instalada agrupa por defecto las direcciones IPv6 por subred /56 (opción `ipv6Subnet`, valor por defecto 56; leído en `node_modules/express-rate-limit/dist/index.cjs`, no probado con tráfico real), de modo que varias direcciones de una misma /56 comparten cupo; las IPv4 mapeadas en IPv6 se tratan como IPv4. Sin variables de entorno ni permisos IAM nuevos |
| HTTPS | `prod` usa ALB con `ssl_certificate_arn` (HTTPS en el 443); `dev` usa CloudFront como terminador HTTPS delante de Beanstalk (`enable_cdn = true`) **(I4 resuelto)** |
| Salida SMTP (`smtp.gmail.com:587`) | Sin regla de grupo de seguridad específica en el módulo `beanstalk`; se asume la salida por defecto del grupo del VPC por defecto **(por confirmar)** |
| Memoria e instancia | `t3.nano` (0.5 GiB de RAM) en los dos entornos, 1 a 3 instancias en prod, 1 fija en dev. El backend carga los Excel enteros en memoria (`multer` limita la subida a 10 MB en `/upload` y 5 MB en `/upload-image` desde el 28/10/2026, M6; el `.xlsx` sigue descomprimiéndose en memoria, M9): con `t3.nano`, un Excel grande sigue siendo un riesgo de memoria. Que el proxy no imponga un límite de cuerpo menor **(por confirmar)** |

## 7. Tabla de discrepancias

Ver el resumen de la sección 1. Estado y responsable:

| Id | Responsable | Acción |
|---|---|---|
| ~~**I1**~~ | ~~Infraestructura~~ | **Resuelto (feature/testing de infra)**: `HealthCheckPath = "/healthcheck"` en `modules/beanstalk/main.tf` |
| ~~**I2**~~ | ~~Backend~~ | **Resuelto en el código (03/10/2026)**: `trust proxy` 1, hoy en `app.js` y configurable con `TRUST_PROXY_HOPS` (M12) |
| **I7** | Infraestructura | Medir los saltos reales de proxy en dev, preprod y prod, confirmar la cadena y fijar `TRUST_PROXY_HOPS` en `app_env_vars` antes de la entrega 2 de M21 **(por confirmar con infra)** |
| ~~**I3**~~ | ~~Ambos~~ | **Resuelto (30/09/2026)**: `app_env_vars` incluye todas las obligatorias en los `.tfvars.example` |
| ~~**I4**~~ | ~~Infraestructura y frontend~~ | **Resuelto (feature/testing de infra)**: CloudFront (`enable_cdn = true`) termina HTTPS en dev |
| **I5** | Infraestructura | Confirmar que el grupo de seguridad del VPC por defecto permite salida a `smtp.gmail.com:587` **(por confirmar en la cuenta real)** |
| ~~**I6**~~ | ~~Infraestructura~~ | **Resuelto (04/10/2026)**: módulo `backend-ci-iam` + GitHub Actions workflow; el CI despliega automáticamente en Beanstalk |
| **I8** | Infraestructura (y usuario para la fusión) | Pasar `COGNITO_USER_POOL_ID` en `app_env_vars` de `dev` tras el `apply` que crea el pool; `ALLOWED_ORIGIN` igual a `cognito_callback_urls`; mantener la salida HTTPS al JWKS; no fusionar a `master` hasta `S18-prod` (sección 2) |

## 8. Si cambias algo en la infraestructura

| Si cambias... | El backend debe revisar... |
|---|---|
| El nombre del bucket | `AWS_BUCKET_NAME` en `app_env_vars` de ese entorno |
| El rol IAM de la instancia (nombre o permisos) | Que siga permitiendo `GetObject`, `PutObject`, `DeleteObject`, `ListBucket` sobre el bucket (sección 4) |
| `HealthCheckPath` | Que coincida con `/healthcheck` (I1) |
| El balanceador (de `single` a `application`, o el certificado) | `ALLOWED_ORIGIN` sigue siendo el origen correcto; si pasa a HTTPS, avisar al frontend |
| La cadena de proxies (añadir o quitar CloudFront, ALB o nginx, o un cambio de lo que añaden a `X-Forwarded-For`) | `TRUST_PROXY_HOPS` de ese entorno (sección 6): un valor distinto del real esquiva el límite de intentos o lo comparte entre todos |
| El tipo de instancia | Revisar el límite de tamaño de `multer` (10 MB y 5 MB; sección 6) |
| `app_env_vars` | Que siga cubriendo la tabla de la sección 2 (obligatorias, incluida `COGNITO_USER_POOL_ID`) |
| El pool de Cognito (id, región, callbacks) o el cliente de aplicación | `COGNITO_USER_POOL_ID` (región igual a `AWS_REGION`) y `ALLOWED_ORIGIN` (igual a `cognito_callback_urls`); si se añaden clientes o grupos al pool, revisar C16 (el backend los autoriza a todos) |
| El dominio de `prod` o de `dev` | `ALLOWED_ORIGIN` de ese entorno, y avisar al frontend si cambia la URL que consume |

## 9. Cómo mantener este documento

- Se actualiza en el mismo commit que cambia `config/validateEnv.js` (variables), `config/s3Paths.js` (prefijos) o `aws/awsS3connect.js` (acciones de S3), siguiendo [../guias/mantenimiento.md](../guias/mantenimiento.md).
- Las discrepancias `I1` a `I7` se verifican contra el código de `sigmetum-infra` y se quitan de la tabla de la sección 7 cuando se resuelven allí, pasando a una línea del historial de [../07-estado-y-deuda-tecnica.md](../07-estado-y-deuda-tecnica.md).
- Si `sigmetum-infra` cambia `modules/beanstalk`, `modules/storage` o los `.tfvars.example`, se revisa este documento entero, no solo la sección que parece afectada.
