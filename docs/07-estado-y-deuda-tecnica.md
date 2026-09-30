# Estado actual y deuda técnica

Análisis a fecha 2026-09-30, rama `feature/sigmetum_v2` (último commit `c36d60d refactor: restructure S3 bucket layout and versioning model`).

## Resumen

El código está limpio, es pequeño (~800 líneas) y sigue convenciones consistentes: formato de respuesta único, errores centralizados, validación de entorno al arrancar, rutas de S3 centralizadas y credenciales AWS por rol/SSO. Los dos refactors recientes (seguridad y layout de S3) dejaron una base razonable.

Lo que más pesa: **no hay tests**, hay **varios bugs latentes en el flujo de versionado** y **dos endpoints públicos más abiertos de lo necesario**.

## Bugs y comportamientos incorrectos

Ordenados por impacto.

### 1. `getNextVersion` y `formatFileName` usan zonas horarias distintas
`getNextVersion.js` calcula "hoy" con `toISOString()` (UTC); `formatFileName.js` usa la fecha local. En España (UTC+1/+2), entre las 00:00 y las 01:00–02:00 hora local el nombre lleva la fecha nueva pero la versión se calcula con la del día anterior. Resultado: la versión vuelve a `v1` aunque ya exista un `v1` de hoy → **se sobreescribe un Excel del historial**. En Beanstalk el servidor suele estar en UTC, así que el fallo aparece sobre todo en local, pero depende de la configuración del host.
**Arreglo**: usar la misma fuente de fecha en ambos (idealmente UTC en los dos).

### 2. Los borradores no confirmados cuentan como versiones reales
Una subida con celdas vacías deja el Excel en `data/{prov}/` antes de confirmar. Si el usuario nunca confirma ni cancela (cierra la pestaña), ese borrador:
- aparece en `/list-files` como una versión más, y
- si después se borra otra versión, `deleteFileFromS3` puede **activar el borrador** por ser el más reciente.

**Arreglo**: guardar borradores en un prefijo propio (`data/drafts/`) y moverlos al confirmar, o marcarlos con metadatos/tag de S3.

### 3. `POST /upload` sin fichero produce 500
`req.file.buffer` se lee sin comprobar `req.file`. Sin fichero → `TypeError` → 500 genérico. Tampoco se valida que sea un `.xlsx`.

### 4. La provincia del Excel se usa sin sanear como carpeta de S3
Se toma de la primera fila y va directa a la clave. Un valor `active` o `terms` escribiría Excels dentro de `data/active/` y rompería `/get-merged-data` (intentaría hacer `JSON.parse` de un xlsx). Mayúsculas/acentos distintos (`Málaga` vs `Malaga`) crean provincias duplicadas. Además, un Excel con varias provincias se guarda entero bajo la primera.

### 5. `/list-images` falla con la galería vacía
`getPresignedUrlsFromS3Folder` lanza `No files found` → 500 en lugar de `[]`.

### 6. `getTextJsonS3` oculta errores
Devuelve `[]` ante cualquier fallo, no sólo "no existe". Con un problema de permisos, `/list-terms` responde 200 vacío, y peor: `uploadTextToJsonS3` partiría de `[]` y **sobreescribiría el glosario entero** con un único término.

### 7. Condiciones de carrera en read-modify-write
Alta/baja de términos, versión siguiente y regeneración del activo leen y luego escriben sin bloqueo. Con dos administradores simultáneos (o dos instancias en prod) se pueden perder escrituras. Con un solo admin el riesgo es bajo.

## Seguridad

| Hallazgo | Riesgo | Sugerencia |
|---|---|---|
| `GET /get-data/:path(*)` es público y lee **cualquier clave** del bucket | Cualquiera puede leer cualquier JSON del bucket si conoce/adivina la clave | Restringir a `data/active/` o eliminar si el frontend ya usa `/get-merged-data` |
| `POST /send-email` público sin rate limit ni validación | Puede usarse para inundar el buzón y agotar la cuota de Gmail | Añadir `rateLimit` y validar campos/longitudes |
| `/update-file` y `/delete-file` no validan `fileName` | Un token válido podría borrar cualquier objeto (p. ej. un activo o el glosario) | Validar que la clave encaje con `data/{prov}/YYYY-MM-DD_vN.xlsx` |
| `/upload-image` no valida tipo MIME ni saneo completo del título | Se pueden subir ficheros no-imagen a la galería | Lista blanca de MIME y extensiones, sanear caracteres |
| `multer` sin `limits.fileSize` | Ficheros enormes se cargan enteros en memoria de una t3.nano | Poner límite (p. ej. 10 MB) |
| Sin cabeceras de seguridad (`helmet`) | Menor, es una API JSON | Opcional |

Lo que está bien: contraseña con bcrypt, JWT con caducidad, rate limit en login, CORS restringido, credenciales AWS por rol/SSO, stack traces sólo en local, `.env*` en `.gitignore`.

## Rendimiento y escalabilidad

- `getMergedDataInS3Folder` descarga los activos **en secuencia**. Con muchas provincias, la latencia crece linealmente. `Promise.all` lo resolvería.
- `/get-merged-data` recalcula todo en cada petición; es el endpoint más llamado y el contenido cambia pocas veces. Un caché (o generar un `merged.json` al activar versiones) lo aliviaría.
- `deleteFileFromS3` y `updateFileS3` descargan y reconvierten un Excel dentro de la petición. Candidatos naturales a procesamiento asíncrono si los ficheros crecen.
- `listFilesInS3Folder` no pagina: más de 1000 objetos bajo un prefijo se truncarían en silencio.

## Calidad y mantenimiento

- **Sin tests.** Es el mayor riesgo para seguir evolucionando. Prioridad: `convertExcelToJson`, `getNextVersion` y el flujo upload/confirm/delete (con S3 mockeado).
- `nodemon` instalado pero sin script `dev`.
- `package.json` sin `engines` (versión de Node no fijada; Beanstalk usará la de su plataforma).
- `.env.example` usa `AWS_BUCKET_NAME=sigmetum-dev`, pero el bucket real de dev en sigmetum-infra es `sigmetum-app-dev`.
- Usuario admin único en variables de entorno: correcto para el caso de uso actual, pero es un límite si alguna vez hay más de un editor.
- Mezcla de estilos: algunas funciones de S3 lanzan y otras devuelven `{ success: false }`; las rutas tienen que manejar ambos casos.

## Prioridades sugeridas

1. Arreglar la zona horaria de versionado (#1) y validar `req.file` (#3): cambios pequeños, evitan pérdida de datos y 500s.
2. Cerrar `/get-data` y añadir rate limit a `/send-email`.
3. Separar borradores (#2) y distinguir "no existe" de "error" en `getTextJsonS3` (#6).
4. Tests del flujo de datos.
5. Paralelizar/cachear `/get-merged-data`.
