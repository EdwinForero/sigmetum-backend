# Login sin contraseña (A7) y entradas sin validar (A3): spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Hoy, un `POST /log` con el usuario correcto y sin `password` (o con un valor que no es cadena) deja la petición sin respuesta (A7). Varias rutas con entrada ausente o de tipo incorrecto responden 500, o 200 con un resultado inútil, en lugar de 400 (A3). Se pretende que cada una de esas entradas reciba una respuesta rápida y de entrada inválida, sin conexiones colgadas ni rechazos sin capturar. Cierra la parte de backend de D3.

## Criterios de aceptación

### De código

Comportamiento actual leído en el código (no ejecutado en esta fase). No hay base de tests (M11): cada criterio se comprueba con una petición real contra el servidor local (`npm start`) y se registra el resultado.

1. `POST /log` con `username` correcto y sin `password` responde en menos de 1 segundo con `{ success: false, error }` y estado 400. Lo mismo con `password` que no sea cadena (número, objeto, `null`) y con `username` ausente o que no sea cadena.
2. `POST /log` con credenciales incorrectas (cadenas válidas) sigue respondiendo 401 `Invalid credentials`, y con credenciales correctas sigue devolviendo `{ success: true, data: { token } }`.
3. Un fallo inesperado dentro de `userAuth` llega a `middleware/errorHandler.js` y la petición recibe respuesta; no queda ningún `unhandledRejection` por esta ruta.
4. `POST /upload` sin fichero (`req.file` ausente) responde 400 `{ success: false, error }` en lugar de 500.
5. `POST /upload` con un fichero que no es `.xlsx` responde 400. Criterio de "no es `.xlsx`" pendiente de la pregunta 2.
6. `POST /update-file` y `POST /delete-file` sin `fileName`, o con `fileName` que no es cadena, responden 400 en lugar de 500.
7. `POST /upload-term` con `term` que no es cadena (número, objeto, ausente) responde 400; con cadena vacía o solo espacios sigue respondiendo 400 `Term cannot be empty`.
8. `GET /get-image` sin `imageKey` responde 400 en lugar de 200 con una URL a `gallery/undefined`.
9. `POST /send-email` sin `username`, `email`, `subject` o `message` (o con alguno que no sea cadena) responde 400 y no envía correo. Incluido o no según la pregunta 3.
10. Las respuestas 400 nuevas usan el formato `{ success: false, error }` y no incluyen `err.message` de un error interno.
11. Las peticiones válidas de todas estas rutas se comportan igual que antes (mismo estado, mismo cuerpo).
12. `npm run lint` y `npm run quality` pasan, sin avisos nuevos respecto al estado previo.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: A7 y A3 marcados como resueltos (o la parte de A3 que quede fuera, con su motivo); D3 indica que la parte de backend está resuelta y queda la del frontend (`accept` de `FileUpload`); fecha "actualizado" y métricas al día.
2. `docs/04-api.md`: cada ruta afectada documenta sus respuestas 400 nuevas y qué entrada las provoca.
3. `docs/guias/buenas-practicas-backend.md` (sección 4, tabla de validación por ruta): refleja lo que valida ahora cada ruta.
4. `docs/05-modulos.md`: actualizado si cambia el comportamiento documentado de `userAuth` o de los manejadores.
5. `docs/integracion/para-frontend.md`: la línea de códigos usados hoy ya no remite a A3 como parcial, si se resuelve por completo.

## Fuera de alcance

- Limitador de intentos del login (M12) y limitador de `/send-email` (M3, salvo la validación de campos si se decide incluirla).
- Validar que la clave de `/update-file` y `/delete-file` encaje con `data/{provincia}/AAAA-MM-DD_vN.xlsx` (M4); aquí solo se exige presencia y tipo de cadena.
- Lista blanca de MIME o límite de tamaño en `/upload-image` y `multer` (M5, M6).
- Sanear la provincia del Excel (A4), borradores (A2), galería vacía (A5), `getTextJsonS3` (A6).
- Cambios en el frontend (`accept` de `FileUpload` en D3).
- Añadir una base de tests (M11).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta, y es un cambio compatible según su propio criterio ("una validación de entrada más estricta que antes daba 500 y ahora da 400"), pero hay que confirmar tres cosas: (a) `POST /log` sin contraseña pasa de no responder a 400; el frontend puede no distinguir 400 de 401 (pregunta 1); (b) `/get-image` sin `imageKey` pasa de 200 a 400, un cambio de estado en un caso que antes "funcionaba"; (c) los mensajes `error` nuevos se mostrarán o no en la interfaz. No cambian rutas, formato `{ success, data|error }` ni JWT.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno, permisos ni endpoints nuevos).

## Decisiones del usuario (28/10/2026)

1. `POST /log` con `username` o `password` ausentes o que no son cadena: 400 con mensaje propio (compatible según para-frontend.md; antes se colgaba).
2. `POST /upload`: un `.xlsx` válido se comprueba por extensión y MIME.
3. `POST /send-email` entra en A3 solo para presencia y tipo de campos; formato, longitudes y límite de peticiones quedan para M3.
4. `GET /get-image` sin `imageKey`: pasa de 200 a 400 (que el frontend no la llame sin clave está por confirmar).
5. Mensajes de los 400 nuevos: en inglés, como los actuales.

### Ampliación tras la segunda opinión sobre el plan (28/10/2026)

6. `POST /upload`: el criterio de MIME es tolerante. Se acepta la extensión `.xlsx` con el MIME de xlsx, `application/octet-stream` o MIME vacío (el MIME lo manda el cliente y algunos navegadores no lo informan); sustituye a la exigencia estricta de la decisión 2.
7. Entran en A3 los manejadores con la misma entrada sin tipar: `POST /upload/confirm` (`draftKey`), `POST /upload-image` (`title`), `/delete-image` y `/delete-term`: 400 si el campo falta o no es cadena. Sus claves de S3 siguen sin validarse contra lista de permitidos (M4/M5, fuera de alcance).
8. Un `MulterError` (por ejemplo, campo multipart con nombre incorrecto) responde 400 en lugar de 500.
9. `userAuth` pasa los fallos inesperados a `errorHandler`; que `errorHandler` devuelva `err.message` en 5xx es M17 (fuera de alcance).

## Preguntas abiertas

Ninguna.
