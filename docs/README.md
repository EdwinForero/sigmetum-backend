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

Las guías son normas con su motivo, su forma de comprobarlas y su estado en este repositorio. Las skills son el procedimiento paso a paso y remiten a ellas; cuáles hay y dónde están: [plugins/README.md](../plugins/README.md).

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
├── index.js                     # Punto de entrada: entorno, validación y arranque del servidor
├── app.js                       # Construye y exporta la app Express: middlewares, montaje de rutas, 404 y errores
├── tests/                       # Suite de la API (node:test + supertest): *.test.js y helpers/
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
│   ├── getNextVersion.js        # Cálculo de la siguiente versión del día
│   ├── versionName.js           # Interpretación única del nombre de versión (parseVersionName, latestVersionFile)
│   ├── validateImageKey.js      # Lista de permitidos del imageKey (GET /get-image, DELETE /delete-image)
│   ├── validateImageUpload.js   # Tipo, firma y título de la imagen (POST /upload-image)
│   ├── validateProvincia.js     # Validación de la provincia del Excel (POST /upload)
│   ├── validateDataKey.js       # Lista de permitidos de draftKey y fileName (upload/confirm, update-file, delete-file)
│   └── validateContactMessage.js # Validación del cuerpo de POST /send-email
├── aws/
│   └── awsS3connect.js          # Todas las operaciones contra S3
├── middleware/
│   ├── errorHandler.js          # Manejador de errores centralizado
│   └── notFound.js              # 404 con envoltorio para rutas y métodos no definidos
├── scripts/
│   ├── docs-check.mjs           # Comprueba que docs/ coincide con el código (npm run docs:check)
│   ├── quality-check.mjs        # Puerta de calidad y seguridad (npm run quality)
│   └── lib/repo.mjs             # Base común de los dos controles (lectura del repositorio, rutas, variables, salida)
├── plugins/                     # Marketplace local `locales`: núcleo ciclo-agentico y skills del proyecto por categoría (ver plugins/README.md)
├── eslint.config.js             # Configuración de ESLint 9 (npm run lint)
├── CLAUDE.md                    # Instrucciones para Claude Code (tabla de guías y definición de terminado)
├── .github/                     # CI, plantilla de PR y Dependabot
├── .claude/                     # Configuración compartida de Claude Code
│   ├── flujo.json               # Adaptador del flujo agéntico a este repositorio (ver 03-configuracion.md)
│   └── settings.json            # Marketplaces, plugins, permisos que piden confirmación y memoria automática
└── docs/                        # Esta documentación (guias/ e integracion/)
    └── specs/                   # Specs, planes y avisos para PR del flujo agéntico (documentos de trabajo, fuera del índice)
```

## Flujo agéntico

Toda feature o fix puede pasar por `/ciclo <tarea>`, del plugin [ciclo-agentico](../plugins/ciclo-agentico/README.md): requisitos, arquitectura, desarrollo y verificación con documentación, con una puerta humana entre fases y sin commits del agente. La configuración de este repositorio está en `.claude/flujo.json` y `.claude/settings.json` (qué hace cada uno: [03-configuracion.md](03-configuracion.md#flujo-agéntico)). Los traspasos entre roles (specs, planes y avisos para PR) se guardan en `docs/specs/`.

### Equipo nuevo

El plugin no puede instalarse a sí mismo, así que en un equipo que no lo tiene el orden es este:

1. Clonar el repositorio y ejecutar `npm install`.
2. Tener Claude Code instalado y autenticado.
3. `npm run agentes:bootstrap`: comprueba qué plugins del catálogo faltan (`plugins/ciclo-agentico/.claude-plugin/dependencias.json`, filtrado por los `perfiles` de `.claude/flujo.json`) y qué plugins del marketplace local `./plugins` (campo `marketplaceLocal`) corresponden a esos perfiles, y pregunta antes de instalar cada uno. Con `npm run agentes:bootstrap -- --dry-run` solo informa (los locales salen marcados `[local]`).
4. Si el paso 3 no instaló los plugins locales, hacerlo a mano (`.claude/settings.json` declara los plugins del perfil `base` del [catálogo](../plugins/ciclo-agentico/.claude-plugin/dependencias.json) que funcionan en Windows, más los que ya estaban habilitados de `claude-plugins-official`; no declara los locales, que lista [plugins/README.md](../plugins/README.md)): `claude plugin marketplace add ./plugins` y `claude plugin install ciclo-agentico@locales`, más los plugins del proyecto que lista [plugins/README.md](../plugins/README.md) **(por confirmar: la ruta relativa y los ids no se han probado todavía)**.
5. Reiniciar la sesión de Claude Code y ejecutar `/ciclo-init` para validar `.claude/flujo.json`, que en este repositorio ya existe (puede que haga falta el prefijo `/ciclo-agentico:ciclo-init` **(por confirmar)**).
6. Verificar con `claude plugin list` que aparecen los plugins del perfil activo, y lanzar un `/ciclo` de prueba con el árbol limpio para comprobar que arranca.

El consultor de segunda opinión no funciona en Windows nativo; por eso aquí `consultor` vale `ninguno` (ver B10 en [07](07-estado-y-deuda-tecnica.md#calidad-y-detalles-b-e-i)).

## Repositorios relacionados

- **sigmetum-infra** — Terraform: Elastic Beanstalk (este backend), Amplify (frontend React), bucket S3, red y DNS.
- **Frontend (React)** — desplegado en Amplify; consume esta API. Lo que espera de ella está en `../sigmetum-frontend/docs/integracion/para-backend.md`; lo que este backend le ofrece, en [integracion/para-frontend.md](integracion/para-frontend.md).
