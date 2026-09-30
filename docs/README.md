# Documentación de sigmetum-backend

API REST en Node.js/Express que da soporte al frontend de Sigmetum: carga y versionado de datos de series de vegetación (Excel → JSON), galería de imágenes, glosario de términos, formulario de contacto y autenticación del administrador. Toda la persistencia vive en Amazon S3; no hay base de datos.

## Índice

| Documento | Contenido |
|---|---|
| [01-arquitectura.md](01-arquitectura.md) | Visión general, capas, flujo de una petición, despliegue |
| [02-tecnologias.md](02-tecnologias.md) | Dependencias, versiones y para qué se usa cada una |
| [03-configuracion.md](03-configuracion.md) | Variables de entorno, ejecución local, credenciales AWS |
| [04-api.md](04-api.md) | Referencia completa de endpoints |
| [05-modulos.md](05-modulos.md) | Detalle de cada módulo, función y método |
| [06-almacenamiento-s3.md](06-almacenamiento-s3.md) | Estructura del bucket y modelo de versionado |
| [07-estado-y-deuda-tecnica.md](07-estado-y-deuda-tecnica.md) | Métricas, hallazgos abiertos y discrepancias con el frontend |

### Guías de trabajo (normativas)

Las guías son normas con su motivo, su forma de comprobarlas y su estado en este repositorio. Las skills de `.claude/skills/` son el procedimiento paso a paso y enlazan a ellas.

| Guía | Cuándo se lee |
|---|---|
| [guias/buenas-practicas-backend.md](guias/buenas-practicas-backend.md) | Antes de escribir **cualquier código**: estructura, contrato de respuesta, validación, S3, rendimiento, pruebas, dependencias y ESLint |
| [guias/seguridad.md](guias/seguridad.md) | Cuando la tarea toca autenticación, rutas, subida de archivos, S3, CORS, correo, dependencias, secretos o logs |
| [guias/mantenimiento.md](guias/mantenimiento.md) | **Al terminar** cualquier cambio: qué actualizar en `docs/` y cómo se valida |

### Integración con los otros repositorios

Lo que este backend ofrece y necesita de cada repositorio hermano. La convención está en [guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura](guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).

| Documento | Para quién | Lado opuesto |
|---|---|---|
| [integracion/para-frontend.md](integracion/para-frontend.md) | Quien mantiene `sigmetum-frontend` | [sigmetum-frontend/docs/integracion/para-backend.md](https://github.com/EdwinForero/sigmetum-frontend/tree/feature/sigmetum_front_v2/docs/integracion) (disponible tras fusión) |
| [integracion/para-infra.md](integracion/para-infra.md) | Quien mantiene `sigmetum-infra` | `sigmetum-infra` aún no tiene `para-backend.md` (verificado 30/09/2026; solo `para-frontend.md`) |

## Estructura del repositorio

```
sigmetum-backend/
├── index.js                     # Punto de entrada: bootstrap, middlewares, montaje de rutas
├── config/
│   ├── validateEnv.js           # Validación de variables de entorno al arrancar
│   └── s3Paths.js               # Constantes de rutas (prefijos) dentro del bucket
├── routes/
│   ├── auth.js                  # Login y verificación de token
│   ├── data.js                  # Datos de series de vegetación (Excel/JSON, versiones)
│   └── content.js               # Galería, términos, email de contacto
├── functions/
│   ├── userAuthentication.js    # Handler de login (bcrypt + JWT)
│   ├── tokenAuthentication.js   # Middleware de verificación JWT
│   ├── convertExcelToJson.js    # Parser de Excel con columnas fijas
│   ├── formatFileName.js        # Nombre de fichero versionado por fecha
│   └── getNextVersion.js        # Cálculo de la siguiente versión del día
├── aws/
│   └── awsS3connect.js          # Todas las operaciones contra S3
├── middleware/
│   └── errorHandler.js          # Manejador de errores centralizado
├── scripts/
│   ├── docs-check.mjs           # Comprueba que docs/ coincide con el código (npm run docs:check)
│   └── quality-check.mjs        # Puerta de calidad y seguridad (npm run quality)
├── eslint.config.js             # Configuración de ESLint 9 (npm run lint)
├── CLAUDE.md                    # Instrucciones para Claude Code (tabla de guías y definición de terminado)
├── .github/                     # CI, plantilla de PR y Dependabot
├── .claude/                     # Configuración compartida de Claude Code (plugins y skills)
└── docs/                        # Esta documentación (guias/ e integracion/)
```

## Repositorios relacionados

- **sigmetum-infra** — Terraform: Elastic Beanstalk (este backend), Amplify (frontend React), bucket S3, red y DNS.
- **Frontend (React)** — desplegado en Amplify; consume esta API. Lo que espera de ella está en `../sigmetum-frontend/docs/integracion/para-backend.md`; lo que este backend le ofrece, en [integracion/para-frontend.md](integracion/para-frontend.md) (ver [INTEGRACION.md](../INTEGRACION.md)).
