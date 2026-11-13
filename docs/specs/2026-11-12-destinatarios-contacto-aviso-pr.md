# Aviso para PR: destinatarios del formulario de contacto (BL1, parte backend)

Fecha: 2026-11-12 · Spec y plan (en el repositorio del frontend, que lleva el ciclo): `sigmetum-frontend/docs/specs/2026-11/2026-11-12-backlog-bl1-bl4-deuda-design.md` y `...-plan.md`

## Qué cambia

1. **Tres rutas protegidas nuevas**: `GET /list-recipients`, `POST /add-recipient` y `DELETE /delete-recipient`, con `tokenAuth` también en la lectura. Lista de 1 a 5 correos, sin duplicados (sin distinguir mayúsculas ni espacios) y con la regla de formato de `/send-email`. Mensajes fijos que no reflejan el correo recibido. Alta y baja con un limitador de 10 cambios cada 15 minutos por IP (`429`, compartido entre las dos).
2. **`POST /send-email` cambia de destino**: un solo envío con `to` en array a la lista de `data/contact/recipients.json`; con la lista vacía o sin direcciones válidas, a `EMAIL` como hasta ahora; si la lista **no se puede leer o S3 no responde en 4 segundos** (`RECIPIENTS_READ_TIMEOUT_MS`, el registro fijo lleva `TimeoutError`), a `EMAIL` con el asunto `[Aviso: lista de destinatarios no disponible] ` y un registro fijo. Mismo cuerpo, mismas respuestas.
3. **Aviso por correo** de cada alta o baja a los destinatarios de la lista **anterior** (o a `EMAIL`), con la dirección enmascarada, texto fijo en español, sin la lista completa ni el autor; no se espera al envío y su fallo no cambia la respuesta.
4. `data/contact` pasa a `RESERVED_SEGMENTS` (`GET /list-files` no lo lista; `contact` no puede ser provincia). `scripts/quality-check.mjs`: `MIN_TESTS` 1775 y centinela «doce rutas».

Cambio **compatible**, sin `/api/v2`, sin variables de entorno, permisos IAM ni dependencias nuevas.

## Antes de desplegar (requisito)

1. **Orden de despliegue: primero este backend, después el frontend** (que va en **otra PR**).
2. **Crear a mano `data/contact/recipients.json` con `[]` en cada entorno (dev y prod) ANTES de desplegar este backend** (quién: **por confirmar**). Sin él, con la política de S3 acotada por `Prefix` (S15) `GetObject` da `AccessDenied` y la lista no lo tolera: el listado, el alta y la baja dan `500` sin escribir, y `/send-email` cae a `EMAIL` con el asunto marcado.
3. **Vigilar el buzón `EMAIL`**: es el respaldo y recibiría los mensajes de contacto si la lista falla.

## Decisiones y riesgos aceptados

- **C16 (cualquier usuario del pool es administrador) sigue y su impacto crece**: cualquiera del pool puede redirigir los mensajes de contacto (datos personales) a una dirección propia. El aviso por correo y el limitador lo **detectan o frenan, no lo impiden**; el modelo de autorización no cambia.
- **Carrera M1**: la lista se reescribe entera; una baja perdida deja una dirección (quizá maliciosa) sin aviso. Mitigación futura: `If-Match` en la escritura.
- **Los destinatarios se ven entre sí** (S10): «Responder a todos» enseña al visitante hasta 4 direcciones del personal. Mitigación: pedir que usen «Responder». `replyTo` se mantiene.
- `GET /list-recipients` sin fichero devuelve `[]`, no `[EMAIL]`: la dirección del servidor no sale de él.
- Hallazgos bajos de la segunda opinión, sin corregir, anotados en `docs/07-estado-y-deuda-tecnica.md` como M30 (`sanitizeRecipients` conserva entradas no válidas que cuentan para el mínimo y el máximo), M31 (`isValidEmailAddress` no rechaza `\p{Cf}`: duplicados visuales y falseo en el aviso) y M32 (`recipientsForContact` no deduplica).
- La IP del limitador depende de `trust proxy` (M12, saltos reales **por confirmar con infra**).

## Integración

- Integración: contrato nuevo con el frontend (F19 en `docs/integracion/para-frontend.md`: rutas, cuerpos, respuestas, `401`/`400`/`404`/`429`/`500`, límites 1 y 5, `tokenAuth` en la lectura). El frontend aún no usa las rutas **(por confirmar)**; su panel va en otra PR.
- Infraestructura: sin variables ni permisos nuevos; sí el requisito manual del fichero inicial y la vigilancia del buzón `EMAIL` (`docs/integracion/para-infra.md`, sección 4).

## Para quien revisa

- Código: `functions/contactRecipients.js` (nuevo), `functions/validateContactMessage.js` (`isValidEmailAddress`), `config/s3Paths.js`, `routes/content.js`, `scripts/quality-check.mjs`.
- Pruebas: `tests/destinatarios-reglas.test.js` y `tests/destinatarios-rutas.test.js` (nuevos) y ampliados `estructura-rutas`, `rutas-protegidas`, `send-email`, `validadores`, `provincia`, `rutas-publicas` y `helpers/simulados.js`.
- Cierre: `npm test`, `npm run lint`, `npm run quality`, `npm run docs:check` y `npm run docs:gate`.
