# Aviso para PR: backend solo-Cognito (verificador único de tokens de acceso)

Fecha: 2026-11-09 · Spec: [design](2026-11-09-cognito-verificador-unico-design.md) · Plan: [plan](2026-11-09-cognito-verificador-unico-plan.md)

## NO fusionar a master hasta que prod tenga pool, frontend con Hosted UI y S18-prod hecho

`feature/sigmetum_v2` es el branch del PR contra `master`, y el CI del backend despliega `master` a `prod` automáticamente. `prod` no tiene pool de Cognito ni frontend con Hosted UI hasta `S18-prod`. Fusionar este branch antes rompería el login de `prod` y, como el backend no arranca sin `COGNITO_USER_POOL_ID`, el despliegue entero de `prod`. Además el branch lleva todas las demás iteraciones acumuladas, no solo esta.

Salidas posibles (las decide el usuario; este aviso no decide ninguna):

- **(a) Dividir el PR**, sacando este cambio a otra rama para que el resto del branch pueda fusionarse sin él.
- **(b) Fusionar con convivencia de verificadores** (el HS256 antiguo junto al de Cognito): exigiría una spec nueva y contradice la decisión de infra de corte único.

No se toca `.github/workflows/ci.yml`.

## Qué cambia

El backend deja de tener login propio y verifica **solo tokens de acceso de Cognito** (`aws-jwt-verify` 5.2.1, versión exacta). Cambio **incompatible** con el frontend y con infra, sin `/api/v2` (decisión del usuario).

- `POST /log` desaparece (ahora `404`), con su limitador de login, `userAuth`, bcrypt y `jwt.sign`. `GET /auth` conserva `data: "Authorized"`.
- `tokenAuth` acepta un token solo si el emisor es el del pool (`COGNITO_USER_POOL_ID`), `token_use` es `access`, `exp` es numérico finito y vigente, y la firma es RS256 con el JWKS del pool. `req.user` lleva solo `sub`, `client_id` y `username`.
- Códigos: `401` `No token provided` / `Invalid token` / `Token expired`, y `503` `Authentication service unavailable` (texto fijo) si no se puede obtener el JWKS.
- `COGNITO_USER_POOL_ID` es obligatoria en todo entorno (forma `<región>_<id>`, región igual a `AWS_REGION`; falla cerrado también en `local` y `test`). `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` ya no se exigen, ni se leen ni se validan. Se retiran `jsonwebtoken` y `bcrypt`.

## Decisiones y límites a conocer

- **Límite de peticiones al JWKS**: la librería solo penaliza cuando el JWKS carga y el `kid` no está; un fallo de red no penaliza. El verificador usa un fetcher propio que envuelve al de la librería y registra ese fallo en su penalty box: con el JWKS caído y sin caché, las peticiones siguientes dan `503` sin ir a la red.
- **Penalización por URI de 10 s (no por `kid`)**: un `kid` falso enviado por cualquiera provoca hasta 10 s de `503` a los `kid` **nuevos** (por ejemplo, tras una rotación de claves de Cognito, infrecuente); los ya cacheados no se ven afectados. El frontend debe **reintentar el `503`**, no tratarlo como sesión caducada.
- **`iss` en dos formatos** del mismo pool y la misma clave (`cognito-idp` e `issuer-cognito-idp`), como acepta la librería. Otra región u otro pool dan `401`.
- La regla de formato del pool es la de la librería (un dígito de región; admite el prefijo `eusc-`).
- `JwksValidationError` (JWKS cargado pero inválido) da `503` pero no penaliza (límite documentado).
- Node 22 **(por confirmar)**: solo se probó con Node 24.16.
- **C16 aceptado**: cualquier usuario del pool es administrador (no se valida `client_id` ni grupos). Válido solo con registro cerrado y un pool de administradores. Vía de salida (spec nueva): `COGNITO_CLIENT_ID` y/o grupo `admin`.

## Qué debe hacer el frontend (`sigmetum-frontend`)

El frontend de hoy usa `POST /log` y no tiene Cognito: deja de funcionar al desplegar este backend.

1. Hosted UI (variables de compilación que defina el frontend, sin valores en este repositorio) y manejo del retorno en el callback.
2. Enviar el **token de acceso** (no el de identidad, que se rechaza) como `Authorization: Bearer`.
3. Ante `401`, renovar con el refresco (acceso 60 min, refresco 8 h) o redirigir a login; el `503` es reintentable.
4. `GET /auth` sigue siendo la comprobación de sesión de `ProtectedRoute`.
5. `frontend:D7` (429 del login) deja de aplicar; el 429 de `POST /send-email` sigue.

Detalle: `docs/integracion/para-frontend.md` (F18).

## Qué debe hacer infra (`sigmetum-infra`)

1. `COGNITO_USER_POOL_ID` obligatoria en `app_env_vars` de cada entorno (región igual a `AWS_REGION`). Las cuatro claves retiradas: `prod` las conserva hasta `S18-prod` y el backend no las usa.
2. `ALLOWED_ORIGIN` igual a los orígenes de `cognito_callback_urls` (sin barra final).
3. Salida HTTPS al JWKS del pool (`https://cognito-idp.<región>.amazonaws.com/<id>/.well-known/jwks.json`), sin permiso IAM nuevo.
4. Orden en `dev`: backend listo, `apply` de infra (crea el pool), despliegue inmediato del backend, alta de dos administradores con TOTP y después el frontend. Hay una ventana sin login utilizable, aceptada y sin vuelta atrás.
5. Este aviso y `docs/integracion/para-infra.md` (I8) son la comunicación de que el backend solo-Cognito existe. `S6` queda casi cerrado en `dev` (solo `EMAIL_PASSWORD`).

## Integración

- **Frontend**: afectado, incompatible (arriba).
- **Infraestructura**: afectada (variable nueva obligatoria, cuatro retiradas, `ALLOWED_ORIGIN`, salida al JWKS, orden de despliegue y riesgo de fusión).

## Para quien revisa

- Código: `middleware/tokenAuthentication.js`, `routes/auth.js`, `config/validateEnv.js`, `.env.example`, `package.json` y `package-lock.json`, `scripts/quality-check.mjs` (`PUBLIC_MUTATING_ROUTES` y `MIN_TESTS`). Todas son áreas de contrato: revisada la sección 6 de `docs/guias/mantenimiento.md`.
- Pruebas: `tests/cognito-verificador.test.js`, `tests/cognito-jwks.test.js` y `tests/helpers/cognito.js` (nuevos), `tests/validate-env.test.js` y `tests/jwt-algoritmo.test.js` reescritos, y el resto de suites migradas.
- Residuo: `.github/dependabot.yml` conserva una regla `ignore` de `bcrypt` sin objeto (B13 en `docs/07-estado-y-deuda-tecnica.md`); no se toca.
- Documentos: `docs/01` a `docs/05`, `docs/README.md`, las tres guías, `docs/integracion/para-frontend.md`, `docs/integracion/para-infra.md` y `docs/07-estado-y-deuda-tecnica.md`.
