---
name: s3-operation-review
description: Lista de comprobación para revisar o añadir operaciones de S3 (subir, borrar, listar, URL prefirmadas). Úsala al tocar la lógica del bucket, el versionado de objetos o la generación de URL prefirmadas.
---

# Revisión de operaciones de S3

Mantén el trabajo nuevo coherente con la capa de acceso a S3, el módulo de rutas de claves y la lógica de versionado que ya tenga el proyecto; las normas y su motivo están en las `guias` de `.claude/flujo.json` (buenas prácticas y seguridad).

1. **Claves centralizadas**: nunca escribas a mano prefijos de claves; usa o amplía el módulo de rutas de claves del proyecto. Las llamadas a S3 solo viven en la capa de acceso, sin lógica de negocio.
2. **Entrada validada**: el texto del cliente o de un archivo importado que forme parte de una clave se valida antes contra una lista de permitidos.
3. **Caducidad de URL prefirmadas**: explícita y razonable (corta para escritura; más larga solo para contenido público de lectura).
4. **Tipo de contenido**: comprueba el tipo MIME y la extensión de lo subido antes de subirlo; no te fíes del cliente.
5. **Credenciales**: salen del proveedor de credenciales del SDK (perfil o rol), nunca escritas en el código; el módulo de validación de entorno cubre las variables de AWS necesarias.
6. **Nombre del bucket**: siempre desde su variable de entorno, nunca un literal.
7. **Versionado**: si la operación crea o sobrescribe objetos, pasa por la lógica de versionado existente en lugar de reinventarla.
8. **Una sola convención**: lanza los errores, pagina los listados y paraleliza como el resto de la capa.
9. **Propagación de errores**: los errores del SDK (`NoSuchKey`, `NoSuchBucket`, `AccessDenied`, de red) llegan por `next(error)` al manejador central, que los traduce; no los tragues ni los envuelvas con un mensaje genérico.
10. **Mínimo privilegio**: cada acción nueva se corresponde con el permiso IAM mínimo (nada de `s3:*` para leer); avisa a la infraestructura si hace falta un permiso nuevo.
11. **Contrato con el frontend**: si cambia el formato de los nombres de versión o la estructura de claves, consulta las guías de `integracion` de `.claude/flujo.json`.
12. **Documentación y verificación**: aplica `docsRegla` de `.claude/flujo.json` (documentos de módulos y almacenamiento) y ejecuta las entradas de `verificacion`.
