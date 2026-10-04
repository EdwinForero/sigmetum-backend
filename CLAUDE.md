# sigmetum-backend

API REST de SIGMETUM-A en Node.js + Express; la persistencia es Amazon S3 (no hay base de datos). Documentación técnica en `docs/` (empieza por `docs/README.md`), en español.

## Comandos

- `npm start`: arranca el servidor (puerto `PORT`, 8000 por defecto); `GET /healthcheck` comprueba que responde
- `npm run lint`: ESLint 9 (errores y tope de avisos) · `npm run quality`: seguridad (patrones, rutas sin autenticación, variables sin declarar, secretos, `npm audit`) y lint
- `npm run docs:check`: comprueba que la documentación no se ha quedado atrás
- `npm test` es el placeholder de `npm init` (aún no hay tests; ver M11 en `docs/07-estado-y-deuda-tecnica.md`)

## Antes de empezar: lee la guía que corresponda a la tarea

Las guías están en `docs/guias/`. Léelas **antes** de escribir código, no después:

| Si la tarea toca... | Lee |
|---|---|
| **Cualquier código** | `docs/guias/buenas-practicas-backend.md` |
| Rutas, autenticación y JWT, subida de archivos, claves de S3, CORS, correo, dependencias, secretos o logs | `docs/guias/seguridad.md` |
| **Al terminar** cualquier feature o fix | `docs/guias/mantenimiento.md` |

Si lo que te piden **contradice una guía, avisa y pregunta antes de hacerlo**. Si la guía y el código se contradicen, dilo: no des por buena ninguna de las dos.

Las guías contienen las normas y su motivo; las skills de `.claude/skills/` (`new-endpoint`, `s3-operation-review`, `env-var-change`, `security-pre-merge`) son el procedimiento paso a paso y enlazan a las guías. Se usan juntas.

## Integración con otros repositorios

Este backend forma parte de SIGMETUM-A. Si una tarea **cambia el contrato con el frontend** (rutas, formato de respuestas, estructuras de datos, versión de API, JWT, CORS) o **afecta a la infraestructura** (variables de entorno, permisos IAM, endpoints esperados), consulta:

- **Frontend**: `docs/integracion/para-frontend.md` → qué cambios necesitan nueva versión de API (`/api/v2`), qué cambios son compatibles, el orden de despliegue
- **Infraestructura**: `docs/integracion/para-infra.md` → variables de entorno, permisos de S3, discrepancias conocidas, cómo avisar a `sigmetum-infra`

Cambios **compatibles** no necesitan versión nueva; cambios **incompatibles** se desplegan backend-primero bajo prefijo nuevo, luego el frontend migra. Si no sabes si tu cambio es compatible, es que es incompatible: consulta la guía.

## Lo que nunca se hace (resumen; el detalle y el motivo están en las guías)

- Escribir secretos, tokens o contraseñas en el repositorio, en `.env.example`, en la documentación o en un log.
- Añadir una ruta que modifique estado (`POST`, `PUT`, `PATCH`, `DELETE`) fuera de `protectedRouter`, salvo una excepción registrada y justificada.
- Construir una clave de S3 o de un objeto con texto del cliente o de un Excel sin validarlo antes contra una lista de permitidos.
- Dejar un manejador `async` sin `try/catch` y `next(error)`, o devolver al cliente el `err.message` de un error interno.
- Usar `eval`, `new Function` o `child_process`.
- Poner lógica de negocio en `aws/` o llamar a S3 desde fuera de `aws/`.
- Añadir una dependencia sin justificarla ni pasar `npm audit`; usar `npm audit fix --force`.
- Cambiar rutas, formato de respuestas, columnas del Excel, nombres de versión, JWT o CORS sin revisar el contrato con el frontend.

## Al terminar cualquier feature o fix

1. Actualiza los documentos que indica `docs/guias/mantenimiento.md` (sección 2) **en el mismo commit**.
2. Ejecuta `npm run lint`, `npm run quality` y `npm run docs:check`, y `npm test` cuando haya tests: deben pasar. Si corregiste avisos de ESLint, baja `--max-warnings` al número real. Si `quality` falla por algo que **ya estaba** (por ejemplo, el aviso M16 de dependencias), no lo tapes ni lo aceptes para que pase: dilo en el resumen.
3. Contrasta lo que escribas con el código; lo que no puedas comprobar, márcalo como **(por confirmar)**.
4. Si el cambio toca el contrato con el frontend (rutas, formato de respuestas, columnas del Excel, nombres de versión, JWT, CORS, `/get-data`), revisa la sección 6 de `docs/guias/mantenimiento.md` y dilo en el resumen final.
5. Las cifras (archivos, endpoints, funciones, variables, dependencias, tests, guías) solo viven en la tabla de métricas de `docs/07-estado-y-deuda-tecnica.md`.

## Reglas de trabajo

- Los fallos se corrigen con TDD: primero un test que falle **por el motivo correcto**, después el cambio mínimo (cuando exista la base de tests, M11).
- Cada ruta responde `{ success: true, data }` o `{ success: false, error }`; los fallos se pasan con `next(error)` a `middleware/errorHandler.js`.
- Las rutas protegidas cuelgan del `protectedRouter` con `tokenAuth`.
- Las claves de S3 salen de `config/s3Paths.js`; las variables de entorno, de `config/validateEnv.js` y `.env.example`.
- Este repositorio no corrige nada del frontend ni de `sigmetum-infra`: si un cambio los afecta, se documenta y se avisa en la PR.
- No guardes secretos en `.env.example` ni en la documentación.
- Al crear archivos con barras invertidas (expresiones regulares), usa el editor, no `cat <<EOF` ni `node -e` en el shell.
- No hagas commit ni push sin que te lo pidan.
