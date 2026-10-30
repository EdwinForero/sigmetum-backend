# B7 y M24, limpieza de estructura y controles: spec

Fecha: 2026-10-30 · Estado: cerrado

## Objetivo

B7: dos archivos de `functions/` no están en la capa que les corresponde según la guía (`tokenAuthentication.js` es un middleware; `userAuthentication.js` es un manejador de ruta) y queda rastro de una carpeta `uploads/` que no existe. M24: cuatro controles menores de la base de tests (`docs-check`, `quality-check`, `MIN_TESTS`, `npm audit` de la CI). Ningún efecto observable en producción: mismas rutas, respuestas, JWT y CORS.

Situación comprobada hoy:
- `uploads/` no existe en el árbol. Rastro: `.gitignore` (línea 9), `eslint.config.js` (`ignores`) y `scripts/lib/repo.mjs` (`IGNORED`). No hay `.dockerignore` ni `.ebextensions/` en el repositorio; `docs/integracion/` no menciona `uploads`; `ci.yml` no la cita. `multer` trabaja en memoria.
- Referencias a `tokenAuthentication`/`userAuthentication` en: `routes/auth.js`, `routes/data.js`, `routes/content.js`, `tests/estructura-rutas.test.js`, `tests/jwt-algoritmo.test.js`, `tests/helpers/pila.js`, `.claude/flujo.json` (`docsPorArea` y `areasContrato`), `docs/03`, `docs/05`, `docs/README.md`, `docs/07` y las guías `buenas-practicas-backend.md` y `mantenimiento.md`.
- `tests/capas-importaciones.test.js` recorre hoy solo `aws/` y `functions/`.
- CI: `.github/workflows/ci.yml`, job `verify`, último paso `npm audit --audit-level=high` (incluye dependencias de desarrollo; `quality` usa `--omit=dev`); `deploy` depende de `verify`.

## Decisiones tomadas (30/10/2026)

- El manejador de login se integra en `routes/auth.js`; el middleware `tokenAuthentication` pasa a `middleware/`.
- El test de capas vigila también `middleware/` (no puede importar `aws/`).
- Se retira el rastro de `uploads/`.
- `docs-check` falla si `index.js` declara rutas (`index.js` solo arranca el servidor).
- `quality-check` no deja procesos huérfanos al agotar el tiempo máximo.
- Qué se hace ahora: B7 completo, M24 (a) y (b).
- Decisión pendiente: M24 (c) y (d).

## Criterios de aceptación

### De código

B7, se hace ahora:
1. El middleware de autenticación por token ya no está en `functions/` y vive en `middleware/`; `grep` de `functions/tokenAuthentication` en el repositorio (sin `docs/specs/`) no devuelve resultados.
2. `functions/userAuthentication.js` deja de existir; su lógica está en `routes/auth.js`; `grep` de `functions/userAuthentication` sin resultados.
3. Importaciones, `tests/` (incluidos `capas-importaciones.test.js`, `estructura-rutas.test.js`, `jwt-algoritmo.test.js` y `helpers/pila.js`) y `.claude/flujo.json` apuntan a las nuevas ubicaciones. `npm test` pasa con el mismo número de tests o más, sin tests borrados.
4. `tests/capas-importaciones.test.js` recorre `middleware/` además de `aws/` y `functions/`, y falla si un archivo de `middleware/` importa de `aws/`. Debe incluir un caso que lo demuestre. Las reglas existentes siguen igual.
5. Sin cambios observables: mismas rutas, métodos, códigos y cuerpos de respuesta, algoritmo y claims del JWT, y CORS. Las expectativas de comportamiento de `estructura-rutas.test.js` y de las pruebas de `tokenAuth` y login no cambian.
6. Tras retirar el rastro de `uploads/` de `.gitignore`, `eslint.config.js` y `scripts/lib/repo.mjs`, `grep` de `uploads` fuera de `docs/` y `node_modules` solo devuelve usos no relacionados (o ninguno); `lint`, `quality` y `docs:check` siguen pasando.

M24, se hace ahora:
7. (a) `docs-check` falla si `index.js` declara rutas. Comprobable con una ruta de prueba añadida a `index.js`, que hace fallar el control; sin ella, pasa.
8. (b) Si un subproceso de `quality-check` agota el tiempo máximo, no queda ningún proceso hijo vivo. Comprobable con un subproceso simulado que supere el tiempo máximo y una comprobación posterior de que ningún hijo sigue vivo.

M24, decisión pendiente (no se cambia nada en esta iteración):
9. (c) `MIN_TESTS` (hoy suelo fijo de 1076 en `scripts/quality-check.mjs`) como instantánea: opción A, mantener el suelo fijo y subirlo a mano; opción B, instantánea del recuento versionada en el repositorio que detecte bajadas con justificación. Riesgo de B: fichero extra que mantener y conflictos entre ramas.
10. (d) `npm audit` de la CI. Opciones: (i) mantener el bloqueo con dependencias de desarrollo; (ii) bloquear solo producción (`--omit=dev`) y avisar de las de desarrollo sin bloquear; (iii) mantener el bloqueo con una lista de excepciones registradas y justificadas. Afecta a CI y despliegue: decide el usuario con infra. `.github/workflows/ci.yml` no se modifica.

### De documentación

1. `docs/05-modulos.md`: describe `middleware/` con el middleware movido y el login dentro de `routes/auth.js`.
2. `docs/04-api.md` y `docs/03-configuracion.md`: sustituyen las rutas antiguas de los archivos movidos; sin cambio de contrato.
3. `docs/guias/buenas-practicas-backend.md`: la tabla de capas deja de decir "`tokenAuth` vive en `functions/`", se quita B7 de la tabla de incumplimientos y la regla de capas recoge que `middleware/` no importa `aws/`. `docs/guias/mantenimiento.md` y `docs/README.md` donde citen las rutas antiguas.
4. `docs/guias/mantenimiento.md` y `docs/guias/seguridad.md` reflejan los cambios de `scripts/` (a, b).
5. `docs/07-estado-y-deuda-tecnica.md`: fecha de actualización de hoy; B7 resuelto; M24 con (a) y (b) resueltos y (c) y (d) abiertos como decisión pendiente con las opciones anteriores; métricas al día.
6. Aviso de PR: dice "sin cambio de contrato" e incluye, como (por confirmar) con infra, que ningún despliegue espera la carpeta `uploads/`; menciona que (d) queda pendiente y `ci.yml` no cambia.

## Fuera de alcance

- Cambiar rutas, formato de respuestas, JWT, CORS, columnas del Excel o versiones de API.
- Cambiar el comportamiento de `tokenAuth` o del login (límite de intentos, lectura de `process.env`).
- Implementar M24 (c) y (d); modificar `.github/workflows/ci.yml`.
- Otras filas de `docs/07` (M20 `uuid`/`exceljs`, otros B-n).
- Mover otros archivos de `functions/`.
- Cambios en el frontend o en `sigmetum-infra`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: no lo afecta (ninguno esperado). Cambio interno; la suite de `tests/` debe pasar antes y después con las mismas expectativas. Si una expectativa de contrato tuviera que cambiar, el cambio dejaría de ser de limpieza.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno, permisos IAM ni endpoints nuevos). Que ningún despliegue espere `uploads/` queda como (por confirmar) en el aviso de PR. La CI no cambia en esta iteración; M24 (d) la afectaría y queda pendiente de decisión.
- `areasContrato` incluye los archivos movidos y `.github/**`, por lo que el cierre documental pedirá aviso de PR.

## Preguntas abiertas

Ninguna. Las cinco preguntas iniciales quedaron resueltas el 30/10/2026 (ver "Decisiones tomadas"); M24 (c) y (d) son decisión pendiente del usuario, no pregunta bloqueante.
