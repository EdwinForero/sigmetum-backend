# M20 npm audit fix sin --force: spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

`npm run quality` falla por avisos de `npm audit --omit=dev` publicados después de M16 (ver M20 en [07](../07-estado-y-deuda-tecnica.md)): uno alto (`body-parser`), uno crítico (`proxy-addr`) y moderados (`ip-address`, `nodemailer`, `qs`). Hay que resolver los que tienen arreglo sin `--force` actualizando `package-lock.json`, dejar [02](../02-tecnologias.md) con las versiones instaladas y devolver `quality` a verde.

## Criterios de aceptación

### De código

1. `npm audit --omit=dev` ya no lista `body-parser`, `proxy-addr`, `ip-address`, `nodemailer` ni `qs`.
2. `npm audit --omit=dev` solo conserva el aviso moderado de `uuid` vía `exceljs`.
3. `npm run quality` termina sin problemas (sin avisos alto/crítico; `ACCEPTED_ADVISORIES` sigue vacío).
4. `npm run lint` y `npm run docs:check` pasan.
5. El arranque (`npm start`) y `GET /healthcheck` responden igual que antes.
6. Se ejecutó sin `--force`: `git diff` solo muestra cambios en `package-lock.json` y, si el arreglo lo exige, en rangos de `package.json`.
7. `npm ls` confirma las versiones resultantes de `express`, `body-parser`, `proxy-addr`, `qs`, `nodemailer` e `ip-address`.

### De documentación

1. [02](../02-tecnologias.md) recoge las versiones instaladas tras el cambio (en la tabla, las dependencias directas que cambien, p. ej. `express`, `nodemailer`).
2. [07](../07-estado-y-deuda-tecnica.md): M20 pasa a resuelto (con fecha y, tras el commit, hash) salvo `uuid`/`exceljs`, que queda como deuda abierta; se actualizan la fecha "actualizado" y las métricas si cambian; se actualiza el punto de "siguientes pasos" que cita M20.
3. Se resuelve la marca **(por confirmar)** de M20 sobre la gravedad real en este uso, o se mantiene con motivo.

## Fuera de alcance

- `uuid`/`exceljs` (solo arreglable con `npm audit fix --force`, cambio incompatible).
- Usar `--force`, o cambios mayores de dependencias.
- Añadir excepciones en `ACCEPTED_ADVISORIES`.
- Avisos de dependencias de desarrollo.
- Cualquier cambio de código de la aplicación.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: a confirmar. Si las actualizaciones no cambian rutas, formato de respuestas, JWT ni CORS, no lo afecta; el cambio de `qs`/`body-parser` podría variar el análisis de cuerpos y query strings (por confirmar).
- `docs/integracion/para-infra.md`: no lo afecta en principio (sin variables de entorno ni permisos nuevos); `package.json`/lock cambian y el despliegue instala dependencias (por confirmar que no se exige otra versión de Node).

## Decisiones del usuario (28/10/2026)

1. Salto de versión mayor tras `npm audit fix`: se detiene y se consulta; solo se acepta lo que cabe en el rango semver de `package.json`.
2. Verificación sin tests de API (M11): arranque, `GET /healthcheck` y prueba manual del login y del formulario de contacto.
3. M20 sigue abierto solo para `uuid`/`exceljs`; no se crea identificador nuevo.
4. `quality` cuenta como verde si solo anota el moderado de `uuid` (sin alto/crítico).
5. Gravedad real del aviso de `proxy-addr` en este uso: queda con la marca **(por confirmar)** y nota de verificación con `npm audit` en CI (no se preguntó; supuesto conservador).

## Preguntas abiertas

Ninguna.
