# Aviso para PR: validación de entradas, A7 y A3 (28/10/2026)

## Qué cambia

- `POST /log`: con `username` o `password` ausentes o que no son cadenas responde `400` (antes la petición se quedaba sin respuesta, A7). `userAuth` captura errores y llama a `next(error)`.
- `POST /upload`: `400` sin fichero (`File is required`) y `400` si la extensión no es `.xlsx` o el MIME no es el de xlsx, `application/octet-stream` o vacío (`Only .xlsx files are allowed`).
- `400` por campo ausente o que no es cadena en `/upload/confirm` (`draftKey`), `/update-file` y `/delete-file` (`fileName`), `/upload-term` (`term`), `/upload-image` (`title`), `/delete-image` (`imageKey`), `/delete-term` (`term`), `GET /get-image` (`imageKey`) y `POST /send-email` (los cuatro campos).
- `middleware/errorHandler.js`: un `MulterError` responde `400` en vez de `500`.
- Sin dependencias nuevas, sin cambios en `.env.example` ni en `package.json`.

## Frontend

Cambio compatible según [para-frontend](../integracion/para-frontend.md) (una validación más estricta que antes daba 500 o no respondía). Qué debe confirmar el equipo del frontend:

1. `GET /get-image` sin `imageKey` pasa de `200` (URL a `gallery/undefined`) a `400`. Confirmar que no se llama sin clave **(por confirmar)**.
2. `POST /log` sin contraseña pasa de no responder a `400`; confirmar que `LoginForm` no trata los `400` y los `401` de forma distinta de modo que rompa algo **(por confirmar)**.
3. Un `.xlsx` que el navegador envíe sin tipo MIME podría recibir `400` si el servidor lo informa como `text/plain` **(por confirmar con un navegador real)**.
4. D3: pendiente solo el `accept` de `FileUpload` (`.xlsx`).
5. **Hallazgo previo M21 (no es de esta PR)**: `tokenAuth` se ejecuta también para `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms` (se monta `router.use(protectedRouter)` sin ruta en `data.js`, antes que `content.js`), así que sin token responden `401`. Verificado con una petición real local; en producción **por confirmar**. Si ocurre allí, el formulario de contacto y la galería no funcionan sin sesión. Los `400` de `/send-email` y `/get-image` de esta PR solo se alcanzan con token. No se corrige aquí.

Orden de despliegue: sin orden especial (cambio compatible).

## Infraestructura

Nada: ni variables de entorno, ni permisos de S3, ni endpoints nuevos.

## Para el usuario

- Prueba manual pendiente, con S3 y SMTP reales: una petición válida por ruta (mismo estado y cuerpo que antes), el login con las credenciales reales y un `.xlsx` desde el navegador.
- Sin base de tests (M11): las comprobaciones fueron peticiones reales a `npm start` local con entorno ficticio.
- La guía [buenas prácticas](../guias/buenas-practicas-backend.md#4-validación-de-entrada) pide una función de validación por forma de entrada, pero el plan aprobado usa comprobaciones en línea; el choque está anotado en la guía.
- Decidir M21 (prioridad candidata): confirmar en el despliegue y, si las rutas deben ser públicas, montar el `protectedRouter` con ruta propia o asignar `tokenAuth` por ruta (cambio de contrato: sin token pasarían de 401 a 200).
