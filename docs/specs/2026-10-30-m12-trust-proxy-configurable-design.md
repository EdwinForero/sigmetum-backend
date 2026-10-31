# M12/D7 trust proxy configurable: spec

Fecha: 2026-10-30 · Estado: cerrado

## Objetivo

Hoy el número de saltos de proxy de confianza está fijo en 1 (`app.set('trust proxy', 1)` en `app.js`). Los limitadores de login y de `POST /send-email` cuentan por `req.ip`; con un valor distinto de los saltos reales el cupo lo comparte todo el mundo (se bloquea a todos) o se esquiva falsificando `X-Forwarded-For` (no se limita a nadie). Se pide que el número de saltos lo fije infra por entorno con la variable `TRUST_PROXY_HOPS`, validada, sin cambiar el comportamiento actual cuando no está definida. Es condición previa de la entrega 2 de M21 (ruta pública `/send-email`) y atiende M12 y `frontend:D7`.

Supuestos: la cadena sería CloudFront → nginx → Express en dev y preprod, y ALB → nginx → Express en prod; los saltos reales los confirma infra y este cambio no fija ningún valor por entorno. Los documentos (`05-modulos.md`, `para-infra.md`, `07-estado-y-deuda-tecnica.md`, `seguridad.md`) dicen que `trust proxy` está en `index.js`; el código está en `app.js`.

## Decisiones tomadas (respuestas del usuario)

- Variable `TRUST_PROXY_HOPS`: solo entero de 0 a 5, sin signo, sin decimales ni espacios. Se rechazan `true`, `false`, listas, rangos de IP, negativos, decimales y mayores de 5 (el tope evita que un error de Terraform abra el spoofing de `X-Forwarded-For`).
- Sin definir: 1 salto, como hoy (compatible con el despliegue actual).
- Entornos estrictos = todo lo que no sea `NODE_ENV` `local` ni `test` (política de M15). En ellos: 0 se rechaza; definida pero vacía se rechaza; cualquier valor fuera de 1 a 5 se rechaza, todo con error al arrancar.
- En `local` y `test`: 0 se admite y se aplica (sin proxy delante); un valor inválido o vacío da `console.warn` con el nombre de la variable y la regla (nunca el valor) y la aplicación usa 1, el valor por defecto.
- Los saltos reales por entorno quedan pendientes de infra (decisión de infra, no del backend). La condición previa de M21 entrega 2 sigue abierta hasta que infra confirme y fije la variable.

## Criterios de aceptación

### De código

1. Sin `TRUST_PROXY_HOPS` definida, `app.get('trust proxy')` vale 1; los tests existentes (`tests/app-importacion.test.js`, `tests/estructura-rutas.test.js`) siguen pasando.
2. Con un valor válido (1 a 5 en cualquier entorno; también 0 en `local` y `test`), la aplicación usa ese número de saltos; una prueba demuestra con `X-Forwarded-For` de varios elementos que `req.ip` sale del salto esperado para al menos 0, 1 y 2.
3. Con 0 (solo `local` y `test`), `X-Forwarded-For` enviado por el cliente no cambia `req.ip` ni el contador de los limitadores.
4. Con `NODE_ENV` distinto de `local` y `test` (incluido sin definir), `validateEnv` lanza al arrancar para: `0`, vacía, `true`, `false`, `-1`, `1.5`, `6`, `abc`, `1,2`, una IP o un rango CIDR, y un número con espacios; el mensaje nombra la variable y la regla, nunca el valor. Pruebas en `tests/validate-env.test.js`.
5. Con `NODE_ENV` `local` o `test`, esos mismos valores inválidos (todos salvo `0`) no lanzan; avisan con `console.warn` y `req.ip` se calcula con 1 salto.
6. Ningún valor aceptado permite confiar en toda la cabecera `X-Forwarded-For` ni en rangos abiertos; lo comprueba el conjunto de pruebas de los puntos 4 y 5.
7. No se escribe ningún valor real de infra en el repositorio.
8. `npm run lint`, `npm run quality`, `npm run docs:check`, `npm test` y `npm run docs:gate` pasan; si se añaden tests, sube `MIN_TESTS` en `scripts/quality-check.mjs`.

### De documentación

1. `.env.example`: `TRUST_PROXY_HOPS`, significado, valores admitidos (0 a 5; 0 solo en `local` y `test`), que sin ella el valor es 1, y que no hay valor real de infra.
2. `docs/03-configuracion.md`: la variable en la tabla, opcional, con su regla y la política local/test frente a los entornos estrictos.
3. `docs/integracion/para-infra.md`:
   - Variable nueva opcional para `app_env_vars` de Terraform por entorno; compatible con el despliegue actual (sin ella todo sigue igual); sin IAM ni endpoints nuevos.
   - Guía de comprobación de los saltos reales, marcada **(por confirmar con infra)**. Desde un cliente de IP conocida, sin enviar `X-Forwarded-For` propio, observar la cabecera `X-Forwarded-For` y la dirección del socket que llegan a Express. Valor correspondiente = número de proxies de confianza entre el cliente y Express, es decir, las entradas de `X-Forwarded-For` que añaden los proxies más uno por el proxy que conecta directamente con Express (nginx); comprobar que con ese valor `req.ip` es la IP del cliente conocido. Tabla "cadena → valor" para las cadenas hipotéticas (CloudFront → nginx → Express; ALB → nginx → Express; y la que describe hoy `para-infra.md`, nginx → Express) indicando que el valor depende de si nginx añade su entrada y de lo que CloudFront o el ALB envíen, y que no se fija valor por entorno en este cambio.
   - Consecuencias de un valor mayor o menor que el real (sección de abajo).
   - Contradicción registrada como pregunta para infra: el comentario de `app.js` dice "ALB → nginx → Express" con `trust proxy` 1 y `para-infra.md` dice "nginx (loopback) → Express"; además la documentación dice que `trust proxy` está en `index.js` y el código está en `app.js`. Sección 6 e I2 corregidas en lo que ya no sea cierto (ubicación), sin dar por resuelta la cadena.
   - Sección 8: fila nueva para cambios de la cadena de proxy.
4. `docs/guias/seguridad.md`: las filas de `trust proxy` y de `/send-email` (hoy "falta" / "por confirmar") reflejan que es configurable y que el valor correcto depende de infra; ubicación corregida a `app.js`.
5. `docs/05-modulos.md` y `docs/01-arquitectura.md`: donde citen `trust proxy` 1 fijo (hoy `05-modulos.md` línea 28), el valor por defecto y la variable.
6. `docs/07-estado-y-deuda-tecnica.md`: M12 y la condición previa de M21 entrega 2 actualizadas (condición abierta hasta que infra confirme y fije la variable), la contradicción registrada, la ubicación corregida y la fecha "actualizado" de hoy.
7. `docs/integracion/para-frontend.md`: D7 sigue abierto en el frontend, con nota de que el backend ya permite fijar los saltos. F13, F14 y F15 marcados como resueltos en el frontend (commit `8db9d56` de `sigmetum-frontend`: favicon inyectado en el build, título por página y `lang`, flags de React Router v7); F16 no se toca.

## Consecuencias de un valor distinto del real

- Mayor que los saltos reales: Express toma como IP del cliente un elemento de `X-Forwarded-For` que el propio cliente puede escribir; quien envíe la cabecera con IPs inventadas obtiene un cupo nuevo por petición y esquiva los límites de login (10 por 15 min) y `/send-email` (5 por 15 min). Es el caso peligroso; por eso el tope de 5.
- Menor que los saltos reales: `req.ip` es la IP de un proxy intermedio; todos los visitantes comparten un único cupo y un solo cliente puede bloquear el login del administrador o el formulario de contacto para todos.
- Detrás de CloudFront, la IP que llega es la que CloudFront registra del cliente; el backend no la verifica (por confirmar con infra).
- Los limitadores usan almacén en memoria: con varias instancias en prod el tope real es por instancia (ya documentado; no cambia aquí).

## Fuera de alcance

- Fijar el número de saltos de cada entorno o resolver la contradicción de la cadena (decisión de infra).
- Listas de IP o rangos de confianza.
- Cambiar los límites (10 y 5 por 15 min), el almacén del limitador o `ipv6Subnet`.
- Cambios en `sigmetum-infra` (Terraform) o en `sigmetum-frontend`; se documentan y se avisan en la PR.
- Distinguir el 429 en `LoginForm` (D7, lado frontend).
- Almacén de límites compartido entre instancias.

## Impacto en contratos externos

- `docs/integracion/para-infra.md`: lo afecta. Variable nueva opcional en `app_env_vars` por entorno, compatible con el despliegue actual (sin ella el valor es 1). Sin permisos IAM ni endpoints nuevos. Infra debe confirmar los saltos reales y fijar la variable; hasta entonces la condición previa de M21 entrega 2 sigue abierta.
- `docs/integracion/para-frontend.md`: ningún cambio de contrato (rutas, respuestas, JWT, CORS intactos). Solo F13, F14 y F15 resueltos y la nota de D7.
- `app.js`, `config/validateEnv.js` y `.env.example` son áreas de contrato en `flujo.json`: revisar la sección 6 de `docs/guias/mantenimiento.md` y decirlo en el resumen final.

## Preguntas abiertas

Ninguna del lado del backend. Pendiente de infra (no bloquea implementar): cuántos saltos de confianza hay realmente en dev, preprod y prod, y cuál de las dos descripciones de la cadena es la correcta.
