# Mantenimiento de la documentación

Este documento dice **qué hay que revisar y actualizar en `docs/` después de cada feature o fix**. Es la regla de trabajo del repositorio: Claude Code la sigue a través de [CLAUDE.md](../../CLAUDE.md), y las personas, con la lista de la PR.

## 1. La regla

1. **La documentación se actualiza en el mismo commit (o la misma PR) que el cambio.** Un cambio no está terminado hasta que pasa la lista de este documento.
2. **Se contrasta con el código, nunca de memoria.** Si no puedes comprobar algo, márcalo como **(por confirmar)**.
3. **Cada dato vive en un solo sitio.** Los demás documentos enlazan, no copian. Las cifras (archivos, endpoints, funciones, variables, dependencias, tests, guías) viven solo en la [tabla de métricas de 07](../07-estado-y-deuda-tecnica.md#métricas).
4. **Antes de dar el trabajo por terminado** deben pasar `npm run lint`, `npm run quality` y `npm run docs:check` y, cuando existan tests (hallazgo M11 de [07](../07-estado-y-deuda-tecnica.md)), `npm test`. Si `quality` falla por algo que **ya estaba** (por ejemplo, las vulnerabilidades de M16), no se oculta ni se acepta para que pase: se dice en la PR.
5. **Las guías mandan.** Las normas de [buenas-practicas-backend.md](buenas-practicas-backend.md) y [seguridad.md](seguridad.md) se leen **antes** de escribir código; este documento se sigue **al terminar**. Si un cambio contradice una guía, se avisa y se pregunta.

## 2. Qué documento tocar según el cambio

| Si cambias... | Actualiza | Comprueba |
|---|---|---|
| Un **endpoint** (nuevo, cambiado o eliminado) en `routes/` o `index.js` | [04](../04-api.md) (tabla resumen **y** sección del endpoint), [05](../05-modulos.md) (sección del router) y las métricas de [07](../07-estado-y-deuda-tecnica.md#métricas) | Método, ruta y si es pública (🔓) o protegida (🔒). Si afecta al frontend, [sección 6](#6-avisar-al-frontend-y-a-la-infraestructura) |
| El **formato de las respuestas** o el manejo de errores (`{ success, data \| error }`, `middleware/errorHandler.js`) | [04](../04-api.md) (errores comunes), [05](../05-modulos.md) (`errorHandler`) | **Contrato con el frontend** (sección 6) |
| Una **variable de entorno** (`config/validateEnv.js`, `.env.example`) | [03](../03-configuracion.md) (tabla), `.env.example`, `config/validateEnv.js` y las métricas de [07](../07-estado-y-deuda-tecnica.md#métricas) | Obligatoriedad (`required` o `requiredLocal`) y que el entorno de Beanstalk de `sigmetum-infra` la recibe. La skill `env-var-change` tiene la lista |
| Las **rutas de S3** o el **modelo de versionado** (`config/s3Paths.js`, `getNextVersion.js`, `formatFileName.js`, `aws/awsS3connect.js`) | [06](../06-almacenamiento-s3.md), [05](../05-modulos.md) (constantes y funciones) | **Contrato con el frontend** si cambia el formato del nombre `AAAA-MM-DD_vN.xlsx`. Permisos IAM del bucket en `sigmetum-infra` si hay un prefijo nuevo. La skill `s3-operation-review` tiene la lista |
| Un **módulo, función o método** (`functions/`, `aws/`, `middleware/`, `config/`) | [05](../05-modulos.md) y las métricas de [07](../07-estado-y-deuda-tecnica.md#métricas) | Parámetros, valor devuelto, si lanza o devuelve `{ success: false }` |
| Las **columnas del Excel** (`fixedColumnOrder` en `convertExcelToJson.js`) | [05](../05-modulos.md) (tabla de columnas), [06](../06-almacenamiento-s3.md) (ejemplo de JSON) | **Contrato con el frontend**: es el cambio que más rompe, porque las columnas se leen por posición |
| La **autenticación o el JWT** (`userAuthentication.js`, `tokenAuthentication.js`, `JWT_EXPIRATION`) | [04](../04-api.md), [05](../05-modulos.md), [03](../03-configuracion.md) | **Contrato con el frontend**: lee el campo `exp` del token en el navegador |
| **CORS** (`ALLOWED_ORIGIN`) | [03](../03-configuracion.md), [01](../01-arquitectura.md) | Que el origen coincide con el dominio del frontend de cada entorno (sección 6) |
| **`GET /get-data/:path`** (restringirlo, cerrarlo o cambiar lo que devuelve) | [04](../04-api.md), [07](../07-estado-y-deuda-tecnica.md) (M2 y D1) | **Contrato con el frontend**: `FileDropdown` lo usa hoy para abrir versiones |
| Una **dependencia** o la versión de Node | [02](../02-tecnologias.md) (la versión es la de `package-lock.json`, no la del rango) y las métricas de [07](../07-estado-y-deuda-tecnica.md#métricas) | Que la versión de Node sigue siendo la de la plataforma de Beanstalk (`sigmetum-infra`) |
| Un **script** de `package.json` | [03](../03-configuracion.md) (tabla de scripts) | |
| Una **norma** de las guías (añadir, cambiar o quitar una regla) o el **estado** de una regla tras corregir un hallazgo | [buenas-practicas-backend.md](buenas-practicas-backend.md) o [seguridad.md](seguridad.md) (la regla y su fila de "Estado") y [07](../07-estado-y-deuda-tecnica.md) | Si se puede automatizar, añadir la comprobación a ESLint o a `quality-check.mjs`. Una guía nueva figura en el índice de [README.md](../README.md) y en [CLAUDE.md](../../CLAUDE.md) |
| La **configuración de ESLint** (`eslint.config.js`) o el tope `--max-warnings` | [buenas-practicas-backend.md](buenas-practicas-backend.md#14-eslint-y-el-tope-de-avisos) y [02](../02-tecnologias.md) | Al **bajar** avisos, baja también el tope (lo exige `npm run quality`). Una regla relajada se justifica en el propio `eslint.config.js` |
| Una excepción de **`ACCEPTED_ADVISORIES`** (vulnerabilidad de una dependencia aceptada) o de **`PUBLIC_MUTATING_ROUTES`** (ruta pública que modifica estado) o de **`OPTIONAL_ENV`** | [seguridad.md](seguridad.md) (tabla de la regla S9 o S3) y [07](../07-estado-y-deuda-tecnica.md) | Motivo escrito. Solo se acepta lo no alcanzable en producción o sin arreglo. `docs:check` exige que cada excepción figure en la guía |
| Algo de **seguridad** (autenticación, autorización, validación, claves de S3, subida de archivos, CORS, correo, secretos, logs) | [seguridad.md](seguridad.md) (regla y tabla de la sección 4) y [07](../07-estado-y-deuda-tecnica.md) | La lista de comprobación de la sección 5 de la guía; la skill `security-pre-merge` |
| Un **test** nuevo | [07](../07-estado-y-deuda-tecnica.md) (métricas y M11) y, cuando exista, la sección de tests de [03](../03-configuracion.md) | Que el test figura como cubierto y sale de M11 si era el hueco |
| Un **fallo corregido** | [07](../07-estado-y-deuda-tecnica.md): pasa el hallazgo a "Resueltos" con su commit | Reescribe en presente lo que otros documentos decían del fallo. Si era una discrepancia (D), quítala también de la lista del frontend |
| Una **deuda o discrepancia nueva** | [07](../07-estado-y-deuda-tecnica.md) y, si afecta al frontend o a la infraestructura, su documento de `integracion/` | Id, prioridad, archivo y qué hay que hacer |
| Límites de tamaño o tipo en `/upload`, `/upload-image` o el limitador de login | [04](../04-api.md) (códigos de respuesta) | **Contrato con el frontend**: mensajes de error y `accept` de sus formularios |
| Algo que **cambia lo que necesita la infraestructura** (variables, permisos, runtime, health check) | [01](../01-arquitectura.md) (despliegue) y [03](../03-configuracion.md) | Avisar a infra (sección 6) |
| Las **skills o plugins de Claude** (`.claude/`) | `.claude/` y la estructura de [README.md](../README.md) | Que las listas de las skills siguen siendo coherentes con este documento |
| **Documentos** nuevos, renombrados o movidos | Índice de [README.md](../README.md) y README de la raíz | `npm run docs:check` valida los enlaces y el índice |

## 3. Listas de comprobación por tipo de cambio

### Endpoint nuevo

- [ ] Pasa `npm run docs:check` (y `npm test`, si hay tests).
- [ ] Está en la tabla resumen y tiene sección en [04](../04-api.md), con 🔒 si es protegido.
- [ ] Si toca S3, funciones nuevas en [05](../05-modulos.md) y rutas nuevas en [06](../06-almacenamiento-s3.md).
- [ ] Si necesita una variable, está en `config/validateEnv.js`, `.env.example` y [03](../03-configuracion.md).
- [ ] Las métricas de [07](../07-estado-y-deuda-tecnica.md#métricas) están al día.
- [ ] Si el frontend lo va a usar, o cambia lo que ya usa: secciones 2 y 7 de su `para-backend.md`, y constancia en la PR.
- [ ] Si es público, se ha decidido a propósito (límite de peticiones, validación de entrada).

### Corrección de un fallo

- [ ] Hay un test que **fallaba antes** del arreglo y pasa después (cuando exista la base de tests, M11). Mientras no exista, se describe cómo se comprobó.
- [ ] El hallazgo pasa a "Resueltos" en [07](../07-estado-y-deuda-tecnica.md) con el hash del commit y una línea sobre la causa.
- [ ] Si otro documento describía el comportamiento erróneo, se reescribe en presente.
- [ ] Si el fallo era una discrepancia (D), se quita de la lista del frontend y se verifica contra su código.

### Variable de entorno nueva, renombrada o eliminada

- [ ] `config/validateEnv.js`, `.env.example` y la tabla de [03](../03-configuracion.md) coinciden (el script lo comprueba).
- [ ] Si se renombra o elimina, no quedan `process.env.NOMBRE_ANTIGUO` en el código.
- [ ] Se avisa a infra: el entorno de Beanstalk tiene que recibirla.
- [ ] Nunca se escribe el valor, solo el nombre.

### Dependencia, herramienta o versión de Node

- [ ] Tabla de [02](../02-tecnologias.md) con la versión **instalada** (la de `package-lock.json`).
- [ ] Si cambia Node, se comprueba contra la plataforma de Beanstalk de `sigmetum-infra`.
- [ ] Si la dependencia cambia el comportamiento (por ejemplo, `express-rate-limit`), se revisan las secciones de [04](../04-api.md) y [05](../05-modulos.md) que lo describen.
- [ ] `npm audit` sin hallazgos nuevos graves (skill `security-pre-merge`).

### Cambio que afecta al contrato con el frontend

- [ ] Se revisa la [sección 6](#6-avisar-al-frontend-y-a-la-infraestructura) y se actualiza el documento de [04](../04-api.md), [05](../05-modulos.md) o [06](../06-almacenamiento-s3.md) que corresponda.
- [ ] La PR dice qué debe cambiar el frontend y qué fichero suyo lo lee.
- [ ] Si introduce un cambio incompatible, se considera un prefijo nuevo (`/api/v2`) en lugar de cambiar `/api/v1` en caliente.

### Refactor sin cambio de comportamiento

- [ ] Se actualizan los nombres y las rutas de archivo que cambien en [05](../05-modulos.md) y [README.md](../README.md).
- [ ] No se toca el contrato con el frontend; si hay que tocarlo, deja de ser un refactor.

### Antes de fusionar la rama

- [ ] `npm run lint`, `npm run quality` y `npm run docs:check` en verde (y `npm test`, si hay tests). El `npm audit` de `quality` se ha ejecutado **con red**.
- [ ] Si se corrigieron avisos de ESLint, el tope `--max-warnings` baja al número real.
- [ ] `npm run docs:check -- --metrics` y la tabla de [07](../07-estado-y-deuda-tecnica.md#métricas) coinciden.
- [ ] La fecha y el commit del encabezado de [07](../07-estado-y-deuda-tecnica.md) son los de la fusión.
- [ ] Se ha vuelto a mirar el aviso del cruce con el frontend (sección 4) y las discrepancias D siguen vigentes o se han resuelto.
- [ ] Tras un renombrado, se busca el nombre antiguo en `docs/`: solo puede aparecer en notas históricas.

## 4. Validación

### Lo que comprueban `npm run lint` y `npm run quality`

| Comando | Falla si... |
|---|---|
| `npm run lint` | ESLint 9 encuentra **errores**, o los **avisos superan el tope** de `--max-warnings` en `package.json` |
| `npm run quality` | Hay un patrón prohibido en el código (`eval`, `new Function`, `child_process`, datos sensibles en un log, CORS abierto, TLS desactivado); una ruta que modifica estado no cuelga de `protectedRouter` y no es una excepción registrada; el código usa una variable de entorno que no está en `validateEnv.js`; hay secretos literales o un `.env` versionado; `npm audit --omit=dev` da una vulnerabilidad alta o crítica no aceptada por escrito; o ESLint falla o el tope de avisos es mayor que los avisos reales |

Las reglas y su motivo están en [buenas-practicas-backend.md](buenas-practicas-backend.md) y [seguridad.md](seguridad.md). Sin conexión, `npm audit` se omite con un aviso: se ejecuta con red antes de fusionar. Las excepciones (`ACCEPTED_ADVISORIES`, `PUBLIC_MUTATING_ROUTES`, `OPTIONAL_ENV`) viven al principio de `scripts/quality-check.mjs`, cada una con su motivo.

### Lo que comprueba `npm run docs:check`

El script ([scripts/docs-check.mjs](../../scripts/docs-check.mjs), sin dependencias) compara el código con la documentación y **falla con código de salida 1** si algo no coincide:

| Comprobación | Código | Documento |
|---|---|---|
| Enlaces y anclas internos | Todos los `.md` | Los propios `.md` |
| Índice y estructura | Archivos de `docs/` y del código | [README.md](../README.md) |
| Rutas: método, ruta, pública o protegida y fichero | `routes/*.js` e `index.js` | [04](../04-api.md) (tabla resumen y una sección por endpoint) |
| Variables de entorno y su obligatoriedad | `config/validateEnv.js`, `.env.example` y `process.env.*` del código | [03](../03-configuracion.md) |
| Rutas de S3 y segmentos reservados | `config/s3Paths.js` | [05](../05-modulos.md) y [06](../06-almacenamiento-s3.md) |
| Columnas del Excel y su orden | `fixedColumnOrder` | [05](../05-modulos.md) |
| Módulos y funciones exportadas | Todos los `.js` de código | [05](../05-modulos.md) |
| Dependencias y versiones instaladas | `package.json` y `package-lock.json` | [02](../02-tecnologias.md) |
| Scripts | `package.json` | [03](../03-configuracion.md) |
| Métricas | Recuento real de archivos, endpoints, funciones, variables, dependencias, tests y guías | Tabla de [07](../07-estado-y-deuda-tecnica.md#métricas), que debe ser la **única** con cifras |
| Guías | Archivos de `docs/guias/` | Cada una figura en [README.md](../README.md) y en [CLAUDE.md](../../CLAUDE.md) |
| Excepciones de la puerta de calidad | `ACCEPTED_ADVISORIES` y `PUBLIC_MUTATING_ROUTES` de `scripts/quality-check.mjs` | [seguridad.md](seguridad.md) |

`npm run docs:check -- --metrics` imprime los valores reales para actualizar la tabla de 07.

### Cruce con el frontend (solo avisa)

Si existe `../sigmetum-frontend`, el script compara los endpoints del backend con la tabla de la sección 2 de su `docs/integracion/para-backend.md`, las columnas del Excel con su sección 3 y los ids de discrepancia D de su sección 6 con [07](../07-estado-y-deuda-tecnica.md#discrepancias-con-el-frontend). Avisa de:

- endpoints que el frontend no conoce,
- endpoints que el frontend usa y el backend ya no tiene,
- columnas que el frontend no lista,
- discrepancias que el frontend lista y 07 no menciona.

Son **avisos y no cambian el código de salida**: el repositorio hermano puede no estar (por ejemplo, en CI) o estar en otra rama. Si no existe, el script lo dice y sigue. Un aviso hay que leerlo: o el frontend está desactualizado, o el cambio del backend rompe el contrato.

### Lo que el script **no** puede comprobar

Esto es revisión manual, y por eso está en las listas de la sección 3:

| Qué | Cómo |
|---|---|
| Que lo descrito **es cierto** (flujos, comportamientos, códigos de respuesta, valores devueltos) | Leer el código que cambió y el párrafo que lo describe |
| Que las **discrepancias** D con el frontend y las I con la infraestructura siguen vigentes | Revisar el código del otro repositorio antes de afirmarlo |
| Que los diagramas y el árbol del bucket siguen siendo correctos | Releerlos tras un cambio de flujo |
| El **cuerpo de las secciones** de [04](../04-api.md) (campos del body, ejemplos de respuesta) | El script solo comprueba que el endpoint existe y su acceso |
| **Nombres antiguos** tras un renombrado | Buscarlos en `docs/` |
| Que una **variable** la recibe el entorno desplegado | Revisar `sigmetum-infra` |

## 5. Hallazgos y deuda técnica

Se registran en [07](../07-estado-y-deuda-tecnica.md). La convención (prefijos **A**, **M**, **B**, **D** e **I**, y el ciclo de vida de un hallazgo) está definida allí, en [Convención de hallazgos](../07-estado-y-deuda-tecnica.md#convención-de-hallazgos), y no se repite aquí.

## 6. Avisar al frontend y a la infraestructura

El documento `sigmetum-frontend/docs/integracion/para-backend.md` es la fuente de verdad de **lo que espera el frontend** de esta API. Desde la carpeta de este repositorio, el documento está en `../sigmetum-frontend/docs/integracion/para-backend.md` (ver también [README.md](../README.md#integración-con-los-otros-repositorios)).

### Contrato con el frontend: qué revisar en su sección 7

Si cambias algo de la columna izquierda, revisa la sección 7 ("Si cambias algo en el backend") de ese documento, actualiza lo que toque y **deja indicado en la PR qué debe hacer el frontend**:

| Si cambias... | Lo lee el frontend en... |
|---|---|
| El prefijo de la API (`API_PREFIX`) | `VITE_API_PREFIX` |
| Una **ruta**, un método o si es pública o protegida | `services/api.js` y el componente que la llama |
| El **envoltorio** `{ success, data \| error }` | `services/api.js` (un único sitio) |
| Las columnas del Excel (`fixedColumnOrder`) | Traducciones (`attributes`), `DialogSpecies.js`, `Filter` y `Explore` |
| El **formato de nombres de versión** (`AAAA-MM-DD_vN.xlsx`) | `utilities/FormatFileName.js` y `FileDropdown` |
| La forma de `emptyFields` o `draftKey` en el 400 de `/upload` | `components/FileUpload.js` |
| Los campos de `/list-files` (`key`, `name`) | `components/FileDropdown.js` |
| El **JWT**: sus claves o cómo caduca (`exp`) | `components/ProtectedRoute.js` |
| **CORS** (`ALLOWED_ORIGIN`) | Nada en el código, pero el origen tiene que coincidir con el dominio del frontend de cada entorno |
| **`GET /get-data`** | `FileDropdown` (discrepancia D1) |
| Límites o validaciones de `/upload` y `/upload-image` | `accept` y mensajes de error de los formularios |

### Reglas

- **Cambias algo que afecta al frontend:** actualiza la documentación de este repositorio **y** deja constancia en la PR (qué cambia y qué debe hacer el frontend).
- **El frontend cambia algo:** revisa la sección "Si cambias algo" y el resultado del cruce de `npm run docs:check`; actualiza [04](../04-api.md) y [07](../07-estado-y-deuda-tecnica.md).
- **Discrepancia resuelta en el otro repositorio:** pásala a "Resueltos" en [07](../07-estado-y-deuda-tecnica.md) y verifícalo contra su código.
- **Cambias algo que necesita la infraestructura** (variable nueva, permiso de S3, versión de Node, health check): actualiza [01](../01-arquitectura.md) o [03](../03-configuracion.md) y avisa a infra en la PR.

## 7. Estilo

- **Idioma:** español. El código y los mensajes de commit, en inglés.
- **Formato:** tablas para datos comparables, listas para pasos, diagramas de texto o `mermaid` para flujos.
- **Certeza:** marca **(verificado)** lo comprobado contra el código y **(por confirmar)** lo deducido.
- **Enlaces:** a archivos con ruta relativa (por ejemplo, `[05](../05-modulos.md)` seguido de un apartado con `#ancla`). No copies contenido que ya existe en otro documento.
- **Código:** cita `archivo:línea` solo cuando ayuda a localizar un fallo; los números de línea envejecen.
- **Sin secretos:** nunca valores de `.env`, tokens ni contraseñas. Solo nombres de variables.
- **Fechas:** absolutas (`30/09/2026`), no relativas.

## 8. Plantilla para la PR

```markdown
## Calidad, seguridad y documentación
- [ ] `npm run lint`, `npm run quality` y `npm run docs:check` en verde (y `npm test`, si hay tests)
- [ ] Guías leídas: buenas-practicas-backend.md (siempre) y seguridad.md (si toca autenticación, rutas, S3, archivos, CORS, correo, dependencias, secretos o logs)
- [ ] Nueva excepción en `ACCEPTED_ADVISORIES`, `PUBLIC_MUTATING_ROUTES` u `OPTIONAL_ENV`: sí / no. Si sí, el motivo
- [ ] Documentos actualizados: (lista)
- [ ] Afecta al frontend: sí / no. Si sí, qué debe cambiar y dónde (sección 7 de su para-backend.md)
- [ ] Afecta a la infraestructura: sí / no. Si sí, qué necesita
- [ ] Hallazgos resueltos o nuevos en docs/07: (ids)
```

## 9. Mantener este documento

- Se actualiza cuando aparece un tipo de cambio que no está en la tabla de la sección 2.
- Si una comprobación manual de la sección 4 se puede automatizar, se añade a `scripts/docs-check.mjs` y se mueve a la primera tabla.
- El script y este documento se revisan juntos: que un documento figure en la tabla 2 y no tenga comprobación automática es aceptable, pero debe ser una decisión consciente.
- Las skills de `.claude/skills/` remiten a este documento; si se cambia una lista aquí, revisa que la skill no se contradiga.
