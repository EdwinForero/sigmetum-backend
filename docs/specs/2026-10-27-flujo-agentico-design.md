# Flujo agéntico de desarrollo: diseño

Fecha: 2026-10-27 · Estado: cerrado (implementado el 28/10/2026; falta la verificación en vivo de la Tarea 10, registrada en M18 de `docs/07`)

## Enmiendas posteriores a la aprobación

El cuerpo de este documento es la spec aprobada. La implementación y sus revisiones cambiaron lo siguiente; **donde haya diferencia, mandan las enmiendas**:

1. **Un solo marketplace local en `plugins/`** (nombre `locales`, `plugins/.claude-plugin/marketplace.json`) con plugins hermanos: el núcleo `ciclo-agentico` y las skills del proyecto por categoría (`backend-general`, `dominio-api-express`, `dominio-aws-s3`). El núcleo ya no tiene marketplace propio. Id de instalación: `ciclo-agentico@locales`; registro: `claude plugin marketplace add ./plugins`. Las skills ya no viven en `.claude/skills/` (borrado); `skillsProyecto` apunta a `plugins/<plugin>/skills`. El único documento que nombra los plugins y sus skills es `plugins/README.md`.
2. **`flujo.json`**: campos nuevos `marketplaceLocal` (opcional), `perfiles` ampliado (`api-express`, `aws-s3`), `areasContrato` incluye `index.js`, `docsPorArea` sin documentos de `integracion/` (diluían el control). `bootstrap-agentes` instala por perfil los plugins locales cuyo tag es `perfil:<x>` (fase `[local]`, nunca cambia el código de salida) y lee `claude plugin list --json`.
3. **`docs-gate`** exige, si se toca una `areasContrato`, el aviso para PR y además que cambie un documento de `integracion` o que el aviso lleve la línea `Integración: sin impacto — <motivo>`.
4. **Árbol limpio al empezar**: `/ciclo` se detiene con cambios sin commit (commit, abandonar o continuación declarada), porque `docs-gate` compara con HEAD. Por eso el commit entre iteraciones lo hace siempre el usuario.
5. **Foto de código del tester**: vigila todo archivo cambiado que no sea documento, no solo las claves de `docsPorArea`.
6. **Permisos `ask`**: `git commit`, `push`, `add` y `stash` para Bash y PowerShell (la spec decía solo `commit`, `push` y `add -A`).
7. **Contrato de salida común** en la skill `principios`; las prohibiciones de git se repiten en cada agente a propósito (seguridad).
8. **Octopus** no funciona en Windows nativo (consultor `ninguno`); el adaptador no se reescribe en `flujo.json`: la alternativa interna se aplica en tiempo de ejecución.
9. **Memoria automática**: configurada con `autoMemoryEnabled: false`; que deje de cargarse está por confirmar.

## Objetivo

Que toda feature o fix siga siempre el mismo ciclo con cuatro roles de límites claros, con aprobación humana entre fases, sin commits automáticos y sin memoria persistente. Además, que el conjunto sea **fácil de replicar en otros proyectos**.

## Decisiones ya tomadas

- Puerta de aprobación humana en cada fase.
- Memoria automática desactivada en los proyectos que usen el flujo. El estado vive en `docs/` y en git.
- Superpowers es la base de proceso. Los principios de Karpathy viven en una **skill propia del plugin** (`skills/principios/`), que los cuatro agentes precargan. Así se migran con el plugin y no hay que copiarlos a mano en cada `CLAUDE.md`.
- Octopus (consultor) e `i-have-adhd` (estilo de salida) son adaptadores del flujo. Si faltan, el flujo **los instala con confirmación del usuario** (ver "Instalación de dependencias"). Si el usuario rechaza la instalación, el flujo sigue con sus alternativas internas.
- El plugin vive **dentro de este repo**, pero autocontenido y sin nada de Sigmetum, para poder moverlo a otro repo cuando haga falta.
- Fuera de alcance: ralph-loop.

## Estructura: separar lo reutilizable de lo propio del proyecto

Lo reutilizable vive en `plugins/ciclo-agentico/` dentro de este repo, empaquetado como plugin de Claude Code (nombre por confirmar). Cada proyecto solo guarda una configuración pequeña.

### Regla de portabilidad

La carpeta `plugins/ciclo-agentico/` es autocontenida: no importa nada del resto del repo y **no contiene ninguna referencia a Sigmetum, S3 ni Express**. Todo lo específico va en `.claude/flujo.json`. Un chequeo (`grep` de esos términos sobre la carpeta, añadido a `docs:check` o a un script propio, por confirmar) lo verifica. Mientras se cumpla, mudarla a otro repo es copiar la carpeta.

### Mejora y mudanza

- Se versiona con `version` en `plugin.json` y un `CHANGELOG.md` propio dentro de la carpeta.
- Los cambios al plugin se hacen con el propio ciclo, en commits que solo tocan esa carpeta (así el historial se puede separar).
- Para sacarlo a un repo aparte conservando historia: `git subtree split --prefix=plugins/ciclo-agentico -b ciclo-agentico`. Después, los proyectos lo instalan con `claude plugin marketplace add <repo>` y el repo actual solo conserva `flujo.json`.
- Mientras viva aquí se instala con la ruta local: `claude plugin marketplace add ./plugins/ciclo-agentico` (la documentación indica que acepta rutas relativas). Requiere `marketplace.json` con `name`, `owner` y `plugins` (cada uno con `name` y `source` relativo); `plugin.json` solo exige `name`.
- Claude Code permite declarar `dependencies` en `plugin.json`, con versiones semver y una lista de permitidos para dependencias de otros marketplaces. Se evalúa usarlo para Superpowers; `dependencias.json` se mantiene para la instalación guiada con confirmación y para los adaptadores opcionales.

```
plugins/ciclo-agentico/          (autocontenido, versionado, se instala como plugin)
├─ .claude-plugin/
│  ├─ plugin.json                nombre, versión, descripción
│  ├─ dependencias.json          plugins externos que el flujo necesita (ver abajo)
│  └─ marketplace.json           permite `claude plugin marketplace add`
├─ agents/
│  ├─ requirements.md
│  ├─ architect.md
│  ├─ developer.md
│  └─ tester-documentador.md
├─ commands/
│  ├─ ciclo.md                   orquestador: /ciclo <tarea>
│  └─ ciclo-init.md              prepara un proyecto nuevo: /ciclo-init
├─ skills/
│  ├─ refresh-estado/SKILL.md    paso 0: lee git + docs + specs abiertas
│  └─ principios/SKILL.md        principios tipo Karpathy, genéricos, sin nada del proyecto
├─ scripts/                      genéricos: leen `.claude/flujo.json`, no llevan nada del proyecto
│  ├─ docs-gate.mjs              control del cierre documental (ver abajo)
│  └─ bootstrap-agentes.mjs      instala dependencias en un equipo nuevo (ver abajo)
├─ templates/
│  ├─ flujo.json                 adaptador de ejemplo
│  ├─ CLAUDE-seccion.md          sección para pegar en el CLAUDE.md del proyecto
│  ├─ settings-snippet.json      permisos `ask` y memoria desactivada
│  ├─ spec.md                    plantilla de spec
│  └─ plan.md                    plantilla de plan
├─ CHANGELOG.md
└─ README.md                     instalación en 3 pasos
```

### Catálogo de plugins y cómo se complementan

`dependencias.json` es el catálogo completo; `flujo.json` elige qué **perfiles** se activan (`perfiles: ["base", "backend"]` en Sigmetum). El instalador solo ofrece lo de los perfiles activos, pero el catálogo viaja con el plugin a cualquier repo.

| Plugin | Perfil | Instalación | Dónde encaja en el ciclo |
|---|---|---|---|
| Superpowers | `base` (obligatorio) | `claude plugin marketplace add obra/superpowers-marketplace` y `claude plugin install superpowers@superpowers-marketplace` | Proceso: brainstorming en requisitos, writing-plans en arquitectura, TDD y verification-before-completion en developer y tester |
| Understand-Anything | `base` | `/plugin marketplace add Egonex-AI/Understand-Anything` y `/plugin install understand-anything` | Paso 0 (grafo del código para el refresh), architect (`understand-explain` del módulo afectado), tester (`understand-diff`: qué componentes toca el cambio) y onboarding de un repo nuevo |
| diagram-design | `base` | `/plugin marketplace add cathrynlavery/diagram-design` y `/plugin install diagram-design@diagram-design` | tester-documentador: regenera los diagramas de `docs/01` y `docs/06` cuando cambia un flujo (lo exige `mantenimiento.md` sección 4) |
| i-have-adhd | `base` (adaptador `estilo`) | Original: `claude plugin marketplace add ayghri/i-have-adhd` y `claude plugin install i-have-adhd@i-have-adhd`. **Instalado el 27/10/2026** (v0.4.1, commit `1ecea19`, hooks revisados: solo lee `~/.claude/.i-have-adhd-always`, sin red ni escrituras). Un fork propio es opcional, solo para personalizarlo; si se usa, los comandos cambian el origen (`desinstalar`, `marketplace remove`, `marketplace add <usuario>/i-have-adhd`) | Contrato de salida de cada rol |
| Octopus | `base` (adaptador `consultor`) | Ver sección Octopus | Segunda opinión en plan y diff críticos |
| Impeccable | `frontend` | `/plugin marketplace add pbakaus/impeccable` y elegirlo en `/plugin` | Solo repos con interfaz: developer y tester en cambios de UI (`critique`, `audit`, `polish`). Instala un hook que corre en cada edición de archivos de UI y descarga un binario a `~/.impeccable/bin/` |
| awesome-design-md | `frontend` | No es plugin ni skill: es un repositorio de `DESIGN.md`. Se copia el `DESIGN.md` elegido a la raíz del repo con UI | requirements y developer lo leen como referencia visual |

**Por qué `backend` no incluye Impeccable ni awesome-design-md:** este repo es una API sin interfaz. Impeccable instala un hook con binario descargado y awesome-design-md solo sirve para generar UI. En Sigmetum se aplican en `sigmetum-frontend`, donde el mismo plugin se instala con el perfil `frontend`. Si aun así quieres tenerlos activos aquí, es cambiar `perfiles` en `flujo.json`.

**Pendiente de este catálogo:**
- Alinear `.claude/settings.json`: hoy habilita `superpowers@claude-plugins-official`, pero lo instalado en la máquina es `superpowers@superpowers-marketplace`. Dos orígenes con el mismo nombre pueden duplicar skills. Se deja solo `superpowers-marketplace`.
- **Understand-Anything (verificado leyendo el código del plugin instalado, v. en `~/.claude/plugins/cache/understand-anything`):**
  - Escribe dentro del repo, en `.understand-anything/` (si no existe, usa `.ua/`): `knowledge-graph.json`, `meta.json` (guarda el hash del commit analizado), `fingerprints.json`, `config.json`, `.understandignore` y una carpeta `intermediate/` con archivos temporales.
  - El plugin no da ninguna indicación de versionar el grafo. Es un artefacto derivado, ligado a un commit y regenerable. Decisión: `.understand-anything/` y `.ua/` van **enteros a `.gitignore`** (se añade en el plan), lo que además encaja con "sin memoria persistente": cada ciclo regenera o actualiza el grafo en el paso 0.
  - **No se activa `--auto-update`.** Con esa opción el plugin instala hooks (`PostToolUse` sobre Bash y `SessionStart`) que actualizan el grafo "sin pedir confirmación", gastando tokens fuera de las puertas del ciclo. El refresh se hace de forma explícita en el paso 0, y solo si el grafo está desactualizado respecto a `HEAD`.
  - **Secretos:** el análisis envía contenido de archivos a subagentes. El `.understandignore` inicial se genera a partir de `.gitignore` (que ya excluye `.env*`, `uploads/` y credenciales), pero se **revisa antes del primer análisis** para confirmar que `.env`, `uploads/` y `node_modules/` quedan fuera.
  - Efecto en los controles del repo: `.understand-anything/` debe quedar fuera de `docs-gate` y de `quality`; se comprueba en el plan que ninguno recorre esa carpeta.
- Understand-Anything y diagram-design ya están instalados en la máquina (caché del usuario); el instalador los detectaría como presentes.

### Instalación de dependencias

`dependencias.json` declara cada plugin externo con su comando de instalación y su rol: `base` (Superpowers, **obligatorio**: el flujo no funciona sin él), `consultor` (Octopus) y `estilo` (`i-have-adhd`). El instalador comprueba Superpowers como cualquier otro y lo instala si falta. `/ciclo-init` y el paso 0 de `/ciclo` hacen esto:

1. Ejecutan `claude plugin list` y comparan con `dependencias.json`.
2. Para cada faltante, muestran qué es, de dónde viene y el comando exacto, y **piden confirmación** antes de ejecutarlo. Es un cambio global del usuario, así que no se instala en silencio.
3. Tras instalar, verifican con `claude plugin list` y lo informan. Si falla o el usuario rechaza, el adaptador queda en `ninguno` en `flujo.json` y el flujo sigue con la alternativa interna.

Cautelas, porque son repos de terceros que ejecutan código en la máquina:
- Antes de la primera instalación se lee el código de scripts y hooks, y se registra en `dependencias.json` la versión o commit revisado. Se instala esa versión fijada, no la rama principal.
- Nunca se activa el modo siempre activo de `i-have-adhd` desde el instalador.
- Sin proveedores externos de Octopus por defecto.

```
<proyecto>/                      (lo único que cambia de un proyecto a otro)
├─ .claude/
│  ├─ flujo.json                 adaptador del proyecto (ver abajo)
│  ├─ settings.json              permisos y plugins habilitados
│  └─ skills/                    skills propias del proyecto (en Sigmetum: new-endpoint, etc.)
├─ CLAUDE.md                     incluye la sección del ciclo
└─ docs/specs/                   specs y planes del ciclo
```

### Adaptador `.claude/flujo.json`

Los agentes no llevan rutas ni comandos de Sigmetum escritos dentro. Los leen de aquí:

| Campo | Para qué | Valor en Sigmetum |
|---|---|---|
| `guias` | Normas que architect y developer deben leer antes | `docs/guias/*.md` |
| `integracion` | Documentos de contrato con otros repos | `docs/integracion/*.md` |
| `skillsProyecto` | Skills propias que el rol debe consultar | `.claude/skills/*` |
| `estado` | Documento de estado y deuda para el refresh | `docs/07-estado-y-deuda-tecnica.md` |
| `verificacion` | Comandos del tester | `lint`, `quality`, `docs:check`, `test` |
| `docsRegla` | Qué documentos actualizar al terminar | `docs/guias/mantenimiento.md` sección 2 |
| `specsDir` | Dónde se guardan specs y planes | `docs/specs/` |
| `maxVueltas` | Tope developer ↔ tester | `3` |
| `consultor` | `octopus` o `ninguno` | `octopus` |
| `estilo` | `i-have-adhd` o `ninguno` | `i-have-adhd` |
| `criticidad` | Qué cambios escalan a la revisión de Octopus | auth/JWT, claves de S3, dependencias, contrato con el frontend, CI |
| `docsObligatorios` | Documentos que cambian en toda iteración | `docs/07-estado-y-deuda-tecnica.md` |
| `docsPorArea` | Ruta de código → documentos que deben cambiar con ella | derivado de la sección 2 de `mantenimiento.md` |

`/ciclo-init` crea estos archivos desde `templates/`, pregunta los valores y **no hace commit**. Replicar en otro proyecto: instalar el plugin, ejecutar `/ciclo-init`, revisar `flujo.json`.

## Roles (`agents/`)

Los límites se imponen con `tools` en el frontmatter de cada agente.

| Rol | Puede | No puede | Entrega |
|---|---|---|---|
| `requirements` | Leer; escribir solo en `specsDir` | Editar código; proponer solución técnica | Spec con criterios de aceptación e impacto en contratos externos |
| `architect` | Leer | Editar nada | Plan por pasos contrastado con `guias` e `integracion`; puede vetar |
| `developer` | Leer, editar código y tests, ejecutar tests | Commit, push, editar `guias` | Cambio mínimo con TDD |
| `tester-documentador` | Leer, ejecutar `verificacion`, editar docs | Editar código de producción | Informe de verificación, docs al día según `docsRegla`, mensaje de commit propuesto |

## Orquestación: `/ciclo <tarea>`

0. **Refresh de estado** (skill `refresh-estado`): `git status`, `git log -10`, el documento `estado` y las specs abiertas. No se usa memoria.
1. requirements → **puerta humana**
2. architect → consulta Octopus sobre el plan → **puerta humana**
3. developer
4. tester-documentador → consulta Octopus sobre el diff → si falla, vuelve a 3. Máximo `maxVueltas`; luego escala al usuario.
5. **Puerta humana** con el resumen final. El commit lo hace el usuario.

Los traspasos entre roles son archivos en `specsDir`, no contexto de conversación.

## Adaptador Octopus (`consultor: octopus`)

- Instalación (acción global del usuario): `claude plugin marketplace add https://github.com/nyldn/claude-octopus.git` y `claude plugin install octo@nyldn-plugins`.
- Se invoca en dos puntos: plan del architect y diff del tester. Es **solo consulta**: no edita, no decide y no salta puertas. Su resultado se muestra en la puerta humana como "segunda opinión", con los desacuerdos señalados.
- Si falta Octopus se ofrece instalarlo (ver "Instalación de dependencias"). Si el usuario lo rechaza (`consultor: ninguno`), esos dos puntos usan `superpowers:requesting-code-review`.
- Arranca solo con Claude. Activar Codex, Gemini u otros proveedores envía código fuera de la máquina: es decisión explícita del usuario, nunca con secretos, `.env`, datos de S3 ni tokens (`docs/guias/seguridad.md`).
- `/ciclo` es el único punto de entrada. No se usan los workflows ni las personas propias de Octopus, para no tener dos orquestadores.
- **Escalada por criticidad.** Octopus se invoca con `/octo:review` sobre un diff (confirmado abajo); según su descripción, lo ejecuta una revisión adversarial en paralelo con otros modelos y exige un consenso del 75% (esto último no verificado). La ruta normal sigue siendo `/review` nativo. Por tanto: la revisión con Octopus solo se pide si el cambio es crítico, definido en `flujo.json` (campo `criticidad`: autenticación, claves de S3, dependencias, contrato con el frontend, CI). El resto usa la revisión normal.
- **Conflicto a resolver.** Esa descripción dice que Octopus puede bloquear la aplicación del cambio si no hay consenso. Aquí Octopus es consultor y quien decide es el usuario en la puerta humana. Regla: un consenso bajo se muestra como riesgo en la puerta; no bloquea por sí solo ni desbloquea nada.
- Con solo Claude configurado la revisión "adversarial" no tiene modelos distintos que la contrasten: el valor de la escalada depende de activar otros proveedores, que es decisión explícita del usuario (ver arriba).
- **Verificado el 27/10/2026 leyendo el repo clonado (v11.15.1, commit `ee7bcb4`):** `/octo:review` existe y se define como "ruta de escalada más allá del `/review` nativo de Claude".
- **Bloqueante en esta máquina:** el README dice que Octopus corre nativo solo en Linux y macOS; en Windows hay que usar Claude Code **dentro de WSL**, con sus propios plugins y ajustes. Sus hooks salen sin hacer nada en Git Bash/MSYS ("Native Windows has no supported Octopus runtime"). WSL no está instalado en esta máquina. Hasta resolverlo, `consultor: octopus` no funciona aquí y se usa `superpowers:requesting-code-review`.
- **Huella de sus hooks (revisados):** declara unos 40 hooks en casi todos los eventos (inicio de sesión, cada prompt, cada herramienta, entrada a plan mode, fin de sesión). Incluye inyección de contexto de enrutamiento, carga de preferencias desde la memoria automática y un webhook de telemetría que solo actúa si se define `OCTOPUS_WEBHOOK_URL`. Choca con dos decisiones de este diseño: memoria desactivada y `/ciclo` como único orquestador. Por eso, si se instala en WSL, se hace en un perfil aparte, sin su enrutamiento automático, y se confirma que no inyecta contexto en las sesiones de este repo.

## Adaptador `i-have-adhd` (`estilo: i-have-adhd`)

- Instalación: `claude plugin marketplace add ayghri/i-have-adhd` y `claude plugin install i-have-adhd@i-have-adhd`. **Sin** crear `~/.claude/.i-have-adhd-always` (activaría un hook en cada sesión).
- El orquestador pasa a cada rol un **contrato de salida** basado en sus reglas: acción primero, pasos numerados, estado actual en una línea, máximo 5 elementos por lista, un único siguiente paso, sin preámbulo ni recap.
- Excepción: la **puerta humana** siempre muestra un bloque fijo: fase, resultado, decisión pendiente, riesgos y segunda opinión si la hay. Eso cuenta como estructura y no como preámbulo.
- Si falta la skill se ofrece instalarla. Si el usuario lo rechaza (`estilo: ninguno`), el contrato de salida se aplica igual desde el texto del propio agente.
- Los agentes admiten `skills:` en el frontmatter, que inyecta la skill completa al arrancar (según la documentación). Cuando `estilo: i-have-adhd` esté activo, cada agente la precarga; con `estilo: ninguno` se usa el contrato copiado en su texto. Como `skills:` es fijo por agente y `estilo` es configurable, el contrato de texto queda siempre como base y la skill como refuerzo.
- Hooks y scripts revisados leyendo el código el 27/10/2026 antes de instalar (ver catálogo).

## Cierre documental obligatorio

Regla: **ninguna iteración termina sin pasar el cierre documental.** Es lo que el usuario más pide, así que se aplica con un control mecánico y con una revisión, y no solo con una instrucción al agente.

**Qué cuenta como iteración:** cada ejecución de `/ciclo` que llega a la puerta final, incluidas las que no cambian código (por ejemplo, solo una spec o un cambio del propio flujo).

**1. Documento de estado, siempre.** `docs/07-estado-y-deuda-tecnica.md` se modifica en **toda** iteración. Como mínimo cambia la fecha de la línea 3 ("actualizado DD/MM/AAAA") y refleja lo ocurrido: hallazgo nuevo, hallazgo pasado a "Resueltos" con su commit, métricas, discrepancias con front e infra. Si no hay nada que reflejar, se deja una línea que lo diga explícitamente en lugar de omitirlo.

**2. Documentos según el área tocada.** La tabla de la sección 2 de `docs/guias/mantenimiento.md` ya dice qué documento toca cada cambio. Se convierte en datos para que el control la use:
- `docsObligatorios` en `flujo.json`: documentos que cambian siempre (en Sigmetum, solo `docs/07-estado-y-deuda-tecnica.md`).
- `docsPorArea` en `flujo.json`: mapa de ruta de código → documentos. Ejemplos (de esa tabla): `routes/**` → `docs/04-api.md`, `docs/05-modulos.md`; `config/validateEnv.js` y `.env.example` → `docs/03-configuracion.md` y `docs/integracion/para-infra.md`; `config/s3Paths.js`, `aws/**` → `docs/06-almacenamiento-s3.md`, `docs/05-modulos.md`; columnas del Excel, JWT, formato de respuestas, CORS, `GET /get-data` → además `docs/integracion/para-frontend.md`; `package.json` → `docs/02-tecnologias.md`; `.claude/**` y `plugins/**` → `docs/README.md`.

**3. Integración con frontend e infraestructura.** Cuando el cambio toca el contrato con el frontend o lo que necesita la infraestructura (secciones 2 y 6 de `mantenimiento.md`):
- Se actualizan `docs/integracion/para-frontend.md` o `para-infra.md` de este repo.
- El tester-documentador genera un bloque **"Aviso para PR"**: qué cambia y qué debe hacer el frontend o infra (lista de la sección 6). Se muestra en la puerta final.
- Los repos `sigmetum-frontend` y `sigmetum-infra` solo se **leen** para contrastar; este flujo no los edita (regla de `CLAUDE.md`).

**4. Control mecánico: `plugins/ciclo-agentico/scripts/docs-gate.mjs`** (genérico, vive en el plugin para que viaje con él; lo invoca `verificacion` en `flujo.json`, y en Sigmetum se expone como `npm run docs:gate`). El formato de la fecha de `07` es configurable en `flujo.json` (`estadoFecha`, expresión regular). Compara el estado de git con `HEAD`, incluidos los archivos sin seguimiento, y falla si:
- `docsObligatorios` no aparece modificado, o la fecha "actualizado" de `07` no es la de hoy;
- un archivo de código cambió y ninguno de los documentos de su entrada en `docsPorArea` cambió;
- el cambio toca un área marcada como contrato (front/infra) y falta su documento de `integracion/` o el bloque "Aviso para PR".

**Límite honesto:** el control comprueba que los documentos se tocaron, no que lo escrito sea cierto. Para eso siguen `npm run docs:check` (consistencia con el código) y la revisión del tester contra la lista de la sección 3 de `mantenimiento.md` ("lo que el script no puede comprobar"). Lo no verificable se marca **(por confirmar)**.

**5. Quién y cuándo.** El `tester-documentador` ejecuta `docs-gate` y `docs:check` en el paso 4 y no puede declarar la iteración cerrada si fallan. El orquestador no presenta la puerta final mientras el cierre documental esté en rojo. Si tras `maxVueltas` sigue en rojo, escala al usuario.

**6. Efectos sobre los documentos del repo (parte del plan, no se hace antes de aprobar):**
- `docs/guias/mantenimiento.md`: nueva fila en la sección 2 para `plugins/ciclo-agentico/` y `.claude/flujo.json`, y mención de `docs-gate`.
- `CLAUDE.md`: el punto "Al terminar" menciona el cierre documental obligatorio.
- `scripts/docs-check.mjs`: excluir `docs/specs/` del chequeo de índice (las specs son documentos de trabajo). El estado y la deuda siguen en `07`, que es el único documento obligatorio en cada iteración.
- Cifras nuevas (agentes, skills, scripts) solo en la tabla de métricas de `07`.

## Límites técnicos conocidos (huecos detectados al revisar la spec)

1. **Los subagentes no pueden preguntarte.** Un subagente trabaja y devuelve un resultado; no mantiene un diálogo contigo. Pero `requirements` necesita preguntar (el brainstorming de Superpowers es interactivo). Solución: la fase de requisitos se ejecuta en la **conversación principal**, guiada por la definición del rol `requirements`; o el subagente devuelve su lista de preguntas y el orquestador las plantea. Las puertas humanas también viven siempre en la conversación principal, nunca dentro de un subagente.
2. **Los límites por `tools` no son estancos.** El tester necesita Bash para ejecutar `lint`, `quality` y tests, y con Bash podría modificar código. Mitigación comprobable: el orquestador guarda la lista de archivos de código modificados antes del paso 4 y la compara al terminar; si el tester cambió código de producción, la iteración falla. El architect y `requirements` no reciben Bash.
3. **No hay tests todavía** (`npm test` es un placeholder, hallazgo M11). La regla "TDD" de `CLAUDE.md` solo aplica cuando exista la base de tests, así que el developer no puede hacer TDD hoy. Hasta entonces el tester documenta la verificación manual y los casos que deberían ser tests. Propuesta: usar **M11 como primera tarea real del ciclo**, para que el flujo tenga con qué trabajar.
4. **Fijar versiones.** Ver "Pendiente": instalar la versión revisada depende de que el comando lo permita.

## Equipo nuevo: arranque desde cero

**Hueco detectado:** `/ciclo-init` y `dependencias.json` están dentro del plugin, y en un equipo que no lo tiene el plugin no existe todavía, así que no pueden instalarse a sí mismos. Se cierra con tres capas:

1. **Declarado en el repo (se versiona).** `.claude/settings.json` lleva `extraKnownMarketplaces` y `enabledPlugins` para el plugin local y cada plugin del catálogo. Al abrir el repo en un equipo nuevo y aceptar la confianza de la carpeta, Claude Code ofrece instalarlos. Que `extraKnownMarketplaces` acepte una ruta local del repo para el plugin propio **(por confirmar)**; si no, se usa el paso 3.
2. **Script de arranque sin dependencias: `plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs`** (se ejecuta desde la ruta del repo, así que no necesita el plugin instalado). Node puro, sin plugin. Lee `plugins/ciclo-agentico/.claude-plugin/dependencias.json`, comprueba `claude plugin list`, muestra qué falta y de dónde viene, pide confirmación y ejecuta los `claude plugin marketplace add` e `install`. Comprueba el sistema operativo y avisa de lo que no aplica (Octopus en Windows nativo). Idempotente: si ya está todo, no hace nada. Es lo primero que se ejecuta en un equipo nuevo.
3. **Documentado: `plugins/ciclo-agentico/README.md`** y una sección en `docs/README.md` con el orden exacto:
   1. Clonar el repo y `npm install`.
   2. Tener Claude Code instalado y autenticado.
   3. `node plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs`.
   4. `claude plugin marketplace add ./plugins/ciclo-agentico` y `claude plugin install ciclo-agentico` (si la capa 1 no lo hizo).
   5. `/ciclo-init` para verificar `flujo.json` (en Sigmetum ya existe y solo se valida).
   6. Verificación: `claude plugin list` y un `/ciclo` de prueba.

**Qué no se replica y por qué está bien:**
- La memoria del usuario y los archivos de `memory/` (desactivados en el proyecto).
- El grafo de Understand-Anything (`.understand-anything/`, ignorado en git): se regenera en el paso 0.
- El archivo `~/.claude/.i-have-adhd-always`: no se crea, el modo siempre activo es opcional y personal.
- Las instalaciones globales del usuario: las repone el script de arranque, con confirmación.

**Diferencias por sistema operativo:** Octopus solo funciona en Linux, macOS o WSL. El script lo detecta y deja `consultor: ninguno` en un equipo Windows nativo. Las rutas del script usan `node:path`, no barras fijas.

**Prueba:** en un directorio limpio (o una VM), clonar, ejecutar el script y comprobar que `claude plugin list` muestra los plugins del perfil activo y que `/ciclo` arranca. El script debe ser seguro de ejecutar dos veces.

## Salvaguardas en `settings.json` (plantilla)

- `git commit`, `git push`, `git add -A` pasan a `ask`.
- Memoria automática: `"autoMemoryEnabled": false` (alternativa: variable `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`). Fuente: documentación de Claude Code, consultada por un subagente; se verifica al aplicarla comprobando que la memoria deja de cargarse.

## Sección para `CLAUDE.md` (plantilla)

Solo el ciclo y los cuatro roles, con un enlace a la skill `principios`. Los principios (pensar antes de escribir código; simplicidad; cambios quirúrgicos; objetivos verificables) no se copian aquí: su fuente única es la skill del plugin. Es mi resumen de las guías tipo Karpathy que circulan, no una cita literal **(por confirmar contra la fuente que prefieras)**. En Sigmetum las guías existentes no cambian.

## Pruebas del flujo

1. En un proyecto vacío: `/ciclo-init` genera los archivos y no hace commit.
2. En Sigmetum: `/ciclo` sobre una tarea pequeña y real. Cada rol respeta sus herramientas, hay puerta entre fases, no se crea ningún commit y el refresh lee el estado actual.
3. Con `consultor: ninguno` y `estilo: ninguno` el flujo sigue completo.
4. Con una dependencia faltante, `/ciclo-init` pide confirmación, instala la versión fijada y la verifica; si se rechaza, el flujo sigue.
5. El chequeo de portabilidad pasa: sin referencias a Sigmetum dentro de `plugins/ciclo-agentico/`.

## Pendiente

- Confirmar el nombre del plugin.
- Que `lint` y `quality` no analicen `plugins/ciclo-agentico/` (por confirmar).
- Comprobar en la práctica la ruta local relativa y `autoMemoryEnabled` (la documentación los respalda, pero no se ha probado aquí).
- Archivos de `memory/` existentes: se dejan inertes (decidido); con la memoria desactivada no se cargan.
- Fijar versión al instalar: `claude plugin marketplace add` sigue la rama principal por defecto; si admite fijar un commit o etiqueta **(por confirmar)** se usa, y si no, `dependencias.json` registra el commit revisado y el instalador avisa cuando difiere.
- Marketplace de Octopus ya añadido en la máquina (`nyldn-plugins`), sin plugin instalado: decidir si se quita.
- Cuál es la primera tarea real del ciclo (propuesta: M11, la base de tests; ver "Límites técnicos conocidos").
- `scripts/docs-check.mjs` exige que todo `.md` bajo `docs/` figure en el índice de `docs/README.md`, y esta spec lo hace fallar (verificado). Decisión: excluir `docs/specs/` de esa comprobación (ver "Cierre documental obligatorio").
- Si `docs-gate` debe fallar también cuando el cambio es solo de documentación (sin código): por defecto exige igualmente `07` actualizado.
