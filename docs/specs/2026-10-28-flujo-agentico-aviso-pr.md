# Aviso para PR: flujo agéntico (28/10/2026)

## Qué cambia

- Plugin nuevo de Claude Code en `plugins/ciclo-agentico/` (comandos `/ciclo` y `/ciclo-init`, cuatro roles, skills, scripts y sus pruebas con `node:test`).
- `.claude/flujo.json` (nuevo), `.claude/settings.json` (marketplaces, plugins, permisos `ask` y memoria automática desactivada) y `.gitignore` (salidas de los agentes).
- `package.json`: solo tres scripts de desarrollo (`docs:gate`, `agentes:test`, `agentes:bootstrap`). Sin dependencias nuevas y sin tocar `engines` ni los scripts `start` y `test`.
- `eslint.config.js` lintea también `plugins/**/*.mjs`; `scripts/docs-check.mjs` no cuenta las pruebas del plugin como tests de la API y no exige `docs/specs/` en el índice.
- Reorganización de skills: las de `.claude/skills/` (borrada) pasan, en español y genéricas, a plugins hermanos del marketplace local `plugins/` (`locales`): `backend-general`, `dominio-api-express` y `dominio-aws-s3`, descritos en [plugins/README.md](../../plugins/README.md). `.claude/flujo.json` añade `marketplaceLocal` y los perfiles `api-express` y `aws-s3`; `agentes:test` recorre `plugins/**/tests/`.
- Deduplicación sin cambios de fondo: base común `scripts/lib/repo.mjs` para `docs-check.mjs` y `quality-check.mjs` (mismas salidas, salvo la línea "Links a repositorios hermanos", que se funde en la de enlaces), utilidades comunes del plugin en `scripts/lib/util.mjs`, contrato de salida de los roles en la skill `principios`, plantilla de PR solo en `.github/` y `$comentario` fuera de `.claude/flujo.json`.
- Documentación: [README.md](../README.md), [03](../03-configuracion.md), [02](../02-tecnologias.md), [07](../07-estado-y-deuda-tecnica.md), [mantenimiento](../guias/mantenimiento.md), [buenas prácticas](../guias/buenas-practicas-backend.md), `CLAUDE.md` y el README de la raíz.

No cambia código de la API (`index.js`, `routes/`, `functions/`, `aws/`, `middleware/`, `config/`).

Integración: sin impacto — esta iteración no cambia rutas, formato de respuestas, columnas, JWT, CORS ni variables de entorno; package.json solo añadió scripts de desarrollo

## Frontend

Nada que hacer. La reorganización de skills en `plugins/` tampoco cambia el contrato con el frontend. No cambia ninguna ruta, método, formato de respuesta, columna del Excel, formato de nombre de versión, JWT, CORS ni el prefijo de la API.

## Infraestructura

- Nada obligatorio: ni variables de entorno, ni permisos de S3, ni runtime, ni health check. `engines` sigue en Node 22.
- Para información, hallazgo B11 de [07](../07-estado-y-deuda-tecnica.md): el zip de despliegue de `.github/workflows/ci.yml` excluye `.claude/*` y `docs/*`, pero no `plugins/*`, así que la carpeta del plugin viajaría al paquete de Beanstalk. No impide arrancar la API **(por confirmar en un despliegue)**. La decisión es de este repositorio (el zip lo define su CI), pendiente del usuario: añadir `--exclude "plugins/*"`. No se corrige en esta PR.
- `npm ci` no ejecuta los scripts nuevos: no son scripts del ciclo de vida de npm (`install`, `prepare`, etc.) y nadie los invoca al arrancar **(verificado leyendo `package.json`)**.

## Para el usuario

- `npm run quality` falla por el hallazgo M20 de [07](../07-estado-y-deuda-tecnica.md) (avisos alto y crítico de `npm audit` publicados después de M16). No viene de esta iteración: `package-lock.json` no cambió. Se corrige aparte con `npm audit fix` sin `--force`.
- Los scripts del plugin usan `child_process` (`execFileSync` con argumentos fijos o validados, fuera del código de la API), y `CLAUDE.md` lo prohíbe en general. Lo aceptaste al aprobar el plan, pero conviene matizar la regla de "Lo que nunca se hace" (por ejemplo, "en la API"): queda pendiente de tu decisión, y esta PR no cambia esa regla ni `seguridad.md`.

## Por confirmar

Lo que falta probar del propio flujo (instalación del plugin local, prefijos, `${CLAUDE_PLUGIN_ROOT}`, `/octo:review`, nombre de la skill de `i-have-adhd`) está en el hallazgo M18 de [07](../07-estado-y-deuda-tecnica.md).
