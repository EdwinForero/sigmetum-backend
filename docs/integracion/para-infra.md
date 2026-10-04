# Integración con la infraestructura: lo que necesita el backend

Documento para quien mantiene `sigmetum-infra`. Explica **qué necesita este backend para arrancar y funcionar** en cada entorno. Sigue la convención de [../guias/mantenimiento.md](../guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).

- Lo verificado contra el código de Terraform está marcado **(verificado)**; lo que depende de la cuenta real de AWS, **(por confirmar)**.
- Fecha de la verificación: 30/09/2026 (actualizado 04/10/2026). Backend: rama `feature/sigmetum_v2`. Infraestructura: rama `feature/testing`, commit `f35dd3a`.
- No se han leído secretos ni `terraform.tfvars`: solo nombres de variables y los `.tfvars.example`.

## 1. Resumen

| Id | Problema | Efecto |
|---|---|---|
| ~~**I1**~~ | ~~`HealthCheckPath` de Beanstalk es `/`~~ | **Resuelto (feature/testing de infra)**: `HealthCheckPath = "/healthcheck"` en `modules/beanstalk/main.tf` **(verificado)** |
| ~~**I2**~~ | ~~No hay `trust proxy` configurado en el backend~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', 1)` añadido en `index.js`. Cadena verificada: nginx (loopback) → Express; 1 salto. El rate-limiter de login ya lee la IP real del cliente. |
| ~~**I3**~~ | ~~`app_env_vars` no incluía `ALLOWED_ORIGIN`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD`~~ | **Resuelto (30/09/2026)**: los `.tfvars.example` de `dev` y `prod` incluyen todas las variables obligatorias más `PORT` **(verificado)** |
| ~~**I4**~~ | ~~dev sin HTTPS: contenido mixto con el frontend en Amplify~~ | **Resuelto (feature/testing de infra)**: `enable_cdn = true` en dev añade CloudFront como terminador HTTPS delante de Beanstalk; `backend_url` ya apunta a `module.beanstalk.backend_cdn_url` **(verificado)** |
| **I5** | No hay regla de grupo de seguridad explícita para la salida a `smtp.gmail.com:587` | Se asume la salida por defecto del VPC por defecto (normalmente abierta), pero no está verificado en el entorno real **(por confirmar)** |
| ~~**I6**~~ | ~~Sin pipeline de despliegue automatizado para el backend~~ | **Resuelto (04/10/2026)**: módulo `backend-ci-iam` en infra crea el rol OIDC para GitHub Actions; el workflow del backend ya despliega en Beanstalk automáticamente al hacer push a la rama de dev |

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
| `package.json` → `engines` | `"node": "22"` declarado **(resuelto 03/10/2026, B3)** | Sí |
| Health check | `GET /healthcheck` → `200 ok`, texto plano, sin auth ni CORS (se registra antes de esos middlewares) | Sí, en `index.js` |
| `HealthCheckPath` en Terraform | `/healthcheck` **(I1 resuelto)** | Sí, en `modules/beanstalk/main.tf` |
| Despliegue | GitHub Actions (OIDC) → zip a S3 → `CreateApplicationVersion` → `UpdateEnvironment` **(I6 resuelto)** | Sí, módulo `backend-ci-iam` en infra |

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

`ALLOWED_ORIGIN` acepta **una lista de orígenes separados por coma**. El backend los divide, elimina espacios y permite el acceso si el origen del request está en la lista o si no hay origen (llamadas server-side). Formato: `https://a.com,https://b.com` (sin barra final, sin espacios extra).

| Entorno | Qué poner en `ALLOWED_ORIGIN` | Estado |
|---|---|---|
| `dev` | URL(s) de las ramas activas en Amplify, separadas por coma | Por fijar tras conocer las URLs de Amplify |
| `prod` | El dominio del frontend en `prod` (aún no existe, infra:C9) | Por fijar tras crear el dominio |

## 6. Detrás del balanceador

| Aspecto | Estado |
|---|---|
| `trust proxy` | `app.set('trust proxy', 1)` en `index.js` **(I2 resuelto)**. Cadena: nginx (loopback) → Express; 1 salto. |
| HTTPS | `prod` usa ALB con `ssl_certificate_arn` (HTTPS en el 443); `dev` usa CloudFront como terminador HTTPS delante de Beanstalk (`enable_cdn = true`) **(I4 resuelto)** |
| Salida SMTP (`smtp.gmail.com:587`) | Sin regla de grupo de seguridad específica en el módulo `beanstalk`; se asume la salida por defecto del grupo del VPC por defecto **(por confirmar)** |
| Memoria e instancia | `t3.nano` (0.5 GiB de RAM) en los dos entornos, 1 a 3 instancias en prod, 1 fija en dev. El backend carga los Excel enteros en memoria (`multer` sin límite de tamaño, hallazgo interno M6): con `t3.nano`, un Excel grande es un riesgo real de memoria, no solo teórico |

## 7. Tabla de discrepancias

Ver el resumen de la sección 1. Estado y responsable:

| Id | Responsable | Acción |
|---|---|---|
| ~~**I1**~~ | ~~Infraestructura~~ | **Resuelto (feature/testing de infra)**: `HealthCheckPath = "/healthcheck"` en `modules/beanstalk/main.tf` |
| ~~**I2**~~ | ~~Backend~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', 1)` en `index.js` |
| ~~**I3**~~ | ~~Ambos~~ | **Resuelto (30/09/2026)**: `app_env_vars` incluye todas las obligatorias en los `.tfvars.example` |
| ~~**I4**~~ | ~~Infraestructura y frontend~~ | **Resuelto (feature/testing de infra)**: CloudFront (`enable_cdn = true`) termina HTTPS en dev |
| **I5** | Infraestructura | Confirmar que el grupo de seguridad del VPC por defecto permite salida a `smtp.gmail.com:587` **(por confirmar en la cuenta real)** |
| ~~**I6**~~ | ~~Infraestructura~~ | **Resuelto (04/10/2026)**: módulo `backend-ci-iam` + GitHub Actions workflow; el CI despliega automáticamente en Beanstalk |

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
