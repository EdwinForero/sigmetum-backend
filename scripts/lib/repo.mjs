// Base común de los controles del proyecto (docs-check.mjs y quality-check.mjs).
// Solo funciones de lectura del repositorio, sin dependencias. No importa nada de plugins/:
// el núcleo del plugin se instala en caché y los controles del proyecto no deben depender de él.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
export const posix = (file) => file.split(sep).join('/');
export const unique = (list) => [...new Set(list)];

const IGNORED = new Set(['node_modules', '.git', 'uploads']);
export const walk = (dir) =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const path = posix(join(dir, name));
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });

// Código de la API (sin tests).
export const CODE_DIRS = ['routes', 'config', 'functions', 'aws', 'middleware'];
export const codeFiles = ['index.js', 'app.js', ...CODE_DIRS.flatMap((dir) => walk(dir)).filter((file) => file.endsWith('.js'))];

// Rutas de routes/*.js: `router.get('/x', ...)`. Una ruta es protegida si y solo si `tokenAuth` es el primer
// manejador tras la ruta, en la misma línea: `router.post('/y', tokenAuth, ...)`. Un `protectedRouter.post(...)`
// residual se ve y cuenta como no protegido (lado seguro). La ruta se devuelve tal cual.
// Limitaciones: la detección es por línea (`tokenAuth` en otra línea se toma como no protegida: falso positivo,
// lado seguro) y NO ve `router.route()`, `router.all`, `router.use` ni rutas declaradas en variables; solo
// tests/estructura-rutas.test.js y tests/rutas-protegidas.test.js (pila real de Express) los cubren.
// Limitación en el lado INSEGURO: una declaración partida en varias líneas (`router.post(` y la ruta en la
// línea siguiente) no casa con la expresión y la ruta es INVISIBLE para esta detección estática: una mutante así
// no se marcaría como sin proteger. Por eso `quality` ejecuta la suite (pila real) y además avisa con
// `unparsedRouteLines()` de toda línea que empieza por `router.<método>(` y no se pudo interpretar.
const ROUTE_LINE = /^\s*(router|protectedRouter)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3(.*)$/;
const ROUTE_START = /^\s*(router|protectedRouter|app)\.(get|post|put|patch|delete|all|use|route)\(/;

export const unparsedRouteLines = () =>
  codeFiles
    .filter((file) => file.startsWith('routes/'))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (ROUTE_START.test(line) && !ROUTE_LINE.test(line) ? [{ file, line: index + 1, text: line.trim() }] : []))
    );

export const routeDeclarations = () =>
  codeFiles
    .filter((file) => file.startsWith('routes/'))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => {
          const match = line.match(ROUTE_LINE);
          if (!match) return [];
          const [, , method, , path, rest] = match;
          return [{ file, line: index + 1, method: method.toUpperCase(), path, protected: /^\s*,\s*tokenAuth\s*[,)]/.test(rest) }];
        })
    );

// Variables de entorno que lee el código (`process.env.X`).
export const usedEnvVars = () => unique(codeFiles.flatMap((file) => [...read(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])));

// Listas de config/validateEnv.js: `required` (siempre) y `requiredLocal` (solo con NODE_ENV=local).
export const declaredEnvVars = () => {
  const source = read('config/validateEnv.js');
  const listFrom = (name) => [...(source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? '').matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
  return { required: listFrom('required'), requiredLocal: listFrom('requiredLocal') };
};

// Imprime cada comprobación (✓/✗, sus problemas con "-" y sus notas con "·") y devuelve el número de problemas.
export const printResults = (results) => {
  let failed = 0;
  for (const { name, problems, notes = [] } of results) {
    console.log(`${problems.length === 0 ? '✓' : '✗'} ${name}`);
    problems.forEach((problem) => console.log(`    - ${problem}`));
    notes.forEach((note) => console.log(`    · ${note}`));
    failed += problems.length;
  }
  return failed;
};
