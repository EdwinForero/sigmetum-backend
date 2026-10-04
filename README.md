# sigmetum-backend

API REST (Node.js + Express) de la plataforma Sigmetum. Gestiona la carga y el versionado de datos de series de vegetación (Excel → JSON), la galería de imágenes, el glosario de términos, el formulario de contacto y la autenticación del administrador. La persistencia es Amazon S3.

## Inicio rápido

```bash
npm install
cp .env.example .env      # rellenar valores (ver docs/03-configuracion.md)
aws sso login --profile <tu-perfil>
npm start
```

Comprobar: `GET http://localhost:8000/healthcheck` → `ok`.

## Documentación

La documentación completa está en [docs/](docs/README.md):

- [Arquitectura](docs/01-arquitectura.md)
- [Tecnologías](docs/02-tecnologias.md)
- [Configuración](docs/03-configuracion.md)
- [Referencia de la API](docs/04-api.md)
- [Módulos y funciones](docs/05-modulos.md)
- [Almacenamiento S3 y versionado](docs/06-almacenamiento-s3.md)
- [Estado y deuda técnica](docs/07-estado-y-deuda-tecnica.md)

Guías de trabajo (normativas):

- [Buenas prácticas del backend](docs/guias/buenas-practicas-backend.md): estructura, contrato de respuesta, validación, S3, pruebas y ESLint
- [Seguridad de la API](docs/guias/seguridad.md): autenticación, autorización, claves de S3, archivos, dependencias y estado actual
- [Mantenimiento de la documentación](docs/guias/mantenimiento.md): qué actualizar tras cada cambio

Antes de dar un cambio por terminado: `npm run lint`, `npm run quality` y `npm run docs:check`.

La infraestructura (Elastic Beanstalk, S3, Amplify, DNS) se gestiona en el repositorio **sigmetum-infra**.
