## Qué cambia y por qué

<!-- Qué problema resuelve o qué aporta. Si corrige un fallo, enlaza su id de docs/07 (A, M, B, D o I). -->

## Cómo se ha probado

<!-- Comprobaciones manuales y, cuando exista la base de tests (M11), el test que fallaba antes del arreglo. -->

## Definición de terminado

La CI ejecuta estos comandos; márcalos si los has pasado en local.

- [ ] `npm run lint` (si has corregido avisos, has bajado `--max-warnings` al número real)
- [ ] `npm run quality` (si falla por algo que ya estaba —por ejemplo, una vulnerabilidad pendiente—, no lo ocultes: dilo abajo)
- [ ] `npm run docs:check`
- [ ] `npm test`, cuando exista una suite de tests real (hoy es el placeholder de `npm init`)

## Documentación

- [ ] He actualizado los documentos que indica `docs/guias/mantenimiento.md` (sección 2), en este mismo PR
- [ ] Hallazgos resueltos o nuevos en `docs/07`: <!-- ids, o "ninguno" -->
- [ ] Nueva excepción en `ACCEPTED_ADVISORIES`, `PUBLIC_MUTATING_ROUTES` u `OPTIONAL_ENV` (scripts/quality-check.mjs): sí / no. Si sí, el motivo está documentado en docs/guias/seguridad.md

## Guías que aplican

- [ ] Buenas prácticas (`docs/guias/buenas-practicas-backend.md`)
- [ ] Seguridad, si toca autenticación, rutas, subida de archivos, claves de S3, CORS, correo, dependencias, secretos o logs (`docs/guias/seguridad.md`)

## Frontend e infraestructura

- [ ] Afecta al contrato con el frontend o a lo que necesita la infraestructura: **sí / no**
  <!-- Si es sí: has actualizado docs/integracion/para-frontend.md o para-infra.md, y aquí dices qué debe hacer cada equipo y en qué orden desplegar. -->
