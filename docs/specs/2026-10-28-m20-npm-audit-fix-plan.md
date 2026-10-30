# M20 npm audit fix sin --force: plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: [2026-10-28-m20-npm-audit-fix-design.md](2026-10-28-m20-npm-audit-fix-design.md)

Crítico: sí (entrada "dependencias" de `criticidad`; posible roce con "contrato con el frontend" por `qs`/`body-parser`, por confirmar).

## Supuestos

- Los avisos de `body-parser`, `proxy-addr`, `qs` e `ip-address` son transitivos (vía `express` y `express-rate-limit`); `nodemailer` es directo (`^10.0.14`).
- Versiones esperadas, según el dry run de `npm audit fix --dry-run --omit=dev` de la segunda opinión (por confirmar al ejecutarlo):

  | Paquete | Ahora | Esperada |
  |---|---|---|
  | qs | 6.16.0 | 6.16.2 |
  | proxy-addr | 2.0.7 | 2.0.8 |
  | nodemailer | 10.0.14 | 10.2.1 (cabe en `^10.0.14`) |
  | ip-address | 10.7.3 | 10.7.5 |
  | body-parser | 1.20.8 | 1.20.9 |

- Ese dry run con `--omit=dev` listó decenas de líneas `remove` de paquetes de desarrollo. Si es cierto, `--omit=dev` poda el árbol de desarrollo del lock; CI usa `npm ci` y el lint lo necesita, así que no se aplica con `--omit=dev`.
- `package-lock.json` es `lockfileVersion` 2: cada paquete aparece en `packages` y en `dependencies`, así que cada subida sale dos veces en el diff.
- El `engines.node` de la raíz del lock es `"20.x"` y el de `package.json` es `"22"`. Un comando de npm puede reescribirlo; es el único cambio extra tolerado en el diff y se anota (por confirmar).
- Node: `engines` pide 22; CI y Beanstalk usan 22. El equipo local es 24 (aviso EBADENGINE).

## Fase 1

1. **Aplicar solo las cinco subidas, sin podar el lock**
   - Archivos: `package-lock.json` (modificar). `package.json` no debe cambiar.
   - Orden:
     1. `git diff --stat` limpio en `package*.json`.
     2. Contraste: `npm audit fix --dry-run` **sin** `--omit=dev`; anotar si propone otros cambios (en especial `remove` de dev o un salto mayor).
     3. Aplicar: `npm update qs proxy-addr nodemailer ip-address body-parser --package-lock-only` (sin `--force`).
     4. Si el dry run del punto 2 muestra solo esas cinco subidas, `npm audit fix` sin `--omit=dev` da el mismo resultado y es válido. Se prefiere `npm update` por ser selectivo.
   - Se aparta del mecanismo literal de la spec (`npm audit fix`) pero cumple sus criterios 1 a 7; fue petición del usuario en la revisión del plan.
   - Comprobación (parada si falla):
     - `git diff package-lock.json` contiene **solo** las cinco subidas de la tabla (cada una dos veces, con su `resolved` e `integrity`). Ninguna línea `remove`, ningún otro paquete, ninguna entrada de desarrollo.
     - Única excepción: la línea `engines` de la raíz (`"20.x"` a `"22"`), si npm la reescribe. Se anota y se avisa al `tester-documentador`; no se revierte a mano.
     - Cualquier otro cambio o versión distinta: **parar y consultar al usuario** (decisión 1 de la spec).
     - `git diff --stat` solo muestra `package-lock.json`.
   - Norma: `docs/guias/seguridad.md` (nunca `--force`) y `docs/guias/buenas-practicas-backend.md`.
2. **Comprobar el efecto y registrar las versiones**
   - Archivos: ninguno (solo lectura).
   - Comprobación:
     - `npm ci --dry-run` no falla: el lock es coherente con `package.json` y conserva el árbol de desarrollo.
     - `npm ls express body-parser proxy-addr qs nodemailer ip-address` muestra las versiones de la tabla, sin `invalid` ni `extraneous`.
     - `npm audit --omit=dev` ya no lista `body-parser`, `proxy-addr`, `ip-address`, `nodemailer` ni `qs`; solo queda el moderado de `uuid` vía `exceljs`.
     - Pasar la salida de `npm ls` al `tester-documentador` para la tabla de `docs/02`.
     - Confirmar que ningún paquete cambiado exige otra versión de Node (`engines` en el lock).
   - Norma: `docs/integracion/para-infra.md`.
3. **Verificación funcional sin tests de API (M11)**
   - Archivos: ninguno.
   - Entorno: Node 22 si hay `nvm`, `fnm` o contenedor. Si no, dejar escrito que el local es Node 24 (EBADENGINE) y que CI (`ci.yml`, `node-version: 22`, `npm ci`) cubre el 22; CI en verde cuenta como parte de la verificación (por confirmar hasta que corra).
   - Comprobación:
     - `npm start` y `GET /healthcheck` responden igual que antes.
     - **Limitador de login sobre `req.ip` tras proxy** (`index.js:29`, `trust proxy` 1; `routes/auth.js:7`, `POST /log`): con `X-Forwarded-For: 203.0.113.7` el limitador cuenta por esa IP; otra IP (`203.0.113.8`) no comparte contador; tras 10 intentos llega el 429 con `{ success: false, error }`. `req.ip`/`req.ips` deben salir igual que antes; si cambian, parar.
     - **Formulario de contacto** (`nodemailer`): prueba manual.
     - **Parseo (`qs`/`body-parser`)**: `POST` con JSON (`express.json()`, `index.js:46`), cuerpo vacío y JSON inválido (error por `errorHandler`) igual que antes; `GET` con query repetida (`?a=1&a=2`) y anidada (`?a[b]=1`) con `req.query` igual que antes. Cualquier diferencia es cambio incompatible: parar y avisar (`docs/integracion/para-frontend.md`).
     - `npm run lint` y `npm run quality` sin problemas; `ACCEPTED_ADVISORIES` vacío.
     - `npm audit` sin `--omit=dev` puede listar avisos de desarrollo (fuera de alcance); `scripts/quality-check.mjs:136` ejecuta siempre `npm audit --omit=dev`, así que no debería afectar (lectura hecha, falta ejecutarlo).
   - Norma: `docs/integracion/para-frontend.md` y `docs/guias/mantenimiento.md` sección 2.

## A cargo del tester-documentador

- `docs/02-tecnologias.md`: versiones de las dependencias directas que cambien, con la salida de `npm ls`.
- `docs/07-estado-y-deuda-tecnica.md`: fecha "actualizado" de hoy; M20 resuelto con fecha (hash tras el commit) y abierto solo para `uuid`/`exceljs`; reescribir el punto de "siguientes pasos" que cita M20; mantener **(por confirmar)** sobre la gravedad real de `proxy-addr` con nota de verificar con `npm audit` en CI; métricas solo si cambian. Si el lock cambia `engines.node` de `20.x` a `22`, anotarlo como corrección de una incoherencia previa.
- `docs/guias/seguridad.md` (líneas ~134 y ~167): revisar si la mención de M16 y de `quality` fallando sigue siendo cierta; incoherencia previa, se señala sin ampliarla.
- `docs/integracion/para-frontend.md` y `para-infra.md`: confirmar que no cambian; si el parseo varía, avisar.
- Cierre: `npm run docs:check` y `npm run docs:gate` antes del commit.

## Pruebas

Sin base de tests (M11): verificación por comandos y prueba manual (paso 3). `npm run agentes:test` no aplica (no se toca `plugins/`).

## Alternativa descartada

`npm audit fix --omit=dev`: respeta el mecanismo de la spec, pero según el dry run poda decenas de paquetes de desarrollo del lock, lo que rompe `npm ci` en CI y el lint. Sin `--omit=dev`, `npm audit fix` solo es válido si su dry run propone exactamente las cinco subidas. Se prefiere `npm update ... --package-lock-only` por ser selectivo; el riesgo de versiones no auditadas se cierra con la comprobación del diff del paso 1 y el `npm audit` del paso 2.
