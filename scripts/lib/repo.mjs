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
export const codeFiles = ['index.js', ...CODE_DIRS.flatMap((dir) => walk(dir)).filter((file) => file.endsWith('.js'))];

// Rutas de routes/*.js: `router.get('/x', ...)` y `protectedRouter.post('/y', ...)`. Una ruta es protegida
// si cuelga de `protectedRouter` o si `tokenAuth` aparece en la misma línea. La ruta se devuelve tal cual.
export const routeDeclarations = () =>
  codeFiles
    .filter((file) => file.startsWith('routes/'))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => {
          const match = line.match(/^\s*(router|protectedRouter)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3(.*)$/);
          if (!match) return [];
          const [, owner, method, , path, rest] = match;
          return [{ file, line: index + 1, method: method.toUpperCase(), path, protected: owner === 'protectedRouter' || /\btokenAuth\b/.test(rest) }];
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
