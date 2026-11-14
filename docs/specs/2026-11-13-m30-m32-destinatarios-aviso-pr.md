# Aviso para PR: M30, M31 y M32 (destinatarios del formulario de contacto, parte backend)

Fecha: 2026-11-13 · Spec y plan (en el repositorio del frontend, que lleva el ciclo): `sigmetum-frontend/docs/specs/2026-11/2026-11-13-fixes-y-deuda-varia-design.md` y `...-plan.md` (el «Anexo de la puerta 2» manda)

## Qué cambia

1. **M31**: `isValidEmailAddress` rechaza los caracteres Unicode de formato (`\p{Cf}`: U+200B, U+202E, U+200E...). `POST /send-email` la usa ahora para el correo: responde `400` `email is not valid` con esos caracteres. `POST /add-recipient` también. `HEADER_FORBIDDEN` y `EMAIL_PATTERN` no cambian. `maskEmail` sustituye cada `\p{Cf}` por `?` (`maskEmail('\u{202E}ana@example.com')` da `?***@example.com`), así que el aviso de cambio no reproduce caracteres invisibles ni de inversión de texto.
2. **M30**: `sanitizeRecipients` conserva solo las entradas con `email` cadena y válido (sin recortar antes). Solo las que quedan cuentan para el mínimo (1) y el máximo (5). Se sanea **solo al leer**: el fichero se reescribe sin las no válidas en la siguiente alta o baja. Un fichero con solo entradas no válidas se comporta como la lista vacía.
3. **M32**: `uniqueByEmail` (por `normalizeEmail`, primera aparición) en `sanitizeRecipients` y en `recipientsForContact`: `GET /list-recipients` no devuelve duplicados y `/send-email` no repite direcciones en `to`.
4. `scripts/quality-check.mjs`: `MIN_TESTS` 1825.

Cambio **compatible y más estricto**: mismas rutas, mismos cuerpos y mismos códigos; solo hay casos nuevos de `400` (`email is not valid`) y la lista devuelta es más corta si el fichero tenía entradas no válidas o repetidas. Sin variables de entorno, permisos IAM ni dependencias nuevas.

## Antes de desplegar

Sin requisitos nuevos. **El backend no condiciona el despliegue del frontend** (ni al revés): se puede desplegar antes o después. Sigue vigente el requisito del aviso anterior (`data/contact/recipients.json` con `[]` creado a mano).

## Decisiones y riesgos aceptados

- **Una entrada no válida editada a mano desaparece del panel y del fichero en la siguiente alta o baja** (misma carrera M1). Recuperable con el versionado de S3 **(por confirmar si está activo en `data/contact/`)**. Anotado como M35.
- **Límites de `\p{Cf}`** (M33): no cubre U+3164, U+115F, U+2800 ni U+034F, ni duplicados visuales NFC/NFD; rechaza U+200C y U+200D en dominios IDN y partes locales EAI.
- **Controles bidi en `username` y `subject`** (M34: U+202A a U+202E, U+2066 a U+2069, U+200E, U+200F, U+061C) siguen admitidos en el asunto que reciben los administradores.

## Integración

- Integración: contrato compatible y más estricto con el frontend (F20 en `docs/integracion/para-frontend.md`: `400` con caracteres de formato, lista saneada y sin duplicados). El frontend (otra PR) copia la regla `\p{Cf}` en el formulario y en el panel para mostrar el error concreto; no es requisito para desplegar.
- Infraestructura: sin impacto.

## Para quien revisa

- Código: `functions/validateContactMessage.js`, `functions/contactRecipients.js`, `scripts/quality-check.mjs`.
- Pruebas: `tests/destinatarios-reglas.test.js`, `tests/destinatarios-rutas.test.js` y `tests/send-email.test.js`.
- Cierre: `npm test`, `npm run lint`, `npm run quality`, `npm run docs:check` y `npm run docs:gate`.
