# Tecnologías

Runtime: **Node.js** (CommonJS, `require`). Arranque con `npm start` → `node index.js`.

## Dependencias de producción

| Paquete | Versión instalada | Uso en el proyecto |
|---|---|---|
| `express` | 4.21.1 | Servidor HTTP y routers |
| `cors` | 2.8.5 | Restringe el origen permitido a `ALLOWED_ORIGIN` |
| `compression` | 1.7.5 | Compresión gzip de respuestas (los JSON de datos son grandes) |
| `morgan` | 1.10.1 | Log de peticiones en formato `combined` |
| `dotenv` | 16.4.5 | Carga `.env` en `process.env` |
| `express-rate-limit` | 8.5.2 | Limita intentos de login (10 cada 15 min por IP) |
| `jsonwebtoken` | 9.0.2 | Emisión y verificación de JWT |
| `bcrypt` | 5.1.1 | Comparación de la contraseña del admin contra un hash |
| `multer` | 1.4.5-lts.1 | Recepción de ficheros `multipart/form-data` en memoria |
| `exceljs` | 4.4.0 | Lectura de los Excel de series de vegetación |
| `nodemailer` | 6.9.16 | Envío del formulario de contacto vía SMTP de Gmail |
| `@aws-sdk/client-s3` | 3.685.0 | Operaciones sobre el bucket (get, put, list, delete) |
| `@aws-sdk/s3-request-presigner` | 3.685.0 | URLs prefirmadas para las imágenes de la galería |
| `@aws-sdk/credential-providers` | 3.1058.0 | `fromSSO` para credenciales en local |

## Dependencias de desarrollo

| Paquete | Versión | Uso |
|---|---|---|
| `nodemon` | 3.1.7 | Recarga en caliente (no hay script configurado; usar `npx nodemon index.js`) |

## Servicios externos

| Servicio | Para qué |
|---|---|
| Amazon S3 | Única persistencia: datos, versiones, imágenes, términos |
| Gmail SMTP (`smtp.gmail.com:587`, STARTTLS) | Formulario de contacto. Requiere contraseña de aplicación en `EMAIL_PASSWORD` |
| AWS Elastic Beanstalk | Hosting (ver sigmetum-infra) |

## Lo que no hay

- Base de datos.
- Tests ni framework de testing (`npm test` es el placeholder de `npm init`).
- Linter/formatter configurado.
- TypeScript.
- Documentación OpenAPI/Swagger.
