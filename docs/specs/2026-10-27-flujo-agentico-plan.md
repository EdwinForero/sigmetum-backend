# Flujo agéntico: plan de implementación

Fecha: 2026-10-27 · Estado: cerrado (Tareas 1-9 ejecutadas con sus olas de arreglo y reorganización; queda la Tarea 10, verificación en vivo, registrada en M18 de `docs/07`). Varias rutas y comandos de este plan quedaron superados por la reorganización a un marketplace único en `plugins/`: manda la sección "Enmiendas" de la spec.

> **Para quien ejecute:** usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`. Los pasos usan casillas `- [ ]`.

**Objetivo:** crear el plugin `ciclo-agentico` (4 roles, `/ciclo`, `/ciclo-init`, cierre documental obligatorio, arranque en equipo nuevo) dentro de este repo y adaptarlo a Sigmetum con `.claude/flujo.json`.

**Arquitectura:** `plugins/ciclo-agentico/` es un plugin autocontenido (sin referencias a Sigmetum). Dos scripts Node puros (`docs-gate.mjs`, `bootstrap-agentes.mjs`) leen `.claude/flujo.json`. Los agentes y comandos son prompts; su estructura se verifica con tests de forma. Sigmetum solo aporta `flujo.json`, `settings.json` y ajustes de sus controles.

**Tecnología:** Node 22, módulos ESM `.mjs`, `node:test` (sin dependencias nuevas), `execFileSync` con argumentos fijos y sin shell.

**Spec:** [2026-10-27-flujo-agentico-design.md](2026-10-27-flujo-agentico-design.md)

## Restricciones globales

- Quien ejecute **no hace `git commit` ni `git push`** (`CLAUDE.md`). Cada tarea termina con "Punto de control": se lista lo cambiado y el usuario decide el commit. Los commits que toquen el plugin no mezclan otras carpetas.
- `plugins/ciclo-agentico/` no contiene `sigmetum`, `S3` ni `Express` (sin distinguir mayúsculas) fuera de `tests/`.
- Documentación en español. Lo no comprobable se marca **(por confirmar)**.
- Ningún secreto en archivos. No se crea `~/.claude/.i-have-adhd-always`. No se instala nada global sin confirmación explícita del usuario.
- Valores fijos: plugin `ciclo-agentico`, versión inicial `0.1.0`; `maxVueltas: 3`; `"autoMemoryEnabled": false`; permisos `ask` para `git commit`, `git push` y `git add -A`; `.understand-anything/` y `.ua/` en `.gitignore`.
- Precedente para `child_process`: `scripts/quality-check.mjs` ya usa `spawnSync`. Los scripts del plugin lo usan solo con `execFileSync(cmd, [args fijos])`, fuera de `routes/ config/ functions/ aws/ middleware/` (lo que analiza `quality`). **El usuario debe confirmarlo al revisar el plan**, porque `CLAUDE.md` lo prohíbe en la API.
- Pruebas: `node --test "plugins/ciclo-agentico/tests/**/*.test.mjs"`. Los archivos son `*.test.mjs`.

## Foco de revisión

1. El documento de estado no tiene fecha reconocible: `docs-gate` da un mensaje claro y no lanza (Tarea 3).
2. Rutas con espacios, renombradas, borradas o sin seguimiento, y saltos CRLF de Windows (Tarea 3).
3. `claude` no instalado o formato distinto de `claude plugin list`: no se instala nada y sale con código 2 (Tarea 4).
4. `flujo.json` ausente, incompleto o mal formado: el mensaje remite a `/ciclo-init` (Tarea 2).
5. Una ruta que coincide con varios patrones de `docsPorArea` (gana el más específico) y barras invertidas de Windows (Tarea 3).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `plugins/ciclo-agentico/.claude-plugin/plugin.json`, `marketplace.json`, `dependencias.json` | Manifiestos y catálogo de dependencias |
| `plugins/ciclo-agentico/scripts/lib/flujo.mjs` | Cargar y validar `.claude/flujo.json` |
| `plugins/ciclo-agentico/scripts/docs-gate.mjs` | Control del cierre documental |
| `plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs` | Instalar dependencias en un equipo nuevo |
| `plugins/ciclo-agentico/agents/*.md` (4) | Roles con herramientas limitadas |
| `plugins/ciclo-agentico/skills/principios/`, `refresh-estado/` | Principios genéricos y paso 0 |
| `plugins/ciclo-agentico/commands/ciclo.md`, `ciclo-init.md` | Orquestador y preparación de proyecto |
| `plugins/ciclo-agentico/templates/*` | Plantillas para otros proyectos |
| `plugins/ciclo-agentico/tests/*.test.mjs` | Pruebas del plugin |
| `.claude/flujo.json`, `.claude/settings.json`, `.gitignore` | Adaptación a Sigmetum |
| `eslint.config.js`, `scripts/docs-check.mjs`, `package.json` | Controles del repo |
| `docs/…`, `CLAUDE.md` | Documentación y reglas |

---

### Tarea 1: Esqueleto del plugin y manifiestos

**Archivos:**
- Crear: `plugins/ciclo-agentico/.claude-plugin/plugin.json`, `marketplace.json`, `plugins/ciclo-agentico/README.md`, `CHANGELOG.md`
- Prueba: `plugins/ciclo-agentico/tests/manifiestos.test.mjs`

**Interfaces:** produce los manifiestos que las demás tareas completan (`dependencias.json` en la Tarea 4).

- [ ] **Paso 1: prueba que falla.** `manifiestos.test.mjs` lee ambos JSON y comprueba: `plugin.json` tiene `name === 'ciclo-agentico'` y `version === '0.1.0'`; `marketplace.json` tiene `name`, `owner.name` y `plugins[0].name === 'ciclo-agentico'` con `source` relativo que empieza por `./`.
- [ ] **Paso 2:** `node --test plugins/ciclo-agentico/tests/manifiestos.test.mjs`. Esperado: FALLA (archivos inexistentes).
- [ ] **Paso 3:** crear los dos JSON con esos valores (`owner.name`: `EdwinForero`, `source`: `./`), un `README.md` con título y una línea de propósito, y `CHANGELOG.md` con la entrada `0.1.0`.
- [ ] **Paso 4:** repetir el paso 2. Esperado: PASA.
- [ ] **Paso 5: punto de control.** Listar los archivos creados.

### Tarea 2: Carga y validación de `flujo.json`

**Archivos:**
- Crear: `plugins/ciclo-agentico/scripts/lib/flujo.mjs`
- Prueba: `plugins/ciclo-agentico/tests/flujo.test.mjs`

**Interfaces:** produce `validarFlujo(obj: object): { ok: boolean, problemas: string[] }` y `cargarFlujo(raiz: string): { flujo: object | null, problemas: string[] }`. Campos obligatorios: `guias: string[]`, `estado: string`, `estadoFecha: string` (expresión regular con un grupo `DD/MM/AAAA`), `verificacion: object`, `specsDir: string`, `maxVueltas: entero ≥ 1`, `consultor: 'octopus' | 'ninguno'`, `estilo: 'i-have-adhd' | 'ninguno'`, `perfiles: string[]`, `docsObligatorios: string[]`, `docsPorArea: { [patron]: string[] }`, `areasContrato: string[]`, `avisoPR: string` (patrón del archivo del aviso). Opcionales: `integracion`, `skillsProyecto`, `docsRegla`, `criticidad`.

- [ ] **Paso 1: pruebas que fallan** (Foco 4): configuración válida → `ok`; cada campo obligatorio ausente → un problema que nombra el campo; `maxVueltas: 0` → problema; `consultor: 'otro'` → problema; `estadoFecha` con regex inválida → problema; `cargarFlujo` sobre carpeta sin `.claude/flujo.json` → `flujo: null` y un problema que contiene `/ciclo-init`; JSON mal formado → problema que contiene la ruta del archivo.
- [ ] **Paso 2:** ejecutar `node --test plugins/ciclo-agentico/tests/flujo.test.mjs`. Esperado: FALLA.
- [ ] **Paso 3:** implementar ambas funciones. Valida tipos con comprobaciones simples, sin dependencias.
- [ ] **Paso 4:** repetir paso 2. Esperado: PASA.
- [ ] **Paso 5: punto de control.**

### Tarea 3: `docs-gate.mjs` (cierre documental)

**Archivos:**
- Crear: `plugins/ciclo-agentico/scripts/docs-gate.mjs`
- Prueba: `plugins/ciclo-agentico/tests/docs-gate.test.mjs`

**Interfaces:**
- Consume: `validarFlujo`, `cargarFlujo` (Tarea 2).
- Produce: `coincide(ruta: string, patron: string): boolean` (patrones `*` dentro de un segmento y `**` entre segmentos; normaliza `\` a `/`); `docsDeArea(ruta: string, docsPorArea: object): string[] | null` (gana el patrón con más caracteres literales; empate: unión; sin coincidencia: `null`); `fechaHoy(fecha?: Date): string` en formato `DD/MM/AAAA`; `cambiosGit(raiz: string): string[]` (rutas con barras `/`, incluye sin seguimiento, borradas y, de los renombrados, origen y destino); `evaluarGate({ cambios, flujo, hoy, textoEstado }): { ok: boolean, problemas: string[] }`; CLI `node docs-gate.mjs [--raiz <ruta>] [--solo-validar]` con código de salida 1 si hay problemas.

- [ ] **Paso 1: pruebas que fallan.**
  - `coincide('routes/auth.js','routes/**') === true`; `coincide('routes\\auth.js','routes/**') === true`; `coincide('config/validateEnv.js','config/*.js') === true`; `coincide('config/a/b.js','config/*.js') === false` (Foco 5).
  - `docsDeArea`: con `{'config/**':['A'],'config/validateEnv.js':['B']}` la ruta `config/validateEnv.js` da `['B']`; `config/otro.js` da `['A']`; `README.md` da `null` (Foco 5).
  - `evaluarGate`: falla si el documento `estado` no está en `cambios`; falla si la fecha de `textoEstado` (según `estadoFecha`) no es `hoy`, con mensaje que contiene ambas fechas; con texto sin fecha reconocible devuelve un problema que contiene `no se encontró la fecha` y no lanza (Foco 1); código cambiado sin ninguno de los documentos de su área → problema con el archivo y los documentos esperados; con sus documentos → `ok`; área de contrato sin archivo que coincida con `avisoPR` → problema; con él → `ok`; solo documentos más `estado` actualizado → `ok`.
  - `cambiosGit` en un repo temporal creado en la prueba (`git init`, usuario de prueba): archivo nuevo sin seguimiento, nombre `con espacios.js`, archivo borrado y archivo renombrado; fin de línea CRLF en el archivo de estado no afecta a la fecha (Foco 2).
- [ ] **Paso 2:** ejecutar `node --test plugins/ciclo-agentico/tests/docs-gate.test.mjs`. Esperado: FALLA.
- [ ] **Paso 3:** implementar. `cambiosGit` usa `execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd })` y separa por `\0`. Las expresiones regulares de `coincide` se construyen escapando el patrón, no con entrada externa.
- [ ] **Paso 4:** repetir paso 2. Esperado: PASA.
- [ ] **Paso 5: punto de control.**

### Tarea 4: `bootstrap-agentes.mjs` y catálogo de dependencias

**Archivos:**
- Crear: `plugins/ciclo-agentico/.claude-plugin/dependencias.json`, `plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs`
- Prueba: `plugins/ciclo-agentico/tests/bootstrap.test.mjs`

**Interfaces:**
- Produce: `parsearLista(texto: string): string[]` (ids únicos `nombre@marketplace` de las líneas con `❯`); `planificar({ catalogo, perfiles, instalados, plataforma }): { faltantes: Dep[], omitidos: { dep: Dep, motivo: string }[] }`; `main({ argv, ejecutar, preguntar, plataforma }): number` (devuelve el código de salida; `ejecutar(cmd, args): string` e `preguntar(texto): boolean` son inyectables). Opciones: `--dry-run` (no instala ni pregunta), `--raiz`.
- `Dep` = `{ id, rol: 'base'|'consultor'|'estilo'|'estilo-ui', perfil, marketplace, plataformas?: string[], revisado?: { version, commit } }`.
- Catálogo (ids ya verificados con `claude plugin list`): `superpowers@superpowers-marketplace` (`obra/superpowers-marketplace`, perfil `base`, rol `base`), `understand-anything@understand-anything` (`Egonex-AI/Understand-Anything`, `base`), `diagram-design@diagram-design` (`cathrynlavery/diagram-design`, `base`), `i-have-adhd@i-have-adhd` (`ayghri/i-have-adhd`, `base`, rol `estilo`, revisado `0.4.1` / `1ecea19`), `octo@nyldn-plugins` (`https://github.com/nyldn/claude-octopus.git`, `base`, rol `consultor`, `plataformas: ['linux','darwin']`, revisado `11.15.1` / `ee7bcb4`), `impeccable` (`pbakaus/impeccable`, perfil `frontend`; id exacto **(por confirmar)** al instalarlo).

- [ ] **Paso 1: pruebas que fallan.** `parsearLista` sobre una muestra literal copiada de `claude plugin list` (con líneas `❯` repetidas por ámbito) devuelve ids sin duplicados; `planificar` con perfiles `['base','backend']` omite `impeccable`; en `plataforma: 'win32'` Octopus sale en `omitidos` con motivo que contiene `Windows`; con todo instalado `faltantes` está vacío; `main` con `ejecutar` que lanza `{ code: 'ENOENT' }` devuelve `2`, imprime un mensaje que contiene `claude` y no llama a instalar (Foco 3); con `--dry-run` no se llama a `preguntar` ni a instalar; si `preguntar` devuelve `false` no se instala y devuelve `0`.
- [ ] **Paso 2:** ejecutar `node --test plugins/ciclo-agentico/tests/bootstrap.test.mjs`. Esperado: FALLA.
- [ ] **Paso 3:** implementar. Instalar un faltante = `ejecutar('claude', ['plugin','marketplace','add', dep.marketplace])` y `ejecutar('claude', ['plugin','install', dep.id])`, y verificar con una nueva lista. Antes de ejecutar, imprime origen, versión revisada y comando. Nunca crea el archivo de modo siempre activo de `i-have-adhd`. Si la versión revisada puede fijarse al instalar es **(por confirmar)**; si no, imprime el aviso.
- [ ] **Paso 4:** repetir paso 2. Esperado: PASA.
- [ ] **Paso 5:** `node plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs --dry-run` en esta máquina. Esperado: Octopus en omitidos por Windows; el resto, ya instalado. Si la salida real de `claude plugin list` difiere de la muestra, ajustar `parsearLista` y su prueba.
- [ ] **Paso 6: punto de control.**

### Tarea 5: Roles y skill de principios

**Archivos:**
- Crear: `plugins/ciclo-agentico/agents/requirements.md`, `architect.md`, `developer.md`, `tester-documentador.md`; `plugins/ciclo-agentico/skills/principios/SKILL.md`
- Prueba: `plugins/ciclo-agentico/tests/estructura.test.mjs`, `portabilidad.test.mjs`

**Interfaces:** cada agente lleva frontmatter `name` (igual al nombre del archivo), `description`, `tools` y `skills` (incluye `principios`). Herramientas: `requirements`: `Read, Grep, Glob, Write` (Write solo en `specsDir`, indicado en el texto); `architect`: `Read, Grep, Glob`; `developer`: `Read, Grep, Glob, Edit, Write, Bash`; `tester-documentador`: `Read, Grep, Glob, Edit, Write, Bash`. Ninguno recibe herramientas de commit: la regla "no hacer commit ni push" va en el texto de los cuatro.

- [ ] **Paso 1: pruebas que fallan.** `estructura.test.mjs` comprueba lo anterior (nombre = archivo, herramientas exactas para `requirements` y `architect`, `Bash` ausente en ambos, `skills` con `principios`, frase `no hace commit` en los cuatro) y que cada agente tiene las secciones `## Límites`, `## Entrega` y `## Contrato de salida`. `portabilidad.test.mjs` recorre `plugins/ciclo-agentico` salvo `tests/` y falla si encuentra `sigmetum`, `S3` o `express` sin distinguir mayúsculas.
- [ ] **Paso 2:** ejecutar ambos. Esperado: FALLAN.
- [ ] **Paso 3:** escribir los cuatro agentes con el contenido de la spec (tabla de roles): qué leen de `.claude/flujo.json` (`guias`, `integracion`, `skillsProyecto`, `verificacion`, `docsRegla`), qué entregan, qué no pueden hacer. `architect` puede vetar, contrasta con `guias` e `integracion` y, si Understand-Anything está instalado, usa `understand-explain` sobre el módulo afectado. `tester-documentador`, si `diagram-design` está instalado, regenera los diagramas de los documentos que describen un flujo que cambió, y usa `understand-diff` para listar los componentes afectados. `developer` sigue TDD solo si existe una base de tests; si no, lo dice y entrega los casos que deberían serlo. `tester-documentador` ejecuta `verificacion` y `docs-gate`, actualiza documentos según `docsRegla`, genera el bloque "Aviso para PR" cuando toca un área de contrato y propone el mensaje de commit. El **contrato de salida** de los cuatro: acción primero, pasos numerados, estado en una línea, listas de máximo 5 elementos, un único siguiente paso, sin preámbulo ni recap. La skill `principios` recoge los cuatro principios (pensar antes de escribir código; simplicidad; cambios quirúrgicos; objetivos verificables) como resumen propio, sin citar una fuente.
- [ ] **Paso 4:** repetir paso 2. Esperado: PASAN.
- [ ] **Paso 5: punto de control.**

### Tarea 6: Comandos, skill de refresh y plantillas

**Archivos:**
- Crear: `plugins/ciclo-agentico/commands/ciclo.md`, `ciclo-init.md`; `plugins/ciclo-agentico/skills/refresh-estado/SKILL.md`; `plugins/ciclo-agentico/templates/flujo.json`, `CLAUDE-seccion.md`, `settings-snippet.json`, `spec.md`, `plan.md`
- Prueba: ampliar `estructura.test.mjs`

**Interfaces:** `/ciclo <tarea>` y `/ciclo-init`. `templates/flujo.json` debe pasar `validarFlujo`.

- [ ] **Paso 1: pruebas que fallan.** `templates/flujo.json` pasa `validarFlujo`; `settings-snippet.json` contiene `autoMemoryEnabled: false` y `git commit`, `git push` y `git add -A` bajo `permissions.ask`; `ciclo.md` contiene los pasos `0` a `5`, las palabras `puerta humana`, `maxVueltas`, `refresh-estado`, `docs-gate` y `bootstrap-agentes`; `ciclo-init.md` contiene `no hace commit`.
- [ ] **Paso 2:** ejecutar `node --test "plugins/ciclo-agentico/tests/**/*.test.mjs"`. Esperado: FALLAN las nuevas.
- [ ] **Paso 3:** escribir `ciclo.md` con el flujo de la spec: paso 0 (refresh más comprobación de dependencias con `bootstrap-agentes.mjs --dry-run`), fase de requisitos en la **conversación principal**, `architect`, consulta del consultor solo si el cambio coincide con `criticidad` y `consultor` no es `ninguno` (si no, `superpowers:requesting-code-review`), `developer`, guardar la lista de archivos de código modificados antes del paso 4 y compararla después (si el tester cambió código de producción, falla), `tester-documentador`, tope `maxVueltas`, cierre documental y puerta final con el bloque fijo (fase, resultado, decisión pendiente, riesgos, segunda opinión). `ciclo-init.md`: crea `flujo.json` desde la plantilla preguntando los valores, fusiona `settings-snippet.json` sin sobrescribir, añade la sección a `CLAUDE.md` y **no hace commit**. `refresh-estado`: `git status`, `git log -10`, documento `estado` y specs abiertas, y si Understand-Anything está instalado y el grafo no coincide con `HEAD`, lo actualiza de forma explícita (nunca con `--auto-update`). Las plantillas son genéricas.
- [ ] **Paso 4:** repetir paso 2. Esperado: PASAN todas, incluidas la de portabilidad.
- [ ] **Paso 5: punto de control.**

### Tarea 7: Adaptación a Sigmetum

**Archivos:**
- Crear: `.claude/flujo.json`
- Modificar: `.claude/settings.json`, `.gitignore`

**Interfaces:** `.claude/flujo.json` debe pasar `node plugins/ciclo-agentico/scripts/docs-gate.mjs --solo-validar`.

- [ ] **Paso 1:** ejecutar el comando de validación sin `flujo.json`. Esperado: sale con 1 y el mensaje remite a `/ciclo-init`.
- [ ] **Paso 2:** crear `.claude/flujo.json`: `guias: ['docs/guias/buenas-practicas-backend.md','docs/guias/seguridad.md','docs/guias/mantenimiento.md']`; `integracion: ['docs/integracion/para-frontend.md','docs/integracion/para-infra.md']`; `skillsProyecto: ['.claude/skills']`; `estado: 'docs/07-estado-y-deuda-tecnica.md'`; `estadoFecha: 'actualizado (\\d{2}/\\d{2}/\\d{4})'`; `verificacion: { lint: 'npm run lint', quality: 'npm run quality', 'docs:check': 'npm run docs:check', 'docs:gate': 'npm run docs:gate', 'agentes:test': 'npm run agentes:test' }` (más `test` cuando exista); `docsRegla: 'docs/guias/mantenimiento.md'`; `specsDir: 'docs/specs'`; `maxVueltas: 3`; `consultor: 'ninguno'` (Octopus no funciona en Windows nativo; pasa a `octopus` en un equipo Linux, macOS o WSL); `estilo: 'i-have-adhd'`; `perfiles: ['base','backend']`; `criticidad: ['autenticación y JWT','claves de S3','dependencias','contrato con el frontend','CI']`; `docsObligatorios: ['docs/07-estado-y-deuda-tecnica.md']`; `avisoPR: 'docs/specs/*-aviso-pr.md'`; `areasContrato: ['routes/**','middleware/errorHandler.js','config/s3Paths.js','config/validateEnv.js','functions/convertExcelToJson.js','functions/formatFileName.js','functions/getNextVersion.js','functions/tokenAuthentication.js','functions/userAuthentication.js','.env.example','package.json','.github/**']`; `docsPorArea` derivado de la sección 2 de `mantenimiento.md`: `routes/**` → 04, 05; `index.js` → 04, 05; `middleware/**` → 05; `functions/**` → 05; `aws/**` → 05, 06; `config/**` → 05; `config/s3Paths.js` → 05, 06; `config/validateEnv.js` → 03, `docs/integracion/para-infra.md`; `.env.example` → 03, para-infra; `functions/convertExcelToJson.js` → 05, 06, `docs/integracion/para-frontend.md`; `functions/formatFileName.js` y `functions/getNextVersion.js` → 05, 06, para-frontend; `functions/tokenAuthentication.js` y `functions/userAuthentication.js` → 03, 04, 05, para-frontend; `package.json` → 02, 03; `eslint.config.js` → 02, `docs/guias/buenas-practicas-backend.md`; `.github/**` → 01, para-infra; `scripts/**` → `docs/guias/mantenimiento.md`; `.claude/**` y `plugins/**` → `docs/README.md` (todas las rutas `docs/` completas, con prefijo `docs/` y nombre real de archivo; comprobar cada nombre con `ls docs`).
- [ ] **Paso 3:** `.claude/settings.json`: conservar lo actual, sustituir `superpowers@claude-plugins-official` por `superpowers@superpowers-marketplace`, añadir en `extraKnownMarketplaces` los de `superpowers-marketplace`, `understand-anything`, `diagram-design`, `i-have-adhd` y `ciclo-agentico` (este último con la ruta local; que Claude Code la acepte es **(por confirmar)**), añadir sus entradas a `enabledPlugins`, `permissions.ask` con los tres comandos de git y `"autoMemoryEnabled": false`. `.gitignore`: añadir `.understand-anything/` y `.ua/`.
- [ ] **Paso 4:** repetir el paso 1. Esperado: sale con 0. Validar que `.claude/settings.json` es JSON válido.
- [ ] **Paso 5: punto de control.**

### Tarea 8: Controles del repo (ESLint, `docs:check`, scripts npm)

**Archivos:**
- Modificar: `eslint.config.js`, `scripts/docs-check.mjs`, `package.json`

**Interfaces:** nuevos scripts `docs:gate` (`node plugins/ciclo-agentico/scripts/docs-gate.mjs`), `agentes:test` (`node --test "plugins/ciclo-agentico/tests/**/*.test.mjs"`), `agentes:bootstrap` (`node plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs`).

- [ ] **Paso 1:** `npm run lint` y `npm run docs:check`. Anotar el estado de partida (lint pasa con el tope actual; `docs:check` falla por la spec y el plan fuera del índice).
- [ ] **Paso 2:** en `eslint.config.js`, añadir `'plugins/**/*.mjs'` a `files` del bloque de scripts de mantenimiento (ESM, `no-console` apagado). En `scripts/docs-check.mjs`, excluir `docs/specs/` del chequeo de índice (línea del bucle sobre `docFiles`) y `plugins/` de `testFiles`, para que las pruebas del plugin no cuenten como tests de la API. Añadir los tres scripts a `package.json`.
- [ ] **Paso 3:** `npm run lint` (sin avisos nuevos: si aparecen, corregirlos en el código del plugin), `npm run quality`, `npm run docs:check` y `npm run agentes:test`. Esperado: lint y quality como al inicio; `docs:check` falla solo por los scripts nuevos que aún no están en `docs/03` (se cierra en la Tarea 9); `agentes:test` PASA.
- [ ] **Paso 4: punto de control.**

### Tarea 9: Documentación y cierre documental propio

**Archivos:**
- Modificar: `docs/03-configuracion.md`, `docs/README.md`, `docs/guias/mantenimiento.md`, `docs/07-estado-y-deuda-tecnica.md`, `CLAUDE.md`, `README.md` (si lista comandos)
- Opcional según resultado: `docs/integracion/para-infra.md` (solo si cambia lo que necesita infraestructura; la Tarea 7 no lo cambia)

- [ ] **Paso 1:** `docs/03`: tabla de scripts con `docs:gate`, `agentes:test`, `agentes:bootstrap`. `docs/README.md`: estructura con `plugins/ciclo-agentico/`, `.claude/flujo.json`, `docs/specs/`, y la sección "Equipo nuevo" con los seis pasos de la spec. `mantenimiento.md`: fila nueva en la sección 2 para `plugins/ciclo-agentico/` y `.claude/flujo.json`, mención de `docs-gate` y del cierre documental obligatorio. `CLAUDE.md`: comandos nuevos, sección breve del ciclo y los cuatro roles con enlace a `principios`, y el punto "Al terminar" con el cierre documental.
- [ ] **Paso 2:** `docs/07`: poner la fecha de la línea 3 al día de hoy, revisar `npm run docs:check -- --metrics` y actualizar solo las cifras que cambien, y registrar la iteración (flujo agéntico creado; el pendiente M11 sigue abierto). Hallazgo nuevo si procede: la verificación en Windows nativo de Octopus queda como limitación conocida.
- [ ] **Paso 3:** `npm run docs:check`, `npm run docs:gate`, `npm run lint`, `npm run quality`, `npm run agentes:test`. Esperado: todo pasa. Si `quality` falla por algo que ya estaba (por ejemplo M16), no se oculta: se anota en el resumen.
- [ ] **Paso 4: punto de control.** Resumen para la PR, incluido el "Aviso para PR" (esta iteración no cambia el contrato con el frontend ni lo que necesita infraestructura: se declara así).

### Tarea 10: Verificación de extremo a extremo

**Archivos:** ninguno nuevo; se anotan los resultados en `docs/07`.

- [ ] **Paso 1: instalación local (global, con confirmación del usuario).** `claude plugin marketplace add ./plugins` y `claude plugin install ciclo-agentico@locales` (más los plugins del proyecto de `plugins/README.md`; reorganización B1). Si la ruta relativa falla, usar la ruta absoluta y anotarlo en la spec. Reiniciar la sesión.
- [ ] **Paso 2: proyecto vacío.** En una carpeta temporal fuera del repo, `/ciclo-init`. Esperado: crea `flujo.json`, fusiona la configuración y no hace commit.
- [ ] **Paso 3: humo en Sigmetum.** `/ciclo` con una tarea mínima de solo documentación. Comprobar: el requisito se pregunta en la conversación principal; hay puerta humana entre fases; `architect` no recibe Bash; no se crea ningún commit; `docs-gate` pasa y el documento 07 queda actualizado; la comprobación de código modificado por el tester no salta en falso.
- [ ] **Paso 4: sin adaptadores.** Repetir con `consultor: 'ninguno'` y `estilo: 'ninguno'`. Esperado: el flujo completa.
- [ ] **Paso 5: verificaciones que quedaban abiertas.** Confirmar que `autoMemoryEnabled` desactiva la memoria (no se cargan los archivos de `memory/`), si `claude plugin marketplace add` permite fijar versión, y el `id` de `impeccable`. Registrar cada resultado en la spec y marcar como resueltos los pendientes.
- [ ] **Paso 6: punto de control final.** Estado de git, resultados de los cinco comandos y lista de pendientes. Primera tarea real propuesta: M11 (base de tests).
