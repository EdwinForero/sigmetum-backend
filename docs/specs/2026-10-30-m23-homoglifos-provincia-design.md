# M23, homoglifos en el nombre de provincia: spec

Fecha: 2026-10-30 · Estado: cerrado

## Objetivo

La regla de provincia admite cualquier letra Unicode (`\p{L}` más marcas, ver `config/s3Paths.js` y `docs/06-almacenamiento-s3.md#regla-de-provincia`). Un nombre como `Málaga` con una `а` cirílica pasa la validación y crea una carpeta de S3 visualmente idéntica a la real (`data/{provincia}/` y `data/drafts/{provincia}/`), con datos duplicados que nadie distingue en el panel.

Comportamiento actual (leído, no diseñado): el nombre sale de la columna `Provincia` de la primera fila del Excel (`POST /upload`; recorte y NFC) y se valida con `getProvinciaNameError`. `POST /upload/confirm`, `/update-file` y `/delete-file` reciben la provincia dentro de una clave (`draftKey`, `fileName`) y reutilizan esa misma regla, exigiendo además NFC. Los errores son `400` `Province is not valid` (o `required`, `reserved`, `more than one province`) en `POST /upload`, y `Invalid draftKey` / `Invalid fileName` en las otras tres rutas. No hay otro origen de nombres de provincia en las rutas leídas.

## Decisión de producto (tomada por el usuario el 2026-10-30)

Se adopta la **opción A: solo escritura latina con diacríticos**. Se admiten letras latinas con sus marcas (tildes, `ñ`, `ç`, etc.) y los separadores que la regla ya admite (un solo espacio o guion entre palabras). Se rechazan cirílico, griego y cualquier otro alfabeto. El resto de la regla actual (longitud, reservados, propiedades de objeto, NFC, una sola provincia por Excel) no cambia.

Alternativas descartadas, por si se retoman: B lista cerrada de provincias (catálogo y mantenimiento propios, cambio de producto mayor); C rechazo de alfabetos mezclados (no cubre un nombre entero confundible); D detección por esqueleto (depende de datos de confundibles y de una posible dependencia nueva).

Límite conocido aceptado: A no detecta confundibles dentro del propio alfabeto latino (p. ej. `I` mayúscula frente a `l` minúscula) ni cierra las variantes `Málaga`/`Malaga`/`málaga`.

## Criterios de aceptación

### De código

1. Una provincia con una letra no latina (ejemplo: `Málaga` con `а` cirílica U+0430; también una letra griega) en la columna `Provincia` de un Excel enviado a `POST /upload` responde `400` `Province is not valid` y no escribe nada en S3 (ni versión ni borrador). Test en `tests/` que falla hoy por ese motivo.
2. Las claves de `POST /upload/confirm`, `POST /update-file` y `POST /delete-file` con una provincia no latina responden `400` `Invalid draftKey` / `Invalid fileName`.
3. Todos los orígenes existentes de provincia pasan por la misma regla (columna del Excel y las tres rutas con clave); no hay una segunda definición de la regla.
4. Siguen aceptándose los nombres latinos válidos actuales (p. ej. `Málaga`, `Santa Cruz de Tenerife`, `Castellón-Castelló`, `Ñ`, `ç`) y siguen pasando los casos existentes de la regla (reservado, propiedad de objeto, longitud, NFC, separadores).
5. El mensaje del `400` no cambia.
6. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan.

### De documentación

1. `docs/06-almacenamiento-s3.md`: la regla de provincia describe «solo letras latinas con diacríticos» y se retira de "Límites conocidos" la frase de que los homoglifos entre alfabetos no se detectan, dejando el límite aceptado (confundibles dentro del latín).
2. `docs/07-estado-y-deuda-tecnica.md`: M23 se marca resuelto con fecha y el límite aceptado; se anota que las carpetas existentes con caracteres no latinos son desconocidas (por confirmar) y que no hay migración; fecha "actualizado".
3. `docs/integracion/para-frontend.md`: nueva fila de contrato (tras F11), compatible sin `/api/v2`, condicionada a las carpetas existentes.
4. `docs/05-modulos.md`: lo que cambie en `functions/validateProvincia.js` y `config/s3Paths.js`.
5. Aviso de PR (`docs/specs/*-aviso-pr.md`): pide listar `data/` en dev y prod antes del despliegue y migrar a mano las carpetas con caracteres no latinos que aparezcan.

## Fuera de alcance

- Normalizar mayúsculas y acentos (`Málaga`/`Malaga`/`málaga` siguen siendo carpetas distintas).
- Código de migración o renombrado de carpetas existentes en S3.
- Explicar al usuario cuál es el carácter confundible (basta el mensaje del `400`).
- Otros orígenes de provincia distintos de los ya existentes.
- `/upload-image` (M5), `GET /get-data/:path(*)` (M2) y el resto de validaciones de clave.
- Corregir el frontend o `sigmetum-infra`; solo se documenta y se avisa.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: compatible, sin `/api/v2`, con aviso en la PR. No cambia el envoltorio, los campos ni el texto del error; solo añade casos de `400` por nombres antes aceptados. Condición: si existe una carpeta con caracteres no latinos, seguirá visible en `GET /list-files` pero no se podrá actualizar ni borrar (`400` `Invalid fileName`), como F8 con NFD; la mitiga la comprobación previa y la migración manual del aviso de PR. Que el frontend muestre bien el `400` está **(por confirmar)** contra su código.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno ni permisos nuevos); la migración manual del bucket la hace quien despliega.

## Preguntas abiertas

Ninguna.
