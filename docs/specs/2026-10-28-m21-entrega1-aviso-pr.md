# Aviso para PR: M21 entrega 1, mitigaciones de `content.js` (28/10/2026)

Spec: [2026-10-28-m21-tokenauth-rutas-publicas-design.md](2026-10-28-m21-tokenauth-rutas-publicas-design.md) · Plan: [2026-10-28-m21-tokenauth-rutas-publicas-plan.md](2026-10-28-m21-tokenauth-rutas-publicas-plan.md). Es la entrega 1 de 3: **no abre ninguna ruta**. Sin token, `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms` siguen dando `401`.

## Qué cambia (contrato)

- `POST /send-email`: puede responder `400` por formato o longitud (`username` ≤ 100, `subject` ≤ 150, `message` ≤ 2000, `email` ≤ 254 con la forma básica `algo@dominio.tld` (no RFC), sin caracteres de control en nombre, correo ni asunto y sin controles, salvo salto de línea y tabulador, en el mensaje; `a@b` y un correo con apóstrofo como `o'brien@example.com` se rechazan: **(por confirmar)** si el apóstrofo preocupa) y `429` al superar **5 peticiones cada 15 minutos por IP** (`{ success: false, error }`). Se envían los valores recortados. Resuelve M3.
- `GET /get-image` y `DELETE /delete-image`: `400` `imageKey is not valid` si la clave no cumple la regla (letras, números y marcas combinantes Unicode (nombres NFD) y `. _ - ( ) +` por segmento, `/` simple, hasta 200 caracteres, extensión jpg, jpeg, png, gif o webp; sin `..`, `/` inicial, `//`, espacios ni barra invertida). Regla: [06-almacenamiento-s3.md](../06-almacenamiento-s3.md#regla-de-imagekey).
- Código nuevo: `functions/validateImageKey.js`, `functions/validateContactMessage.js`, constantes `IMAGE_KEY_*` en `config/s3Paths.js`, `scripts/verificar-m21-entrega1.mjs`.
- Sin cambios en el envoltorio, las rutas, `fixedColumnOrder`, el JWT ni CORS. Sin variables de entorno ni dependencias nuevas (`package.json` y `.env.example` intactos).

## Frontend

Clasificación: **compatible, condicionada** (F7 de [para-frontend](../integracion/para-frontend.md)); si alguna condición no se confirma, es incompatible. Hoy los nuevos códigos solo se alcanzan con token, porque `tokenAuth` sigue interceptando (M21). Qué debe confirmar el equipo del frontend **(por confirmar)**:

1. (a) Las entradas reales cumplen las reglas: `ContactForm` no pone `maxLength`, así que un mensaje de más de 2000 caracteres recibirá `400`; las claves de la galería frente a la regla (ver GATE abajo).
2. (b) `ContactForm` muestra un error sin romperse ante `400` y `429` (su documentación dice que muestra un diálogo de éxito o de error; el código no se ha comprobado). Debe estar listo antes de la entrega 2.
3. (c) El panel de administración no envía a `DELETE /delete-image` claves que la regla rechace. El selector acepta `gif`, que se incluyó en la regla.
4. F6 sigue abierto: no se cierra hasta la entrega 2.

Orden de despliegue: **backend primero**; no hay prefijo nuevo. La entrega 2 no se abre sin esta.

## Infraestructura

[para-infra](../integracion/para-infra.md): sin variables de entorno ni permisos IAM nuevos. Pendiente **(por confirmar con infra)**: que `req.ip` sea la IP real del cliente tras nginx y el balanceador con `trust proxy 1`; si no, el cupo lo compartirían todos o no limitaría a nadie. Límites aceptados del limitador: almacén en memoria (se reinicia al desplegar y cada instancia lleva su contador, hasta 3 en prod), usuarios tras un mismo NAT comparten el cupo, y `express-rate-limit` 8.5.2 agrupa las IPv6 por subred /56 por defecto.

## Para el usuario

- **GATE del criterio 6 sin ejecutar (por confirmar)**: la sesión SSO local estaba caducada (`Token is expired`). Ejecuta `aws sso login` con el perfil de `AWS_PROFILE` y repite la pasada: cada `fileName` de `GET /list-images` debe pasar `isValidImageKey`. Las que no pasen son hallazgo (la regla no se relaja). Sin esto la entrega no está cerrada del todo.
- Desviación del plan: `IMAGE_KEY_PATTERN` es una expresión plana con lookaheads (`(?!.*\/\/)(?!.*\/[.\p{M}])`), no segmentos anidados, porque la versión anidada disparaba `security/detect-unsafe-regex` (6 avisos sobre el tope de 5). Misma regla. Límite conocido: `p{N}` acepta dígitos y letras numéricas de ancho completo.
- Condición previa de producción (comportamiento real de `list-terms`, `list-images` y `send-email` sin token): la comunica el usuario antes de la entrega 2.
- Prueba manual pendiente con SMTP real: un correo normal por `POST /send-email` con token.
- Deuda anotada: `max` está obsoleto en `express-rate-limit` 8 y `sendEmailLimiter` lo copia de `loginLimiter` (B6, prioridad baja).
- Verificación hecha: `node scripts/verificar-m21-entrega1.mjs` (todo pasa; los criterios 2 a 5 fallaban antes del cambio), `npm run lint` (0 errores, 5 avisos), `npm run quality` y `npm run docs:check` en verde.
