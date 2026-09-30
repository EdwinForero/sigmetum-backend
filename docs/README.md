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
| [07-estado-y-deuda-tecnica.md](07-estado-y-deuda-tecnica.md) | Análisis del estado actual, riesgos y bugs conocidos |

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
├── .claude/                     # Configuración compartida de Claude Code (plugins y skills)
└── docs/                        # Esta documentación
```

## Repositorios relacionados

- **sigmetum-infra** — Terraform: Elastic Beanstalk (este backend), Amplify (frontend React), bucket S3, red y DNS.
- **Frontend (React)** — desplegado en Amplify; consume esta API.
