# M23, homoglifos en la provincia: plan

Fecha: 2026-10-30 · Estado: cerrado · Spec: `docs/specs/2026-10-30-m23-homoglifos-provincia-design.md`

Crítico: sí (entradas de `criticidad`: «claves de S3» y «contrato con el frontend»; `config/s3Paths.js` está en `areasContrato`). Sin veto. Sin rutas nuevas: `tests/estructura-rutas.test.js` no cambia.

## Verificado en el código

- **Una sola regla.** `getProvinciaNameError` (`functions/validateProvincia.js`) es el único punto de validación. `validateProvincia` (columna del Excel de `POST /upload`) y `isValidDataKey` / `isValidDraftKey` (`functions/validateDataKey.js`) la llaman; estas dos cubren `/upload/confirm`, `/update-file` y `/delete-file`. No hay otro origen. Basta cambiar `PROVINCIA_WORD_PATTERN` en `config/s3Paths.js` (hoy `/^\p{L}[\p{L}\p{M}]*$/u`).
- **Separadores admitidos hoy**: solo un espacio o un guion (`name.split(/[ -]/)`). El apóstrofo NO se admite hoy (`L'Hospitalet` ya da 400); este plan no lo cambia. Tildes, `ñ`, `ç`, `ü` son letras latinas con marcas: siguen pasando.
- **Tests existentes**: ninguno usa nombres de provincia en cirílico, griego u otro alfabeto no latino. Los valores válidos (`Málaga`, `Santa Cruz de Tenerife`, `A Coruña`, `Illes Balears`, `Castellón-Castelló`, `Activos`, `Drafts`, `Sevilla`) son latinos. El único literal no latino en `tests/` es `日本語` en `tests/subida-imagen.test.js` (de `imageKey`, no se toca).

## Decisiones del plan

1. **Patrón** (corregido tras la segunda opinión): `PROVINCIA_WORD_PATTERN = /^(?=\p{L})\p{Script=Latin}(?:(?=\p{L})\p{Script=Latin}|[\u0300-\u0344\u0346-\u034E\u0350-\u036F])*$/u` (se escribe con el editor y con secuencias `\u`, nunca con caracteres combinantes crudos). Cada letra debe ser `\p{L}` además de escritura latina: cierra los números romanos U+2160–2188 (`Ⅰ`, categoría Nl, que `\p{Script=Latin}` solo aceptaría). Las marcas se limitan a los diacríticos latinos U+0300–U+036F y excluyen U+034F (CGJ, invisible: `a` + U+034F sería visualmente idéntica a `a`) y U+0345 (ypogegrammeni griego); con `\p{M}` entero, una marca combinante cirílica (p. ej. U+0483) pasaría detrás de una letra latina. Tras NFC, los nombres españoles, catalanes, gallegos y vascos solo usan ese bloque (la segunda opinión comprobó las 400 letras U+00C0–U+024F y que todas las marcas de letras latinas hasta U+2000 en NFD caen en el bloque). Descartado: lista cerrada de letras (`A-Za-z` y `À-ſ`), más rígida; se mantiene el patrón por escritura. Límite aceptado, a documentar en 06: dentro del latín siguen pasando `ª`, `º`, letras modificadoras (`ʰ`), ancho completo (`Ａ`) y letras latinas confundibles como `ɑ`, `ɡ`, `ı`, `ſ`, `ᴀ`. Sin cuantificadores anidados: sin riesgo de ReDoS y la longitud se comprueba antes; si `security/detect-unsafe-regex` marca el patrón, se reescribe con validación por carácter, sin silenciar la regla.
2. El mensaje del 400 no cambia (`Province is not valid`).
3. No se tocan `functions/validateProvincia.js` ni `functions/validateDataKey.js`.

## Fase 1

1. **Tests primero (TDD): deben fallar hoy por el motivo correcto**
   - Archivos (modificar): `tests/provincia.test.js`, `tests/validadores.test.js`, `tests/upload-excel.test.js`, `tests/claves-cliente.test.js`.
   - `provincia.test.js`: en `validas` añadir `'Ñ'`, `'ç'`, `'Vitoria-Gasteiz'`, `'Ü'`; en `rechazadas`, siempre escritos en el código de test con escapes `\u` (nunca con el carácter crudo): `'M\u00E1l\u0430ga'` (a cirílica), `'Gr\u03B1nada'` (alfa griega), `'\u0430'` (a cirílica sola), `'a\u0483'` (marca cirílica tras letra latina), `'\u65E5\u672C\u8A9E'` (escritura no latina), `'\u2160'` (número romano), `'a\u034F'` y `'M\u00E1la\u034Fga'` (CGJ invisible), `'a\u0345'`, `'L\'Hospitalet'` (apóstrofo, ya rechazado: caracteriza que sigue así); en `casos`: un caso `cirílico` con `Provincia: 'M\u00E1l\u0430ga'` y el error `Province is not valid`.
   - `validadores.test.js`: en `dataInvalidas`, `'data/Mál\u0430ga/2026-10-28_v1.xlsx'` y uno con alfa griega; en `borradorInvalidas`, lo mismo con `data/drafts/Mál\u0430ga/${UUID}.xlsx`.
   - `upload-excel.test.js`: en `malos`, un caso con a cirílica (`fullRow('M\u00E1l\u0430ga')`), uno con alfa griega (`fullRow('Gr\u03B1nada')`), uno con `\u2160` y uno con CGJ (`\u034F`), todos con `Province is not valid`; comprobar que el bucle asierte que no se escribe en S3 (`spyTotal() === 0`) y, si no lo hace, añadirlo solo para estos casos.
   - `claves-cliente.test.js`: añadir a `invalidasDeBorrador` y `invalidasDeVersion` el caso «provincia con a cirílica»; así `/upload/confirm` (confirmar y cancelar), `/update-file` y `/delete-file` responden 400 `Invalid draftKey` / `Invalid fileName` sin llamadas a S3.
   - Los casos de `\u2160` y `\u034F` van también a `validadores` (clave de versión y de borrador) y `claves-cliente`, en la misma forma que el de a cirílica. Comprobación: `npm test` falla solo en los casos nuevos de rechazo, por aceptar el nombre no latino (200 o `null`), no por sintaxis ni importación. Los casos nuevos válidos y el de apóstrofo pasan ya hoy. Los literales Unicode van siempre como escapes `\u` (comprobar con Grep sobre `tests/`).
   - Normas: `CLAUDE.md` (TDD); `docs/guias/seguridad.md` (lista de permitidos para claves de S3).

2. **Cambio mínimo de la regla**
   - Archivo (modificar): `config/s3Paths.js`: sustituir `PROVINCIA_WORD_PATTERN` por el patrón de «Decisiones» y su comentario (letras latinas con diacríticos combinantes U+0300–U+036F; cirílico, griego y otros alfabetos se rechazan, M23; mantener «sin bandera g»).
   - Firmas que cambian: solo el valor de la constante exportada.
   - Comprobación: `npm test` en verde entero; los casos que ya existían (reservado, propiedad de objeto, longitud, NFC, separadores) pasan sin cambios.
   - Contrato: `docs/integracion/para-frontend.md` (compatible sin `/api/v2`: solo añade 400 por nombres antes aceptados, con la condición de las carpetas existentes).

3. **Verificación y conteo**
   - Archivo (modificar): `scripts/quality-check.mjs`: `MIN_TESTS` (hoy 1037) al total real de `npm test`.
   - Comprobación: `npm run lint`, `npm run quality`, `npm test`, `npm run docs:check`. Si `quality` falla por algo preexistente (M20), se dice, no se tapa.

## A cargo del tester-documentador

- `docs/06-almacenamiento-s3.md`: regla de provincia («palabras de letras latinas con diacríticos separadas por un solo espacio o guion; se rechazan cirílico, griego y cualquier otro alfabeto, `/`, `\`, `.`, dígitos y apóstrofos»); «Límites conocidos»: retirar que los homoglifos entre alfabetos no se detectan y dejar el límite aceptado (siguen sin detectarse los confundibles dentro del latín: `I`/`l`, `Málaga`/`Malaga`, ancho completo, `ª`, `º`, `ɑ`, `ɡ`, `ı`, `ſ`, `ᴀ`); revisar explícitamente `docs/guias/seguridad.md` (línea «Límites: letras confundibles (homoglifos) no detectadas (M23)»).
- `docs/05-modulos.md`: fila de `PROVINCIA_WORD_PATTERN` con el patrón nuevo; revisar filas de `validateProvincia.js` y `config/s3Paths.js` por si repiten «letras Unicode». `docs/04-api.md`: ajustar solo si describe la regla como «letras Unicode».
- `docs/integracion/para-frontend.md`: fila de contrato nueva tras F11 (compatible, mismo 400 con el mismo texto; condición: una carpeta existente con caracteres no latinos sigue visible en `GET /list-files`, pero `/update-file` y `/delete-file` darán 400 `Invalid fileName`, como F8 con NFD); marcar **(por confirmar)** que el frontend muestra bien ese 400. `para-infra.md`: sin cambios.
- Guías: revisar `docs/guias/seguridad.md` y `docs/guias/mantenimiento.md` por menciones a «letras Unicode» o a los homoglifos como límite; ajustar solo si procede.
- `docs/07-estado-y-deuda-tecnica.md`: M23 resuelto el 30/10/2026 con el límite aceptado (líneas de resumen, hallazgo, tabla de prioridades y «Resueltos», con «commit pendiente» como marcador del hash); carpetas existentes con caracteres no latinos desconocidas **(por confirmar)**, sin migración; métricas y fecha «actualizado».
- Aviso de PR `docs/specs/2026-10-30-m23-homoglifos-provincia-aviso-pr.md`: listar `data/` en dev y prod antes de desplegar y buscar carpetas con caracteres no latinos; migrar a mano las que aparezcan (renombrar la carpeta y su `data/active/<provincia>.json`); efecto sin migrar (visible en `/list-files`, 400 en `/update-file` y `/delete-file`); compatible, sin `/api/v2`, mismo texto de error; `sigmetum-infra` sin cambios de variables ni permisos.
- Cierre: `npm run docs:gate` antes del commit; `agentes:test` no aplica (no se toca `plugins/`). Proponer el mensaje de commit.

## Pruebas

- Modificadas (sin archivos nuevos): `tests/provincia.test.js`, `tests/validadores.test.js`, `tests/upload-excel.test.js`, `tests/claves-cliente.test.js`; `MIN_TESTS` en `scripts/quality-check.mjs`.
- Ejecutar: `npm test` (tras el paso 1 con fallos solo en los casos de rechazo; tras el paso 2 todo en verde), `npm run lint`, `npm run quality`, `npm run docs:check`, `npm run docs:gate`.

## Por confirmar

- Carpetas no latinas existentes en dev y prod; tratamiento del 400 en el frontend.
