// Comprueba que la documentación sigue el ritmo del código.
// Uso: npm run docs:check               (sale con código 1 si hay algo desactualizado)
//      npm run docs:check -- --metrics  (imprime las métricas reales para pegarlas en docs/07)
// Las reglas y lo que NO se comprueba automáticamente están en docs/guias/mantenimiento.md.
// Sin dependencias: solo módulos de Node.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_DOC = resolve(ROOT, '..', 'sigmetum-frontend', 'docs', 'integracion', 'para-backend.md');

const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const posix = (file) => file.split(sep).join('/');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unique = (list) => [...new Set(list)];

const IGNORED = new Set(['node_modules', '.git', 'uploads']);
const walk = (dir) =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const path = posix(join(dir, name));
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });

// ─── Código y documentos ────────────────────────────────────────────────────

const CODE_DIRS = ['routes', 'config', 'functions', 'aws', 'middleware'];
const codeFiles = ['index.js', ...CODE_DIRS.flatMap((dir) => walk(dir)).filter((file) => file.endsWith('.js'))];
const testFiles = walk('.').filter((file) => /\.(test|spec)\.[cm]?js$/.test(file));

const docFiles = [
  'README.md',
  ...['CLAUDE.md', 'INTEGRACION.md'].filter((file) => existsSync(join(ROOT, file))),
  ...walk('docs').filter((file) => file.endsWith('.md')),
  ...(existsSync(join(ROOT, '.claude')) ? walk('.claude').filter((file) => file.endsWith('.md')) : []),
];
const docs = Object.fromEntries(docFiles.map((file) => [file, read(file)]));
const doc = (name) => docs[`docs/${name}`] ?? '';

// Filas de las tablas markdown como arrays de celdas (sin la fila separadora).
const tableRows = (text) =>
  text
    .split('\n')
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));

const stripTicks = (cell) => cell.replace(/^`+|`+$/g, '');

// ─── Datos extraídos del código ─────────────────────────────────────────────

// Rutas: `router.get('/x', ...)` y `protectedRouter.post('/y', ...)`. Una ruta es protegida
// si cuelga de `protectedRouter` o si `tokenAuth` aparece en la misma línea.
const cleanPath = (path) => path.replace(/\(\*\)/g, '');
const codeRoutes = [];
for (const file of codeFiles.filter((f) => f.startsWith('routes/'))) {
  for (const line of read(file).split('\n')) {
    const match = line.match(/^\s*(router|protectedRouter)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3(.*)$/);
    if (!match) continue;
    const [, owner, method, , path, rest] = match;
    codeRoutes.push({
      method: method.toUpperCase(),
      path: cleanPath(path),
      protected: owner === 'protectedRouter' || /\btokenAuth\b/.test(rest),
      file: basename(file),
    });
  }
}
// Rutas declaradas directamente en index.js (hoy, solo /healthcheck; `app.use` responde a todos los métodos, se documenta como GET).
for (const [, path] of read('index.js').matchAll(/app\.(?:get|use)\(\s*'(\/[^']*)'/g)) {
  codeRoutes.push({ method: 'GET', path, protected: false, file: 'index.js' });
}
const apiRoutes = codeRoutes.filter((route) => route.file !== 'index.js');

// Variables de entorno.
const validateSrc = read('config/validateEnv.js');
const listFrom = (name) =>
  [...(validateSrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? '').matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
const requiredVars = listFrom('required');
const requiredLocalVars = listFrom('requiredLocal');
const usedVars = unique(codeFiles.flatMap((file) => [...read(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])));
const exampleVars = [...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);

// Rutas de S3.
const s3Src = read('config/s3Paths.js');
const s3Constants = [...s3Src.matchAll(/^exports\.(\w+)\s*=\s*'([^']*)'/gm)].map((m) => ({ name: m[1], value: m[2] }));
const reservedSegments = [...(s3Src.match(/RESERVED_SEGMENTS\s*=\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

// Columnas del Excel.
const fixedColumns = [...(read('functions/convertExcelToJson.js').match(/const fixedColumnOrder = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

// Package.
const pkg = JSON.parse(read('package.json'));
const lock = existsSync(join(ROOT, 'package-lock.json')) ? JSON.parse(read('package-lock.json')) : { packages: {} };
const prodDeps = Object.keys(pkg.dependencies ?? {});
const devDeps = Object.keys(pkg.devDependencies ?? {});
const installedVersion = (name) => lock.packages?.[`node_modules/${name}`]?.version;

// Nombres exportados por cada archivo (para docs/05).
const exportedNames = (file) => {
  const text = read(file);
  const names = [...text.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]);
  const object = text.match(/^module\.exports\s*=\s*\{([^}]*)\}/m);
  if (object) names.push(...object[1].split(',').map((n) => n.trim().split(':')[0].trim()).filter(Boolean));
  const single = text.match(/^module\.exports\s*=\s*(\w+);/m);
  if (single) names.push(single[1]);
  return names;
};
const s3Exports = exportedNames('aws/awsS3connect.js');
const guideFiles = docFiles.filter((file) => file.startsWith('docs/guias/'));

const metrics = () => ({
  'Archivos de código (sin tests)': codeFiles.length,
  'Endpoints (sin /healthcheck)': apiRoutes.length,
  'Endpoints públicos': apiRoutes.filter((route) => !route.protected).length,
  'Endpoints protegidos': apiRoutes.filter((route) => route.protected).length,
  'Funciones exportadas de S3': s3Exports.length,
  'Variables de entorno obligatorias': requiredVars.length,
  'Dependencias de producción': prodDeps.length,
  'Dependencias de desarrollo': devDeps.length,
  'Archivos de test': testFiles.length,
  'Guías (docs/guias)': guideFiles.length,
});

if (process.argv.includes('--metrics')) {
  const lines = [...codeFiles, ...testFiles].reduce((sum, file) => sum + read(file).split('\n').length, 0);
  console.log({ ...metrics(), 'Líneas de JS (con tests)': lines });
  console.log('Las métricas de la tabla de docs/07 son las de arriba, salvo las líneas (no se documentan).');
  process.exit(0);
}

const results = [];
const check = (name, problems) => results.push({ name, problems });
const warnings = [];

// ─── 1. Enlaces internos y anclas ───────────────────────────────────────────

const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

const anchorsOf = (text) => {
  let inFence = false;
  const anchors = new Set();
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const match = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (match) anchors.add(slug(match[1]));
  }
  return anchors;
};

{
  const problems = [];
  for (const [file, text] of Object.entries(docs)) {
    let inFence = false;
    text.split('\n').forEach((line, index) => {
      if (line.startsWith('```')) inFence = !inFence;
      if (inFence) return;
      for (const [, target] of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [pathPart, anchor] = target.split('#');
        const targetFile = pathPart ? posix(relative(ROOT, resolve(ROOT, dirname(file), pathPart))) : file;
        const where = `${file}:${index + 1}`;
        if (!existsSync(join(ROOT, targetFile))) {
          problems.push(`${where} enlaza a ${target}, que no existe`);
        } else if (anchor && targetFile.endsWith('.md')) {
          const anchors = anchorsOf(docs[targetFile] ?? read(targetFile));
          if (!anchors.has(anchor)) problems.push(`${where} enlaza a ${target}, pero el apartado no existe`);
        }
      }
    });
  }
  check('Enlaces internos y anclas', problems);
}

// ─── 2. Índice de docs/ ─────────────────────────────────────────────────────

{
  const index = doc('README.md');
  const problems = [];
  for (const file of docFiles.filter((f) => f.startsWith('docs/') && f !== 'docs/README.md')) {
    if (!index.includes(`](${file.replace('docs/', '')})`)) problems.push(`${file} no está en el índice de docs/README.md`);
  }
  for (const file of codeFiles) {
    if (!index.includes(basename(file))) problems.push(`${file} no aparece en la estructura de docs/README.md`);
  }
  check('Índice y estructura (docs/README.md)', problems);
}

// ─── 3. Rutas y endpoints (routes/*.js → docs/04) ───────────────────────────

{
  const problems = [];
  const api = doc('04-api.md');
  const accessOf = (cell) => (cell.includes('🔒') ? 'protegida' : cell.includes('🔓') ? 'pública' : '?');
  const rows = tableRows(api)
    .filter((cells) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(cells[0]))
    .map((cells) => ({ method: cells[0], path: stripTicks(cells[1]), access: accessOf(cells[2] ?? ''), file: stripTicks(cells[3] ?? '') }));

  const headings = new Map(
    [...api.matchAll(/^###\s+`(GET|POST|PUT|PATCH|DELETE)\s+([^\s?`]+)[^`]*`(.*)$/gm)].map((m) => [`${m[1]} ${m[2]}`, m[3].includes('🔒')])
  );

  for (const route of codeRoutes) {
    const id = `${route.method} ${route.path}`;
    const access = route.protected ? 'protegida' : 'pública';
    const row = rows.find((r) => r.method === route.method && r.path === route.path);
    if (!row) problems.push(`Falta ${id} en la tabla resumen de docs/04`);
    else {
      if (row.access !== access) problems.push(`${id} es ${access} en el código y ${row.access} en la tabla de docs/04`);
      if (row.file !== route.file) problems.push(`${id} está en ${route.file} y docs/04 dice ${row.file}`);
    }
    if (!headings.has(id)) problems.push(`Falta la sección "### \`${id}\`" en docs/04`);
    else if (headings.get(id) !== route.protected) problems.push(`La sección de ${id} en docs/04 ${route.protected ? 'no lleva' : 'lleva'} 🔒 y la ruta es ${access}`);
  }
  for (const row of rows) {
    if (!codeRoutes.some((r) => r.method === row.method && r.path === row.path)) problems.push(`docs/04 documenta ${row.method} ${row.path}, que no existe en el código`);
  }
  check('Rutas y endpoints (routes/*.js e index.js → 04-api.md)', problems);
}

// ─── 4. Variables de entorno ────────────────────────────────────────────────

{
  const problems = [];
  const table = new Map(
    tableRows(doc('03-configuracion.md'))
      .filter((cells) => /^`[A-Z][A-Z0-9_]+`$/.test(cells[0]))
      .map((cells) => [stripTicks(cells[0]), cells])
  );
  const all = unique([...requiredVars, ...requiredLocalVars, ...usedVars, ...exampleVars]);

  for (const name of all) {
    const cells = table.get(name);
    if (!cells) {
      problems.push(`${name} no aparece en la tabla de docs/03`);
      continue;
    }
    const mandatory = cells[1] ?? '';
    if (requiredVars.includes(name) && !/^Sí/.test(mandatory)) problems.push(`${name} es obligatoria en validateEnv.js y docs/03 dice "${mandatory}"`);
    else if (requiredLocalVars.includes(name) && !/local/i.test(mandatory)) problems.push(`${name} solo es obligatoria con NODE_ENV=local y docs/03 dice "${mandatory}"`);
    else if (!requiredVars.includes(name) && !requiredLocalVars.includes(name) && !/^No/.test(mandatory)) problems.push(`${name} es opcional y docs/03 dice "${mandatory}"`);
  }
  for (const name of table.keys()) if (!all.includes(name)) problems.push(`docs/03 documenta ${name}, que el código ya no usa`);
  for (const name of [...requiredVars, ...requiredLocalVars]) if (!exampleVars.includes(name)) problems.push(`${name} es obligatoria y falta en .env.example`);
  check('Variables de entorno (validateEnv.js y .env.example → 03-configuracion.md)', problems);
}

// ─── 5. Rutas de S3 ─────────────────────────────────────────────────────────

{
  const problems = [];
  const s3Doc = doc('06-almacenamiento-s3.md');
  const moduleRows = tableRows(doc('05-modulos.md'));
  for (const { name, value } of s3Constants) {
    const row = moduleRows.find((cells) => stripTicks(cells[0]) === name);
    if (!row) problems.push(`${name} no aparece en la tabla de constantes de docs/05`);
    else if (stripTicks(row[1]) !== value) problems.push(`${name} vale "${value}" y docs/05 dice "${stripTicks(row[1])}"`);
    if (!s3Doc.includes(value)) problems.push(`El valor "${value}" de ${name} no aparece en docs/06`);
  }
  const reservedRow = moduleRows.find((cells) => stripTicks(cells[0]) === 'RESERVED_SEGMENTS');
  const reservedCode = `[${reservedSegments.map((s) => `'${s}'`).join(', ')}]`;
  if (!reservedRow) problems.push('RESERVED_SEGMENTS no aparece en la tabla de constantes de docs/05');
  else if (stripTicks(reservedRow[1]) !== reservedCode) problems.push(`RESERVED_SEGMENTS vale ${reservedCode} y docs/05 dice ${stripTicks(reservedRow[1])}`);
  for (const segment of reservedSegments) if (!s3Doc.includes(`${segment}/`)) problems.push(`El segmento reservado "${segment}" no aparece en el árbol de docs/06`);
  check('Rutas de S3 (config/s3Paths.js → 05-modulos.md y 06-almacenamiento-s3.md)', problems);
}

// ─── 6. Columnas del Excel ──────────────────────────────────────────────────

{
  const problems = [];
  const rows = tableRows(doc('05-modulos.md')).filter((cells) => /^\d+$/.test(cells[0]));
  fixedColumns.forEach((name, index) => {
    if (!rows.some((cells) => cells[0] === String(index + 1) && cells[1] === name)) problems.push(`La columna ${index + 1} es "${name}" y docs/05 no la tiene en esa posición`);
  });
  for (const cells of rows) if (!fixedColumns.includes(cells[1])) problems.push(`docs/05 lista la columna "${cells[1]}", que no está en fixedColumnOrder`);
  check('Columnas del Excel (fixedColumnOrder → 05-modulos.md)', problems);
}

// ─── 7. Módulos y funciones (código → docs/05) ──────────────────────────────

{
  const problems = [];
  const modules = doc('05-modulos.md');
  for (const file of codeFiles) {
    const name = basename(file);
    if (!new RegExp(`^#{2,4}\\s+.*${escapeRegExp(name)}`, 'm').test(modules)) problems.push(`${file} no tiene sección (encabezado) en docs/05`);
    if (file === 'config/s3Paths.js') continue; // sus constantes se comprueban en el apartado de rutas de S3
    for (const exported of exportedNames(file)) {
      if (!new RegExp(`(^|[^\\w])${escapeRegExp(exported)}([^\\w]|$)`).test(modules)) problems.push(`${file}: ${exported} no se menciona en docs/05`);
    }
  }
  check('Módulos y funciones (código → 05-modulos.md)', problems);
}

// ─── 8. Dependencias y scripts ──────────────────────────────────────────────

{
  const problems = [];
  const techRows = tableRows(doc('02-tecnologias.md')).filter((cells) => /^`[^`]+`$/.test(cells[0]) && /^\d/.test(cells[1] ?? ''));
  const declared = [...prodDeps, ...devDeps];
  for (const name of declared) {
    const row = techRows.find((cells) => stripTicks(cells[0]) === name);
    const version = installedVersion(name);
    if (!row) problems.push(`${name} no aparece en la tabla de docs/02`);
    else if (version && row[1] !== version) problems.push(`${name}: docs/02 dice ${row[1]} y package-lock.json tiene ${version}`);
  }
  for (const cells of techRows) if (!declared.includes(stripTicks(cells[0]))) problems.push(`docs/02 lista ${stripTicks(cells[0])}, que ya no está en package.json`);
  check('Dependencias (package.json y package-lock.json → 02-tecnologias.md)', problems);
}

{
  const problems = [];
  const documented = tableRows(doc('03-configuracion.md'))
    .map((cells) => stripTicks(cells[0]).match(/^npm (?:run )?([\w:-]+)$/)?.[1])
    .filter(Boolean);
  const scripts = Object.keys(pkg.scripts ?? {});
  for (const name of scripts) if (!documented.includes(name)) problems.push(`El script ${name} no aparece en la tabla de scripts de docs/03`);
  for (const name of documented) if (!scripts.includes(name)) problems.push(`docs/03 documenta el script ${name}, que no está en package.json`);
  check('Scripts (package.json → 03-configuracion.md)', problems);
}

// ─── 8b. Guías y excepciones de la puerta de calidad ────────────────────────

{
  const problems = [];
  const claude = docs['CLAUDE.md'] ?? '';
  for (const file of guideFiles) {
    if (!claude.includes(file)) problems.push(`${file} no figura en CLAUDE.md (tabla de guías)`);
  }
  if (guideFiles.length === 0) problems.push('No hay guías en docs/guias');
  check('Guías (docs/guias → CLAUDE.md; el índice de docs/README.md se comprueba arriba)', problems);
}

{
  const problems = [];
  const quality = read('scripts/quality-check.mjs');
  const security = doc('guias/seguridad.md');
  // Claves de un objeto literal de quality-check.mjs: líneas con dos espacios de sangría ('clave': o clave:).
  const keysOf = (name) => {
    const block = quality.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? '';
    return [...block.matchAll(/^ {2}(?:'([^']+)'|([\w-]+)):/gm)].map((m) => m[1] ?? m[2]);
  };
  for (const name of keysOf('ACCEPTED_ADVISORIES')) {
    if (!security.includes(`\`${name}\``)) problems.push(`La excepción de ACCEPTED_ADVISORIES ${name} no figura en la tabla de la regla S9 de seguridad.md`);
  }
  for (const id of keysOf('PUBLIC_MUTATING_ROUTES')) {
    if (!security.includes(`\`${id}\``)) problems.push(`La excepción de PUBLIC_MUTATING_ROUTES ${id} no figura en la tabla de la regla S3 de seguridad.md`);
  }
  check('Excepciones de quality-check.mjs (→ seguridad.md)', problems);
}

// ─── 9. Métricas: una sola fuente (docs/07) y con valores reales ────────────

{
  const problems = [];
  const volatile = /\b\d{1,4}\s+(endpoints|rutas|funciones|variables|dependencias|archivos|tests|líneas|módulos)\b/i;
  for (const [file, text] of Object.entries(docs)) {
    if (file === 'docs/07-estado-y-deuda-tecnica.md' || file === 'docs/guias/mantenimiento.md') continue;
    text.split('\n').forEach((line, index) => {
      if (volatile.test(line)) problems.push(`${file}:${index + 1} repite una cifra que solo debe estar en docs/07`);
    });
  }
  const state = doc('07-estado-y-deuda-tecnica.md');
  for (const [name, value] of Object.entries(metrics())) {
    const row = state.match(new RegExp(`^\\|\\s*${escapeRegExp(name)}\\s*\\|\\s*(\\d+)\\s*\\|`, 'm'));
    if (!row) problems.push(`docs/07 no tiene la fila "${name}" con el formato | ${name} | N |`);
    else if (Number(row[1]) !== value) problems.push(`docs/07 dice ${row[1]} en "${name}" y el código tiene ${value}`);
  }
  check('Métricas (una sola fuente: 07-estado-y-deuda-tecnica.md)', problems);
}

// ─── 10. Cruce con el frontend (solo avisa; no hace fallar el script) ───────
// El repositorio hermano puede no estar (por ejemplo, en CI) o estar en otra rama,
// así que las diferencias se muestran como avisos y no cambian el código de salida.

if (!existsSync(FRONTEND_DOC)) {
  warnings.push('Cruce con el frontend omitido: no existe ../sigmetum-frontend/docs/integracion/para-backend.md');
} else {
  const front = readFileSync(FRONTEND_DOC, 'utf8').replace(/\r\n/g, '\n');
  const sectionOf = (number) => front.match(new RegExp(`^## ${number}\\..*\\n([\\s\\S]*?)(?=^## \\d+\\.|(?![\\s\\S]))`, 'm'))?.[1] ?? '';
  const loose = (path) => cleanPath(path.split('?')[0]).replace(/<[^>]+>/g, ':p').replace(/:[A-Za-z_]+/g, ':p');

  const frontEndpoints = tableRows(sectionOf(2))
    .map((cells) => cells[0].match(/^`(GET|POST|PUT|PATCH|DELETE)\s+([^`\s]+)`/))
    .filter(Boolean)
    .map((m) => `${m[1]} ${loose(m[2])}`);
  const backEndpoints = apiRoutes.map((route) => `${route.method} ${loose(route.path)}`);

  if (frontEndpoints.length === 0) warnings.push('No se encontraron endpoints en la sección 2 de para-backend.md: revisa si cambió el formato de la tabla');
  for (const id of backEndpoints) if (!frontEndpoints.includes(id)) warnings.push(`El frontend no conoce ${id} (sección 2 de su para-backend.md)`);
  for (const id of frontEndpoints) if (!backEndpoints.includes(id)) warnings.push(`El frontend usa ${id} y el backend ya no lo tiene`);

  const section3 = sectionOf(3);
  for (const column of fixedColumns) if (!section3.includes(`\`${column}\``)) warnings.push(`La columna "${column}" no aparece en la sección 3 de para-backend.md del frontend`);

  const frontIds = unique([...sectionOf(6).matchAll(/\*\*(D\d+)\*\*/g)].map((m) => m[1]));
  const ourDebt = doc('07-estado-y-deuda-tecnica.md');
  for (const id of frontIds) if (!new RegExp(`\\b${id}\\b`).test(ourDebt)) warnings.push(`El frontend lista la discrepancia ${id} y docs/07 no la menciona`);
}

// ─── 11. Integracion: archivos en docs/integracion figuran en índices ──────

{
  const problems = [];
  const readmeContent = doc('README.md');
  const claudeContent = docs['CLAUDE.md'] ?? '';
  const integracionDir = join(ROOT, 'docs', 'integracion');

  if (existsSync(integracionDir)) {
    const integracionFiles = walk('docs/integracion').filter((file) => file.endsWith('.md'));
    for (const file of integracionFiles) {
      const relativePath = file.replace('docs/', '');
      const filename = basename(file);

      // Debe aparecer en docs/README.md
      if (!readmeContent.includes(`](${relativePath})`) && !readmeContent.includes(`/${filename}`)) {
        problems.push(`${file} no está referenciado en docs/README.md`);
      }

      // Debe estar mencionado en CLAUDE.md o en docs/README.md (ya se comprobó arriba)
      if (!claudeContent.includes(filename) && !claudeContent.includes('integracion')) {
        problems.push(`${file} no está mencionado en CLAUDE.md`);
      }
    }
  }
  check('Integracion: archivos en docs/integracion figuran en índices', problems);
}

// ─── 12. Comandos en CLAUDE.md existen en package.json ──────────────────────

{
  const problems = [];
  const claudeContent = docs['CLAUDE.md'] ?? '';
  const scripts = Object.keys(pkg.scripts ?? {});

  // Extraer "npm run X" o menciones a comandos entre backticks
  const commands = unique([
    ...[...claudeContent.matchAll(/`npm (?:run )?([\w:-]+)`/g)].map((m) => m[1]),
    ...[...claudeContent.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]),
  ]);

  for (const cmd of commands) {
    // npm start y npm test son estándares; npm ci, audit, install, init también
    if (['start', 'test', 'ci', 'install', 'update', 'audit', 'init', 'uninstall'].includes(cmd)) continue;
    if (!scripts.includes(cmd)) {
      problems.push(`CLAUDE.md menciona "npm run ${cmd}" pero no existe en package.json`);
    }
  }
  check('Comandos en CLAUDE.md (→ package.json scripts)', problems);
}

// ─── 13. Links a repositorios hermanos (sigmetum-frontend, sigmetum-infra) ───

{
  const problems = [];
  const warnings2 = [];
  const siblings = {
    'sigmetum-frontend': resolve(ROOT, '..', 'sigmetum-frontend'),
    'sigmetum-infra': resolve(ROOT, '..', 'sigmetum-infra'),
  };

  let anyExist = false;
  for (const [, repoPath] of Object.entries(siblings)) {
    if (existsSync(repoPath)) anyExist = true;
  }

  for (const [file, text] of Object.entries(docs)) {
    let inFence = false;
    text.split('\n').forEach((line, index) => {
      if (line.startsWith('```')) inFence = !inFence;
      if (inFence) return;

      for (const [, target] of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        // Buscar referencias a sibling repos: ../sigmetum-frontend/... o ../sigmetum-infra/...
        for (const [repoName, repoPath] of Object.entries(siblings)) {
          const prefix = `../${repoName}/`;
          if (!target.includes(prefix)) continue;

          if (!existsSync(repoPath)) {
            warnings2.push(`${file}:${index + 1} enlaza a ${target}, pero ${repoName} no está disponible (omitido, normal en CI)`);
            continue;
          }

          const pathPart = target.split('#')[0];
          const linkedFile = resolve(repoPath, pathPart.replace(prefix, ''));
          if (!existsSync(linkedFile)) {
            problems.push(`${file}:${index + 1} enlaza a ${target}, pero no existe`);
          }
        }
      }
    });
  }

  if (!anyExist) {
    warnings2.push('Links a repositorios hermanos omitidos: sigmetum-frontend y sigmetum-infra no existen (normal en CI)');
  }

  check('Links a repositorios hermanos', problems);
  warnings.push(...warnings2);
}

// ─── Resultado ──────────────────────────────────────────────────────────────

let failed = 0;
for (const { name, problems } of results) {
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${name}`);
  problems.forEach((problem) => console.log(`    - ${problem}`));
  failed += problems.length;
}
if (warnings.length > 0) {
  console.log('\n⚠ Avisos (no hacen fallar el script)');
  warnings.forEach((warning) => console.log(`    - ${warning}`));
}
console.log(failed === 0 ? '\nLa documentación está al día.' : `\n${failed} problema(s). Corrige la documentación (ver docs/guias/mantenimiento.md).`);
process.exit(failed === 0 ? 0 : 1);
