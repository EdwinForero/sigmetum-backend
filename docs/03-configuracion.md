# Configuración y ejecución

## Puesta en marcha local

```bash
npm install
cp .env.example .env      # y rellenar valores
aws sso login --profile <tu-perfil>
npm start                 # o: npx nodemon index.js
```

El servidor escucha en `PORT` (8000 por defecto). Comprobación rápida: `GET http://localhost:8000/healthcheck` → `ok`.

## Variables de entorno

`config/validateEnv.js` aborta el arranque si falta alguna obligatoria.

| Variable | Obligatoria | Ejemplo | Descripción |
|---|---|---|---|
| `NODE_ENV` | No | `local` | Con `local`: credenciales SSO, stack traces en logs y `AWS_PROFILE` pasa a ser obligatoria |
| `PORT` | No | `8000` | Puerto HTTP |
| `API_PREFIX` | No | `/api/v1` | Prefijo de todas las rutas (salvo `/healthcheck`) |
| `AWS_REGION` | Sí | `eu-west-1` | Región del bucket |
| `AWS_BUCKET_NAME` | Sí | `sigmetum-app-dev` | Bucket de la aplicación |
| `AWS_PROFILE` | Sólo si `NODE_ENV=local` | `my-sso-profile` | Perfil SSO de AWS CLI |
| `JWT_SECRET` | Sí | — | Secreto de firma de los JWT |
| `JWT_EXPIRATION` | Sí | `8h` | Caducidad del token (formato de `jsonwebtoken`) |
| `ADMIN_USERNAME` | Sí | — | Usuario administrador |
| `ADMIN_PASSWORD` | Sí | `$2b$10$...` | **Hash bcrypt** de la contraseña, no la contraseña en claro |
| `EMAIL` | Sí | — | Cuenta Gmail que envía y recibe el formulario de contacto |
| `EMAIL_PASSWORD` | Sí | — | Contraseña de aplicación de Gmail |
| `ALLOWED_ORIGIN` | Sí | `http://localhost:3000` | Origen del frontend permitido por CORS |

### Generar el hash de `ADMIN_PASSWORD`

`userAuthentication.js` hace `bcrypt.compare(password, ADMIN_PASSWORD)`, así que la variable debe contener un hash:

```bash
node -e "require('bcrypt').hash('mi-contraseña', 10).then(console.log)"
```

## Credenciales AWS

`aws/awsS3connect.js` crea el cliente así:

- `NODE_ENV=local` → `fromSSO({ profile: AWS_PROFILE })`. Hay que haber hecho `aws sso login` antes.
- Cualquier otro valor → sin credenciales explícitas; el SDK usa la cadena por defecto, que en Beanstalk resuelve al IAM role de la instancia.

Nunca se usan `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` en el código.

## Añadir una variable nueva

Seguir la skill `.claude/skills/env-var-change`: añadirla a `validateEnv.js`, a `.env.example` y al entorno de Beanstalk en sigmetum-infra.
