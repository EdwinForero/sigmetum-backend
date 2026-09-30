# Integración con los otros repositorios

SIGMETUM-A son tres repositorios que se despliegan por separado: `sigmetum-frontend`, `sigmetum-backend` (este) y `sigmetum-infra`. La convención completa está en [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).

## Lo que este repositorio ofrece a los demás

- [docs/integracion/para-frontend.md](docs/integracion/para-frontend.md): qué garantiza y qué espera esta API de `sigmetum-frontend`.
- [docs/integracion/para-infra.md](docs/integracion/para-infra.md): qué necesita este backend de `sigmetum-infra` (variables de entorno, plataforma, permisos IAM, health check).

## Lo que los otros repositorios esperan de este

- **Frontend:** `../sigmetum-frontend/docs/integracion/para-backend.md` — en GitHub: https://github.com/EdwinForero/sigmetum-frontend/blob/master/docs/integracion/para-backend.md (disponible cuando `feature/sigmetum_front_v2` se fusione en `master`).
- **Infraestructura:** `sigmetum-infra` todavía no tiene un `para-backend.md` (solo `para-frontend.md`, verificado el 30/09/2026). Hasta que exista, la fuente de lo que provee la infraestructura es [docs/integracion/para-infra.md](docs/integracion/para-infra.md) de este repositorio, contrastado directamente contra los `.tf`.

Antes de cambiar rutas, formatos de respuesta, columnas del Excel, el formato de versiones, el JWT, CORS o una variable de entorno: revisa la sección "Si cambias algo" del documento correspondiente y sigue [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md).
