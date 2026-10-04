# Integración con el frontend: lo que ofrece y necesita el backend

Documento para quien mantiene `sigmetum-frontend`. Sigue la convención de [../guias/mantenimiento.md](../guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura): dice qué garantiza este backend, qué espera del frontend, el estado de las discrepancias y qué avisar si algo cambia.

- Lo verificado contra el código está marcado **(verificado)**; lo deducido pero no probado, **(por confirmar)**.
- Fecha de la verificación: 30/09/2026. Backend: rama `feature/sigmetum_v2`, commit `ace5367`. Frontend: rama `feature/sigmetum_front_v2`, commit `f805222`.
- La referencia completa de la API es [../04-api.md](../04-api.md); aquí no se repite.
- Los ids de este documento llevan el prefijo **F**. Al citarlos desde otro repositorio: `backend:F1`. Los que cita este documento del frontend llevan su prefijo: `frontend:D2`.

## 1. Resumen

| Id | Qué pasa | Efecto |
|---|---|---|
| **F1** | `GET /get-data/:path(*)` es público y lee cualquier clave del bucket, pero es el único endpoint que puede abrir una versión histórica | El frontend lo usa para abrir un Excel de versión, que hoy da error (`frontend:D1`). No se puede cerrar sin dar antes un sustituto |
| **F2** | `POST /upload` responde el `processedData` completo en el 400 de fila vacía | Con un Excel grande, la respuesta pesa más de lo necesario; el frontend no lo usa (`frontend:D8`) |
| **F3** | `GET /list-images` responde 500 si la galería está vacía, en vez de `[]` | El frontend trata ese 500 como "error al cargar" en lugar de "sin imágenes" (`frontend:D5`) |
| **F4** | El login (`POST /log`) puede quedarse sin responder si falta `password` | Una petición del frontend sin ese campo no recibiría respuesta (hallazgo interno A7, no reportado por el frontend) |

## 2. Qué garantiza el backend

### Envoltorio y códigos de estado

| Garantía | Detalle |
|---|---|
| Envoltorio único | Toda respuesta es `{ success: true, data }` o `{ success: false, error }` **(verificado)** |
| Éxito | `response.ok` (2xx) y `success: true` van siempre juntos |
| Códigos usados hoy | `200` éxito, `400` entrada inválida (parcial: ver F4 y el hallazgo interno A3), `401` sin token o inválido, `429` límite de intentos del login, `500` fallo interno o de S3 |
| No usados hoy, pero reservados por la garantía de versionado | `403`, `404` explícitos (hoy varios casos devuelven 500; ver la nota de la sección 5) |
| Mensaje de error | `error` es un texto en inglés, pensado para depurar, no para mostrar tal cual al usuario (coincide con lo que ya hace `services/api.js`) |

### Estabilidad de `/api/v1`

- El prefijo `API_PREFIX` (`/api/v1` por defecto) es estable: no cambia sin subir a un prefijo nuevo.
- **Cambio compatible** (no rompe `/api/v1`): un campo nuevo en una respuesta, un endpoint nuevo, una validación de entrada más estricta que antes daba 500 y ahora da 400.
- **Cambio incompatible** (exige `/api/v2`): renombrar o quitar un campo que el frontend lee, cambiar el envoltorio `{ success, data | error }`, cambiar `fixedColumnOrder` (las 11 columnas del Excel, por nombre u orden), cambiar el formato de nombre de versión (`AAAA-MM-DD_vN.xlsx`), cambiar qué campos lleva el JWT o cómo caduca.
- **Procedimiento para un cambio incompatible:** se sirve en un prefijo nuevo (`/api/v2`) mientras `/api/v1` sigue funcionando. Plazo de retirada propuesto: **al menos una versión de despliegue de ambos repositorios** después de que el frontend confirme la migración, nunca una fecha fija por calendario. Se avisa en la PR que introduce el cambio y se anota aquí, en la sección 5.
- Hoy no hay ningún cambio incompatible planeado.

### Campos que lee el frontend, contrastados

Contra la sección 2 de `../sigmetum-frontend/docs/integracion/para-backend.md` (30/09/2026). El backend no cambia la forma de estos campos sin pasar por la política de arriba:

| Endpoint | Campos que lee el frontend | Backend los garantiza |
|---|---|---|
| `POST /log` | `data.token` | Sí |
| `GET /auth` | Solo el código de estado | Sí |
| `GET /get-merged-data` | `data`: array de registros con las 11 columnas | Sí |
| `GET /list-files` | `data`: `{ [provincia]: [{ key, name }] }` | Sí |
| `GET /get-data/<key>` | `data`: array de registros | **No, si `<key>` es un `.xlsx`** (ver F1) |
| `POST /upload` | Con `400`: `data.emptyFields[].rowIndex`, `data.draftKey`. Con `200`: solo el estado | Sí, aunque el `400` incluye más de lo que se necesita (F2) |
| `POST /upload/confirm`, `POST /update-file`, `POST /delete-file` | Solo el estado | Sí |
| `GET /list-terms` | `data`: `[{ term }]` | Sí |
| `GET /list-images` | `data`: `[{ fileName, url }]` | Sí, **salvo con la galería vacía** (F3) |
| `POST /upload-image`, `DELETE /delete-image`, `POST /upload-term`, `DELETE /delete-term`, `POST /send-email` | Solo el estado | Sí |
| `GET /get-image?imageKey=` | `data.imageUrl` | Sí (sin pantalla que lo use hoy, según el frontend) |

## 3. Qué espera el backend del frontend

| Requisito | Detalle |
|---|---|
| Autenticación | Cabecera `Authorization: Bearer <token>` en toda ruta protegida (🔒 en [../04-api.md](../04-api.md)) |
| Cuerpo de las peticiones | JSON con `Content-Type: application/json`, salvo `POST /upload`, `POST /upload/confirm` (multipart) y `POST /upload-image` (multipart) |
| Campos multipart | `POST /upload`: campo `file`. `POST /upload-image`: campos `file` y `title` |
| Tipo de fichero en `/upload` | Solo `.xlsx` (`workbook.xlsx.load`); el backend no valida hoy la extensión, así que un fichero de otro tipo no da un error claro (hallazgo interno A3/D3: el frontend debería restringir el selector a `.xlsx`, no solo mostrar más tipos de los que el backend acepta) |
| `GET /get-data` | **No usarlo para abrir un Excel de versión** (F1): hoy intenta `JSON.parse` de un binario. Úsese solo para leer un JSON ya existente bajo `data/active/` |
| Límite de peticiones | `POST /log` corta a 10 intentos cada 15 minutos por IP y responde `429` con `{ success: false, error }`. El frontend debería distinguir ese código del resto (`frontend:D7`) |
| CORS | El origen debe coincidir **exactamente** con `ALLOWED_ORIGIN` del entorno; sin barra final |

## 4. Discrepancias vigentes

Clasificación de `D1` a `D9` de `../sigmetum-frontend/docs/integracion/para-backend.md` (30/09/2026), más lo que solo ve este lado. El detalle completo, con archivo y línea, está en ese documento y en [../07-estado-y-deuda-tecnica.md](../07-estado-y-deuda-tecnica.md).

| Id | Responsable de actuar | Acción pendiente en el backend |
|---|---|---|
| `frontend:D1` (F1) | Backend y frontend | Crear un endpoint que convierta un Excel de versión en registros (`convertExcelToJson`), limitado a claves `data/{provincia}/AAAA-MM-DD_vN.xlsx`. No cerrar `GET /get-data` hasta entonces |
| `frontend:D2` | Solo frontend | Ninguna; el formato `AAAA-MM-DD_vN.xlsx` no cambia sin aviso |
| `frontend:D3` | Frontend y backend | Validar `req.file` y la extensión en `POST /upload` (hoy da 500 sin fichero) |
| `frontend:D4` | Solo frontend | Ninguna |
| `frontend:D5` (F3) | Backend | Devolver `[]` en vez de 500 cuando la galería está vacía |
| `frontend:D6` | Solo frontend | Ninguna |
| `frontend:D7` | Frontend (y ver M12 de este repo) | El límite de 10 intentos solo es fiable si `trust proxy` está bien configurado detrás del ALB; sin eso, el 429 puede dispararse para todos los clientes a la vez |
| `frontend:D8` (F2) | Backend | Omitir o limitar `processedData` en el 400 de `POST /upload` |
| `frontend:D9` | Ninguno (informativa) | — |

## 5. Si cambias algo en el backend

| Si cambias... | El frontend debe actualizar... |
|---|---|
| El prefijo de la API | `VITE_API_PREFIX` (Amplify, ver `../sigmetum-infra`) |
| Una ruta, su método o si es pública o protegida | `src/services/api.js` y el componente que la llama |
| El envoltorio `{ success, data \| error }` | `src/services/api.js` (un único sitio) |
| `fixedColumnOrder` (nombre, orden o número de columnas) | Traducciones (`attributes.*`), `DialogSpecies.js`, `Filter`/`Explore` |
| El formato de nombres de versión | `utilities/FormatFileName.js`, `FileDropdown` |
| La forma de `emptyFields` o `draftKey` en el 400 de `/upload` | `components/FileUpload.js` |
| Los campos de `/list-files` | `components/FileDropdown.js` |
| Las claves del JWT o cómo caduca | `components/ProtectedRoute.js` |
| `ALLOWED_ORIGIN` de un entorno | Nada en el código; confirmar que coincide con el dominio real del frontend de ese entorno (`../sigmetum-infra`) |
| Se crea el endpoint de F1 | `FileDropdown.handleVersionSelect` |
| Se cierra o restringe `GET /get-data` | Solo después de resolver F1 |
| Límites de tamaño o tipo en `/upload` o `/upload-image` | `accept` y mensajes de los formularios |

**Orden de despliegue:** un cambio incompatible se despliega primero en el backend bajo el prefijo nuevo, manteniendo el anterior activo, y solo después se actualiza el frontend para consumirlo. Un cambio compatible no exige orden especial.

## 6. Cómo mantener este documento

- Se actualiza en el mismo commit que cambia cualquiera de los archivos de la sección 5, siguiendo [../guias/mantenimiento.md](../guias/mantenimiento.md).
- Las discrepancias resueltas se verifican contra el código del frontend, se pasan a una línea del historial de [../07-estado-y-deuda-tecnica.md](../07-estado-y-deuda-tecnica.md) y se quitan de la tabla de la sección 4.
- Si el frontend actualiza su `para-backend.md` con una discrepancia nueva, se revisa aquí y se clasifica.
