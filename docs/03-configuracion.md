# Configuración y ejecución

## Puesta en marcha local

```bash
npm install
cp .env.example .env      # y rellenar valores
aws sso login --profile <tu-perfil>
npm start                 # o: npx nodemon index.js
```

El servidor escucha en `PORT` (8000 por defecto). Comprobación rápida: `GET http://localhost:8000/healthcheck` → `ok`.

## Scripts de npm

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servidor (`node index.js`) |
| `npm test` | Placeholder de `npm init`: falla siempre, porque aún no hay tests (ver M11 en [07](07-estado-y-deuda-tecnica.md)) |
| `npm run lint` | ESLint 9: falla con errores o si los avisos superan el tope de `--max-warnings` de `package.json` |
| `npm run quality` | Puerta de calidad y seguridad: patrones prohibidos, rutas sin autenticación, variables sin declarar, secretos, `npm audit` de producción y ESLint (ver [seguridad.md](guias/seguridad.md)) |
| `npm run verificar:rutas` | Comprueba todas las rutas contra la pila real de Express con S3 y SMTP sustituidos por espías (sin red ni credenciales): las públicas responden sin token, las protegidas dan `401` y cada ruta está clasificada. Sale con 0 si todo pasa. También lo ejecuta `npm run quality` (ver [mantenimiento.md](guias/mantenimiento.md#script-de-verificación-de-rutas-m21)) |
| `npm run docs:check` | Comprueba que `docs/` coincide con el código (ver [mantenimiento.md](guias/mantenimiento.md)). Con `-- --metrics` imprime las métricas reales |
| `npm run docs:gate` | Cierre documental del flujo agéntico: comprueba que los archivos cambiados respecto a `HEAD` llevan sus documentos, que [07](07-estado-y-deuda-tecnica.md) está modificado y con la fecha de hoy, y que hay aviso para PR si se tocó un área de contrato. Mide una iteración contra `HEAD`, así que se ejecuta con el árbol limpio de iteraciones previas (ver [mantenimiento.md](guias/mantenimiento.md#lo-que-comprueba-npm-run-docsgate)) |
| `npm run agentes:test` | Pruebas de `plugins/` (núcleo `ciclo-agentico` y marketplace local) con `node:test`. No son tests de la API (M11 sigue abierto) |
| `npm run agentes:bootstrap` | En un equipo nuevo, comprueba con `claude plugin list --json` qué plugins del catálogo del flujo agéntico faltan y pregunta antes de instalar cada uno. Con `-- --dry-run` solo informa |

Para recarga en caliente no hay script: usa `npx nodemon index.js` (hallazgo B2 en [07](07-estado-y-deuda-tecnica.md)).

## Flujo agéntico

El desarrollo con agentes de Claude Code sigue el plugin `ciclo-agentico` (`plugins/ciclo-agentico/`); la instalación y los pasos de un equipo nuevo están en [README.md](README.md#equipo-nuevo). Dos archivos lo configuran en este repositorio:

- `.claude/flujo.json`: adaptador del ciclo al proyecto (guías, documento de estado y su fecha, comandos de verificación, qué documentos corresponden a cada área de código, áreas de contrato, consultor y estilo). Se valida con `node plugins/ciclo-agentico/scripts/docs-gate.mjs --solo-validar`.
- `.claude/settings.json`: marketplaces y plugins compartidos del proyecto, permisos que piden confirmación antes de `git commit`, `git push`, `git add` y `git stash`, y la memoria automática configurada con `autoMemoryEnabled: false`; que de verdad se deje de cargar está **(por confirmar)** (Tarea 10, M18 de [07](07-estado-y-deuda-tecnica.md)).

## Variables de entorno

`config/validateEnv.js` aborta el arranque si falta alguna obligatoria.

| Variable | Obligatoria | Ejemplo | Descripción |
|---|---|---|---|
| `NODE_ENV` | No | `local` | Con `local`: credenciales SSO, stack traces en logs y `AWS_PROFILE` pasa a ser obligatoria |
| `PORT` | No | `8000` | Puerto HTTP |
| `API_PREFIX` | No | `/api/v1` | Prefijo de todas las rutas (salvo `/healthcheck`) |
| `AWS_REGION` | Sí | `eu-west-3` | Región del bucket |
| `AWS_BUCKET_NAME` | Sí | `sigmetum-app-assets-dev` | Bucket de la aplicación |
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

Seguir la skill `env-var-change` (ver [plugins/README.md](../plugins/README.md)): añadirla a `validateEnv.js`, a `.env.example` y al entorno de Beanstalk en sigmetum-infra.
