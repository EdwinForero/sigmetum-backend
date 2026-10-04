# Integración con la infraestructura: lo que necesita el backend

Documento para quien mantiene `sigmetum-infra`. Explica **qué necesita este backend para arrancar y funcionar** en cada entorno. Sigue la convención de [../guias/mantenimiento.md](../guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).

- Lo verificado contra el código de Terraform está marcado **(verificado)**; lo que depende de la cuenta real de AWS, **(por confirmar)**.
- Fecha de la verificación: 30/09/2026 (actualizado 03/10/2026). Backend: rama `feature/sigmetum_v2`. Infraestructura: rama `feature/testing`, commit `19bdde3`.
- No se han leído secretos ni `terraform.tfvars`: solo nombres de variables y los `.tfvars.example`.

## 1. Resumen

| Id | Problema | Efecto |
|---|---|---|
| **I1** | `HealthCheckPath` de Beanstalk es `/`, pero el backend solo responde `200` en `/healthcheck` (`/` no tiene ruta definida) | El entorno puede figurar como no saludable **(verificado en el código de ambos repos; por confirmar en el entorno real, porque Express podría responder algo distinto a un healthcheck fallido)** |
| **I2** | ~~No hay `trust proxy` configurado en el backend~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', 1)` añadido en `index.js`. Cadena verificada: ALB → nginx (loopback) → Express; 1 salto externo. El rate-limiter de login ya lee la IP real del cliente. |
| **I3** | `terraform.tfvars.example` de `dev` y `prod` **ya incluyen** `ALLOWED_ORIGIN`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` **(verificado, 30/09/2026)** | El documento del frontend (`para-infra.md` de `sigmetum-frontend`, I5) decía que faltaban: **puede estar resuelto**. Confirmar con quien mantiene `sigmetum-infra` si el `terraform.tfvars` real (no el ejemplo) también las tiene aplicadas |
| **I4** | `load_balancer_type = "single"` en dev, es decir, **sin ALB**: `backend_url` se construye como `http://${module.beanstalk.endpoint_url}` (ver `environments/dev/main.tf`) | El backend de dev se sirve por HTTP; si el frontend de dev se sirve por HTTPS (Amplify), el navegador bloquea las peticiones por contenido mixto (coincide con `frontend:I4`) |
| **I5** | No hay regla de grupo de seguridad explícita para la salida a `smtp.gmail.com:587` en el módulo `beanstalk` | Se asume la salida por defecto del grupo de seguridad del VPC por defecto (normalmente abierta a todo el tráfico saliente), pero no está verificado en el código **(por confirmar)** |
| **I6** | No hay ningún paso de despliegue automatizado para el backend: el README de `sigmetum-infra` dice "sube un zip por consola o CI/CD" | El despliegue es manual hoy; no hay pipeline que aplique `npm ci && npm run lint && npm run quality` antes de subir el paquete |

## 2. Variables de entorno

Nombres únicamente; nunca valores reales. Fuente: `config/validateEnv.js` **(verificado)**.

### Obligatorias en todos los entornos

| Variable | Secreto | Notas |
|---|---|---|
| `JWT_SECRET` | Sí | Ver [../guias/seguridad.md](../guias/seguridad.md#s2-autenticación): largo y aleatorio, distinto por entorno |
| `JWT_EXPIRATION` | No | Formato de `jsonwebtoken` (p. ej. `8h`). El `.tfvars.example` de infra usa `10m`; el `.env.example` del backend usa `8h`: son solo valores de ejemplo, no una discrepancia, pero conviene que ambos repositorios usen el mismo valor de referencia |
| `ADMIN_USERNAME` | Sí (es una credencial) | — |
| `ADMIN_PASSWORD` | Sí | **Debe ser un hash bcrypt**, nunca la contraseña en claro. Cómo generarlo: [../03-configuracion.md](../03-configuracion.md#generar-el-hash-de-admin_password) |
| `EMAIL` | Sí | Cuenta Gmail del formulario de contacto |
| `EMAIL_PASSWORD` | Sí | Contraseña de aplicación de Gmail, no la contraseña de la cuenta |
| `AWS_REGION` | No | `eu-west-3` en ambos entornos **(verificado)** |
| `AWS_BUCKET_NAME` | No | Debe coincidir con el bucket que crea `modules/storage` (`sigmetum-app-assets-dev` / `sigmetum-app-assets-prod`) |
| `ALLOWED_ORIGIN` | No (pero sensible: define quién puede llamar a la API) | Un único origen exacto, sin barra final; ver sección 5 |

### Solo en local (no aplica a Beanstalk)

| Variable | Notas |
|---|---|
| `AWS_PROFILE` | Perfil SSO; en Beanstalk el SDK usa el rol IAM de la instancia (sección 4) |

### Opcionales, con valor por defecto en el código

| Variable | Valor por defecto | Notas |
|---|---|---|
| `PORT` | `8000` | El `.tfvars.example` ya la fija en `8000`: coincide |
| `API_PREFIX` | `/api/v1` | No está en `app_env_vars` de ningún ejemplo; si no se define, el backend usa el valor por defecto, que es el esperado por el frontend |
| `NODE_ENV` | (ninguno; cualquier valor que no sea `local` se trata como no-local) | No está en ningún `.tfvars.example`; conviene **no** definirlo como `local` en Beanstalk, porque activaría credenciales SSO (que no existen en la instancia) en vez del rol IAM |

**Estado de `app_env_vars` en los ejemplos (03/10/2026, verificado):** `dev` y `prod` incluyen las 9 obligatorias más `PORT`. I3 resuelto: el doc de infra confirma que `app_env_vars` ya incluye `ALLOWED_ORIGIN`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.

## 3. Plataforma y arranque

| Aspecto | Valor | Verificado |
|---|---|---|
| Runtime | Node.js 22 (`64bit Amazon Linux 2023 v6.11.9 running Node.js 22`) | Sí, en `modules/beanstalk/variables.tf` |
| Comando de arranque | `npm start` (`node index.js`), el que usa Beanstalk por convención para una app Node | Por confirmar: no hay un `Procfile` en este repositorio; Beanstalk infiere `npm start` de `package.json` |
| Puerto interno | `PORT` (8000 por defecto); Beanstalk enruta el puerto 80 externo hacia él | Sí (`app.listen(PORT)` en `index.js`, `Port = 80` en `modules/beanstalk/main.tf`) |
| `package.json` → `engines` | `"node": "22.x"` declarado **(resuelto 03/10/2026, B3; actualizado a 22.x 03/10/2026)** | Sí |
| Health check | `GET /healthcheck` → `200 ok`, texto plano, sin auth ni CORS (se registra antes de esos middlewares) | Sí, en `index.js` |
| **`HealthCheckPath` en Terraform** | `/` (no `/healthcheck`) | Sí, en `modules/beanstalk/main.tf` → **I1** |
| Despliegue | Subir un zip del código por consola o CI/CD; sin pipeline automatizado hoy | Sí, según el README de `sigmetum-infra` → I6 |

## 4. Permisos IAM sobre S3

Acciones que usa el código, deducidas de `aws/awsS3connect.js` **(verificado)**:

| Acción del SDK | Dónde se usa |
|---|---|
| `GetObjectCommand` / `s3.getObject` | Leer JSON activos, buffers de Excel, firmar URLs de imágenes |
| `s3.putObject` | Subir Excel, JSON activos, imágenes, el glosario |
| `s3.deleteObject` | Borrar versiones de Excel, imágenes, el JSON activo al quedar una provincia sin versiones |
| `ListObjectsV2Command` / `s3.listObjectsV2` | Listar versiones por provincia, listar la galería |
| `getSignedUrl` (firma local, no es una llamada de red aparte) | URLs prefirmadas de descarga, caducidad 3600 s |

**Lo que concede `modules/storage/main.tf`** (política `aws_iam_role_policy.beanstalk_s3`, verificado): `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` sobre el bucket y sus objetos. **Coincide exactamente** con lo que usa el código: no faltan ni sobran permisos.

- El rol se asigna por nombre fijo (`aws-elasticbeanstalk-ec2-role`), no por referencia al recurso del rol: si ese nombre cambia en el futuro, esta política deja de aplicarse sin que Terraform avise **(verificado, es una observación sobre el propio Terraform, no un hallazgo del backend)**.
- Sin local: en Beanstalk no hay `AWS_PROFILE`; el SDK usa la cadena de credenciales por defecto, que resuelve al rol de la instancia (`IamInstanceProfile = aws-elasticbeanstalk-ec2-role` en `modules/beanstalk/main.tf`).

## 5. Bucket, región y orígenes

| Aspecto | Valor |
|---|---|
| Nombre del bucket | `sigmetum-app-assets-dev` / `sigmetum-app-assets-prod` (debe coincidir con `AWS_BUCKET_NAME`) |
| Región | `eu-west-3` en los dos entornos **(verificado)** |
| Acceso público | Bloqueado (`block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets` todos `true`) **(verificado)**. Correcto: el backend sirve todo por URL prefirmada o por la propia API, nunca por acceso directo al bucket |
| Cifrado | AES256 en reposo **(verificado)** |
| Versionado | Activado **(verificado)**; relevante para el hallazgo interno A1 (una versión sobrescrita por el fallo de zona horaria se podría recuperar desde el historial de versiones de S3) |
| Prefijos que usa el código | `gallery/`, `data/`, `data/active/`, `data/terms/` (constantes en `config/s3Paths.js`). No requieren ninguna configuración especial del bucket: son solo convenciones de clave |

**`ALLOWED_ORIGIN` por entorno:**

| Entorno | Debe ser |
|---|---|
| `dev` | El origen exacto del frontend de dev (la URL de Amplify de la rama `feature/testing`, sin barra final). Depende de lo que resuelva `sigmetum-infra`/`sigmetum-frontend` para su propio I1 (la URL de Amplify) |
| `prod` | `https://sigmetum-a.org` o el dominio final que se asocie a la rama `master` en Amplify (aún no hay un registro DNS para el frontend, solo para `backend.sigmetum-a.org`, según `modules/dns/main.tf`) |

Es CORS de **un único origen exacto** (`cors({ origin: process.env.ALLOWED_ORIGIN })`): si algún día se necesita más de un origen a la vez, el backend tendría que pasar a una lista o a una función, lo cual es un cambio de código, no solo de infraestructura.

## 6. Detrás del balanceador

| Aspecto | Estado |
|---|---|
| `trust proxy` | **No configurado en el backend** (`index.js` no llama a `app.set('trust proxy', ...)`) → I2 |
| HTTPS | `prod` usa ALB con `ssl_certificate_arn` (HTTPS en el 443); `dev` usa `load_balancer_type = "single"` (sin ALB, solo HTTP) → I4 |
| Salida SMTP (`smtp.gmail.com:587`) | Sin regla de grupo de seguridad específica en el módulo `beanstalk`; se asume la salida por defecto del grupo del VPC por defecto **(por confirmar)** |
| Memoria e instancia | `t3.nano` (0.5 GiB de RAM) en los dos entornos, 1 a 3 instancias en prod, 1 fija en dev. El backend carga los Excel enteros en memoria (`multer` sin límite de tamaño, hallazgo interno M6): con `t3.nano`, un Excel grande es un riesgo real de memoria, no solo teórico |

## 7. Tabla de discrepancias

Ver el resumen de la sección 1. Estado y responsable:

| Id | Responsable | Acción |
|---|---|---|
| **I1** | ~~Infraestructura~~ | **Resuelto** (`feature/testing` de infra): `HealthCheckPath = "/healthcheck"` |
| **I2** | ~~Infraestructura y backend~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', 1)` en `index.js` |
| **I3** | ~~Ambos~~ | **Resuelto (03/10/2026)**: `para-backend.md` de infra confirma que `app_env_vars` incluye todas las obligatorias. Región actualizada a `eu-west-3`, bucket a `sigmetum-app-assets-*` |
| **I4** | Infraestructura y frontend | Decidir si dev necesita HTTPS (ALB con certificado, o un dominio con proxy). Coincide con `frontend:I4` |
| **I5** | Infraestructura | Confirmar o documentar explícitamente la regla de salida a `smtp.gmail.com:587` |
| **I6** | Infraestructura | Valorar automatizar el despliegue del backend (zip) tras pasar `npm run lint`, `npm run quality` y `npm run docs:check` en CI. No se implanta en este documento: es una decisión de infraestructura |

## 8. Si cambias algo en la infraestructura

| Si cambias... | El backend debe revisar... |
|---|---|
| El nombre del bucket | `AWS_BUCKET_NAME` en `app_env_vars` de ese entorno |
| El rol IAM de la instancia (nombre o permisos) | Que siga permitiendo `GetObject`, `PutObject`, `DeleteObject`, `ListBucket` sobre el bucket (sección 4) |
| `HealthCheckPath` | Que coincida con `/healthcheck` (I1) |
| El balanceador (de `single` a `application`, o el certificado) | `ALLOWED_ORIGIN` sigue siendo el origen correcto; si pasa a HTTPS, avisar al frontend |
| El tipo de instancia | Revisar el límite de tamaño de `multer` (hoy no hay ninguno; sección 6) |
| `app_env_vars` | Que siga cubriendo la tabla de la sección 2 (obligatorias) |
| El dominio de `prod` o de `dev` | `ALLOWED_ORIGIN` de ese entorno, y avisar al frontend si cambia la URL que consume |

## 9. Cómo mantener este documento

- Se actualiza en el mismo commit que cambia `config/validateEnv.js` (variables), `config/s3Paths.js` (prefijos) o `aws/awsS3connect.js` (acciones de S3), siguiendo [../guias/mantenimiento.md](../guias/mantenimiento.md).
- Las discrepancias `I1` a `I6` se verifican contra el código de `sigmetum-infra` y se quitan de la tabla de la sección 7 cuando se resuelven allí, pasando a una línea del historial de [../07-estado-y-deuda-tecnica.md](../07-estado-y-deuda-tecnica.md).
- Si `sigmetum-infra` cambia `modules/beanstalk`, `modules/storage` o los `.tfvars.example`, se revisa este documento entero, no solo la sección que parece afectada.
