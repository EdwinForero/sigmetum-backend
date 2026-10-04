// Puerta de calidad y seguridad del backend.
// Uso: npm run quality
// Comprueba: patrones prohibidos en el código, rutas que modifican estado sin autenticación, variables de
// entorno sin declarar, secretos, vulnerabilidades de las dependencias de producción y ESLint.
// Las reglas y su motivo están en docs/guias/seguridad.md y docs/guias/buenas-practicas-backend.md.
// Sin dependencias: solo módulos de Node (y las herramientas que ya usa el proyecto: npm, git y eslint).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (file) => file.split(sep).join('/');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const unique = (list) => [...new Set(list)];

const IGNORED = new Set(['node_modules', '.git', 'uploads']);
const walk = (dir) =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const path = posix(join(dir, name));
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });

const CODE_DIRS = ['routes', 'config', 'functions', 'aws', 'middleware'];
const codeFiles = ['index.js', ...CODE_DIRS.flatMap((dir) => walk(dir)).filter((file) => file.endsWith('.js'))];

const run = (command, args) => spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: true });

const results = [];
const check = (name, problems, notes = []) => results.push({ name, problems, notes });

// ─── Excepciones registradas ────────────────────────────────────────────────
// Cada excepción lleva su motivo. Si deja de hacer falta, el script lo dice y hay que quitarla.

// Rutas que modifican estado (POST, PUT, PATCH, DELETE) y NO exigen token. Es una lista cerrada.
const PUBLIC_MUTATING_ROUTES = {
  'POST /log': 'Es el login: no puede exigir un token que todavía no existe. Lleva limitador de intentos.',
  'POST /send-email': 'Formulario de contacto público. Falta límite de peticiones y validación (hallazgo M3 de docs/07).',
};

// Variables que el código lee pero que NO son obligatorias (no están en config/validateEnv.js).
const OPTIONAL_ENV = {
  NODE_ENV: 'Selecciona el modo local (credenciales SSO, trazas de pila); sin valor se comporta como producción.',
  PORT: 'Tiene valor por defecto (8000); Beanstalk la inyecta.',
  API_PREFIX: 'Tiene valor por defecto (/api/v1).',
};

// Vulnerabilidades altas o críticas aceptadas de forma explícita, con su justificación.
// Solo se acepta lo que no es alcanzable en producción o no tiene arreglo. Se revisa al actualizar.
const ACCEPTED_ADVISORIES = {};

// ─── 1. Patrones prohibidos en el código ────────────────────────────────────

{
  const forbidden = [
    { name: 'ejecución dinámica de código (eval, new Function)', pattern: /\beval\s*\(|new Function\s*\(/ },
    { name: 'ejecución de procesos externos (child_process)', pattern: /child_process/ },
    { name: 'datos sensibles escritos en un log (console con req.body, cabeceras, tokens o contraseñas)', pattern: /console\.\w+\(.*\b(req\.body|req\.headers|password|passwd|token|secret|authorization)\b/i },
    { name: 'variables de entorno completas escritas en un log', pattern: /console\.\w+\(.*process\.env\s*[,)]/ },
    { name: 'CORS abierto a cualquier origen', pattern: /origin:\s*['"`]\*['"`]|\bcors\(\s*\)/ },
    { name: 'verificación TLS desactivada', pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/ },
  ];
  const problems = [];
  for (const file of codeFiles) {
    read(file).split('\n').forEach((line, index) => {
      for (const { name, pattern } of forbidden) {
        if (pattern.test(line)) problems.push(`${file}:${index + 1} ${name}`);
      }
    });
  }
  check('Patrones prohibidos en el código', problems);
}

// ─── 2. Rutas que modifican estado y no están protegidas ────────────────────

{
  const problems = [];
  const seen = new Set();
  for (const file of codeFiles.filter((f) => f.startsWith('routes/'))) {
    read(file).split('\n').forEach((line, index) => {
      const match = line.match(/^\s*(router|protectedRouter)\.(post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3(.*)$/);
      if (!match) return;
      const [, owner, method, , path, rest] = match;
      const id = `${method.toUpperCase()} ${path}`;
      if (owner === 'protectedRouter' || /\btokenAuth\b/.test(rest)) return;
      seen.add(id);
      if (!(id in PUBLIC_MUTATING_ROUTES)) problems.push(`${file}:${index + 1} ${id} modifica estado y no cuelga de protectedRouter ni usa tokenAuth`);
    });
  }
  for (const id of Object.keys(PUBLIC_MUTATING_ROUTES)) {
    if (!seen.has(id)) problems.push(`La excepción "${id}" de PUBLIC_MUTATING_ROUTES ya no existe o ya está protegida: quítala`);
  }
  check('Rutas mutantes sin autenticación (solo las excepciones registradas)', problems, Object.entries(PUBLIC_MUTATING_ROUTES).map(([id, why]) => `Excepción aceptada: ${id}. ${why}`));
}

// ─── 3. Variables de entorno sin declarar ───────────────────────────────────

{
  const problems = [];
  const validateSrc = read('config/validateEnv.js');
  const declared = [...validateSrc.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
  const used = unique(codeFiles.flatMap((file) => [...read(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])));
  for (const name of used) {
    if (!declared.includes(name) && !(name in OPTIONAL_ENV)) problems.push(`process.env.${name} se usa en el código y no está en config/validateEnv.js ni en OPTIONAL_ENV`);
  }
  for (const name of Object.keys(OPTIONAL_ENV)) {
    if (!used.includes(name)) problems.push(`${name} está en OPTIONAL_ENV y el código ya no la usa: quítala`);
    if (declared.includes(name)) problems.push(`${name} está en OPTIONAL_ENV y también en validateEnv.js: deja solo una`);
  }
  check('Variables de entorno (código → config/validateEnv.js)', problems);
}

// ─── 4. Secretos ────────────────────────────────────────────────────────────

{
  const problems = [];
  const secretPatterns = [
    { name: 'clave de acceso de AWS', pattern: /AKIA[0-9A-Z]{16}/ },
    { name: 'clave privada', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'token de GitHub', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
    { name: 'token Bearer literal', pattern: /Bearer\s+[A-Za-z0-9._-]{30,}/ },
    { name: 'JWT literal', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/ },
    { name: 'hash bcrypt literal', pattern: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/ },
  ];
  const files = [
    ...codeFiles,
    '.env.example',
    'package.json',
    'README.md',
    'CLAUDE.md',
    ...['INTEGRACION.md'].filter((file) => existsSync(join(ROOT, file))),
    ...walk('docs').filter((file) => file.endsWith('.md')),
    ...(existsSync(join(ROOT, '.claude')) ? walk('.claude') : []),
  ];
  for (const file of files) {
    read(file).split('\n').forEach((line, index) => {
      for (const { name, pattern } of secretPatterns) {
        if (pattern.test(line)) problems.push(`${file}:${index + 1} parece contener un ${name}`);
      }
    });
  }
  for (const [, key, value] of read('.env.example').matchAll(/^([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE|ACCESS_KEY)[A-Z0-9_]*)=(.+)$/gm)) {
    if (value.trim() !== '') problems.push(`.env.example da un valor a ${key}: debe ir vacío`);
  }
  const tracked = run('git', ['ls-files', '.env', '".env.*"']).stdout.split('\n').map((f) => f.trim()).filter((f) => f && f !== '.env.example');
  if (tracked.length > 0) problems.push(`Hay archivos .env versionados: ${tracked.join(', ')}`);
  if (run('git', ['ls-files', 'package-lock.json']).stdout.trim() === '') problems.push('package-lock.json no está versionado: las instalaciones no serían reproducibles');
  check('Secretos y configuración versionada', problems);
}

// ─── 5. Vulnerabilidades de las dependencias de producción ──────────────────

{
  const problems = [];
  const notes = [];
  const audit = run('npm', ['audit', '--omit=dev', '--json']);
  let report = null;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    // sin red o salida no válida
  }
  if (!report || !report.vulnerabilities) {
    notes.push('No se pudo ejecutar npm audit (¿sin conexión?). Ejecútalo con red antes de fusionar.');
  } else {
    let lesser = 0;
    for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
      if (!['high', 'critical'].includes(vulnerability.severity)) {
        lesser += 1;
        continue;
      }
      const titles = vulnerability.via.filter((via) => typeof via === 'object').map((via) => via.title);
      const fix = vulnerability.fixAvailable;
      const remedy = fix === true ? 'arreglo sin cambios mayores (npm audit fix)' : fix && fix.name ? `arreglo: ${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (cambio mayor)' : ''}` : 'sin arreglo disponible';
      const detail = `${name} (${vulnerability.severity}, ${vulnerability.isDirect ? 'directa' : 'transitiva'})${titles.length ? `: ${titles[0]}` : ''}`;
      if (name in ACCEPTED_ADVISORIES) notes.push(`${detail}. Aceptada: ${ACCEPTED_ADVISORIES[name]}`);
      else problems.push(`${detail}. ${remedy}. Actualiza la dependencia o justifica la excepción en ACCEPTED_ADVISORIES`);
    }
    for (const name of Object.keys(ACCEPTED_ADVISORIES)) {
      const vulnerability = report.vulnerabilities[name];
      if (!vulnerability || !['high', 'critical'].includes(vulnerability.severity)) problems.push(`"${name}" está en ACCEPTED_ADVISORIES y ya no aparece como alta o crítica: quítala`);
    }
    if (lesser > 0) notes.push(`${lesser} vulnerabilidades más de gravedad baja o moderada (npm audit --omit=dev). Revisarlas al actualizar dependencias.`);
  }
  check('Dependencias de producción (npm audit, gravedad alta o crítica)', problems, notes);
}

// ─── 6. ESLint ──────────────────────────────────────────────────────────────

{
  const lint = run('npm', ['run', '--silent', 'lint']);
  const ceiling = Number(read('package.json').match(/--max-warnings\s+(\d+)/)?.[1]);
  const notes = [];
  const extra = [];
  if (!Number.isFinite(ceiling)) extra.push('El script lint de package.json no fija --max-warnings: sin tope, los avisos podrían crecer sin control');
  if (lint.status === 0 && Number.isFinite(ceiling)) {
    const json = run('npx', ['eslint', '.', '-f', 'json']);
    let actual = null;
    try {
      actual = JSON.parse(json.stdout).reduce((sum, file) => sum + file.warningCount, 0);
    } catch {
      notes.push('No se pudo contar los avisos de ESLint.');
    }
    if (actual !== null && actual < ceiling) {
      extra.push(`Hay ${actual} avisos y el tope es ${ceiling}: baja --max-warnings a ${actual} en package.json para no perder la mejora`);
    } else if (actual !== null) {
      notes.push(`${actual} avisos de ESLint (tope ${ceiling}): deuda de calidad y seguridad, ver docs/guias/buenas-practicas-backend.md`);
    }
  }
  const lines = lint.stdout.split('\n');
  const errors = lines.filter((line) => /\s+error\s+/.test(line)).slice(0, 5);
  const total = lines.find((line) => /problems?/.test(line)) ?? '';
  check(
    'ESLint (sin errores, sin superar el tope de avisos y con el tope ajustado)',
    lint.status === 0 ? extra : [`npm run lint falla ${total.trim()}`, ...errors.map((line) => line.trim())],
    notes
  );
}

// ─── Resultado ──────────────────────────────────────────────────────────────

let failed = 0;
for (const { name, problems, notes } of results) {
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${name}`);
  problems.forEach((problem) => console.log(`    - ${problem}`));
  notes.forEach((note) => console.log(`    · ${note}`));
  failed += problems.length;
}
console.log(failed === 0 ? '\nCalidad y seguridad: sin problemas nuevos.' : `\n${failed} problema(s). Ver docs/guias/seguridad.md.`);
process.exit(failed === 0 ? 0 : 1);
