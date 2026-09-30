const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');
const nodePlugin = require('eslint-plugin-n');

// Los errores bloquean. Las reglas de calidad y de seguridad que el código actual incumple se dejan como
// avisos (warn) para no bloquear el trabajo, pero el número de avisos NO puede crecer: ver `--max-warnings`
// en el script `lint` de package.json. Al corregir deuda, se baja ese número y `npm run quality` lo exige.
// Las reglas y su motivo están en docs/guias/buenas-practicas-backend.md y docs/guias/seguridad.md.

module.exports = [
  { ignores: ['node_modules/**', 'uploads/**'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    plugins: { n: nodePlugin },
    rules: {
      // Ejecución dinámica de código: prohibida (errores)
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'n/no-restricted-require': ['error', [{ name: ['child_process', 'node:child_process'], message: 'No se ejecutan procesos externos desde la API (ver docs/guias/seguridad.md)' }]],

      // Dependencias y módulos
      'n/no-missing-require': 'error',
      'n/no-extraneous-require': 'error',
      'n/no-deprecated-api': 'error',

      // Calidad (avisos: no pueden crecer)
      // `next` se ignora: los manejadores de errores de Express exigen los cuatro parámetros.
      'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^(_|next$)', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      eqeqeq: ['warn', 'always'],
    },
  },
  {
    // Scripts de mantenimiento (ESM): pueden escribir en consola
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      'n/no-missing-import': 'off',
      // Herramientas de desarrollo: no atienden peticiones y leen rutas y expresiones que construyen ellas mismas.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Falsos positivos: el índice sale de una lista fija del propio código (variables requeridas, columnas del Excel),
    // nunca de la entrada del usuario. En el resto del código la regla sigue activa (ver A4 en docs/07).
    files: ['config/validateEnv.js', 'functions/convertExcelToJson.js'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // Este archivo y otros de configuración
    files: ['eslint.config.js'],
    rules: { 'n/no-extraneous-require': 'off' },
  },
];
