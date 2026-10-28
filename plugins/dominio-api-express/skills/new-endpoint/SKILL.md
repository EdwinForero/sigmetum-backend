---
name: new-endpoint
description: Lista de comprobación para añadir o modificar una ruta (endpoint) en un backend Express. Úsala al crear o cambiar un manejador de ruta.
---

# Nueva ruta en Express

Sigue las convenciones de las rutas que ya existen en el proyecto; las normas y su motivo están en las `guias` de `.claude/flujo.json` (buenas prácticas y seguridad).

1. **Router**: las rutas públicas van en el router base; toda ruta que modifique estado (`POST`, `PUT`, `PATCH`, `DELETE`) o necesite autenticación va en el router protegido con el middleware de token, salvo una excepción registrada y justificada.
2. **Validación de entrada**: valida explícitamente los parámetros de cuerpo y consulta, y responde `400` con `{ success: false, error }` antes de tocar el almacenamiento, la autenticación o el sistema de archivos.
3. **Errores**: envuelve el manejador `async` en `try/catch` y llama a `next(error)`; no respondas el error directamente ni devuelvas el `err.message` de un error interno: lo formatea el manejador de errores central.
4. **Forma de la respuesta**: siempre `{ success: true, data }` o `{ success: false, error }`.
5. **Subida de archivos**: usa multer con almacenamiento en memoria, como las rutas existentes, no en disco; valida tipo y tamaño.
6. **Variables de entorno nuevas**: aplica la skill `env-var-change`.
7. **S3**: si el endpoint toca S3, aplica además la skill `s3-operation-review`.
8. **Límite de peticiones y CORS**: comprueba que la ruta queda cubierta por el limitador y la configuración CORS globales; no los esquives.
9. **Montaje**: si es un archivo de rutas nuevo, comprueba que se importa y se monta en el punto de entrada de la aplicación.
10. **Contrato con el frontend**: una ruta nueva o un cambio de formato afecta al contrato; consulta las guías de `integracion` de `.claude/flujo.json`.
11. **Documentación y verificación**: aplica `docsRegla` de `.claude/flujo.json` (tablas de endpoints y métricas) y ejecuta las entradas de `verificacion`.
