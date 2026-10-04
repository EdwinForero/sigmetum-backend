# Arquitectura

## Visión general

Monolito Express pequeño, sin base de datos. S3 actúa como única capa de persistencia: los Excel originales, los JSON "activos" que consume el frontend, las imágenes de la galería y el glosario de términos se guardan como objetos en un solo bucket.

```
          Frontend React (Amplify)
                    │  HTTPS  (CORS: ALLOWED_ORIGIN)
                    ▼
     ┌──────────────────────────────────┐
     │  ALB (solo prod) → Elastic       │
     │  Beanstalk · Node.js · t3.nano   │
     │                                  │
     │  index.js                        │
     │   ├─ /healthcheck                │
     │   ├─ morgan · cors · json · gzip │
     │   ├─ routes/auth.js              │
     │   ├─ routes/data.js              │
     │   ├─ routes/content.js           │
     │   └─ errorHandler                │
     └───────┬───────────────┬──────────┘
             │ AWS SDK v3    │ SMTP (Gmail)
             ▼               ▼
        Bucket S3        Buzón EMAIL
```

## Capas

| Capa | Carpeta | Responsabilidad |
|---|---|---|
| Arranque | `index.js`, `config/` | Carga `.env`, valida variables, registra middlewares y rutas |
| Rutas (controladores) | `routes/` | Validan entrada, orquestan llamadas, dan forma a la respuesta |
| Lógica auxiliar | `functions/` | Autenticación, parseo de Excel, nombres y versiones de fichero |
| Acceso a datos | `aws/awsS3connect.js` | Único punto de contacto con S3 |
| Errores | `middleware/errorHandler.js` | Traduce excepciones a respuestas JSON uniformes |

Las rutas no hablan con S3 directamente: siempre pasan por `awsS3connect.js`. Las rutas de S3 (prefijos) no se escriben a mano: salen de `config/s3Paths.js`.

## Flujo de una petición

1. `morgan('combined')` registra la petición.
2. `cors` sólo acepta el origen `ALLOWED_ORIGIN`.
3. `express.json()` parsea el body; `compression()` comprime la respuesta.
4. El router correspondiente (bajo `API_PREFIX`, por defecto `/api/v1`) procesa la ruta.
   - Rutas públicas: se atienden directamente.
   - Rutas protegidas: pasan antes por `tokenAuth` (cabecera `Authorization: Bearer <jwt>`).
5. Si algo falla, el handler llama a `next(error)` y `errorHandler` responde `{ success: false, error }` con el status adecuado.

`/healthcheck` se registra **antes** de los middlewares para que el health check del balanceador no genere logs ni dependa de CORS.

## Convenciones

- **Formato de respuesta**: siempre `{ success: true, data }` o `{ success: false, error }`.
- **Errores**: `try/catch` + `next(error)`. Validaciones de entrada responden 400 directamente.
- **Rutas protegidas**: cada router define un `protectedRouter` con `protectedRouter.use(tokenAuth)` y lo monta al final con `router.use(protectedRouter)`.
- **Subidas**: `multer` con `memoryStorage` (el fichero nunca toca disco; va de memoria a S3).

## Manejo de procesos

`index.js` registra:
- `uncaughtException` → log y `process.exit(1)` (Beanstalk reinicia el proceso).
- `unhandledRejection` → sólo log; el proceso sigue vivo.

## Despliegue

Definido en el repo **sigmetum-infra** (Terraform, región `eu-west-1`):

| | Dev | Prod |
|---|---|---|
| Beanstalk env | `sigmetum-backend-dev-env` | `sigmetum-backend-prod-env` |
| Instancias | 1 × t3.nano, sin balanceador | 1–3 × t3.nano con ALB y auto scaling |
| HTTPS | No | Sí (ACM) |
| DNS | — | `backend.sigmetum-a.org` |
| Bucket | `sigmetum-app-dev` | `sigmetum-app-prod` |

En Beanstalk el SDK de AWS obtiene credenciales del IAM role de la instancia (sin claves en el entorno). En local se usa un perfil SSO (ver [03-configuracion.md](03-configuracion.md)).

Como en prod hay hasta 3 instancias detrás del ALB, el backend debe seguir siendo **sin estado**: nada de caché o colas en memoria del proceso. Hoy lo cumple (todo el estado está en S3 y el JWT es autocontenido).
